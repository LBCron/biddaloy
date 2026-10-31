import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import type { PresetApplyOptions, PresetApplyResult } from '@biddaloy/shared';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { seedSystemReports } from '../reports/system/system-reports.seeder';
import type { RequestContext } from '../../common/request-context.util';
import { School } from '../schools/entities/school.entity';
import { TenantSettingsCache } from '../schools/settings/tenant-settings-cache.service';
import { PresetRegistryService } from './preset-registry.service';
import { countRows, FRESH_TENANT_ENTITIES } from './preset-blockers';
import { uploadCertificateArtwork, writeCertificates } from './apply/writers/certificates.writer';
import type { ApplyContext, ApplyWriter } from './apply/apply-context';
import { writeSettings } from './apply/writers/settings.writer';
import { writeYear } from './apply/writers/year.writer';
import { writeClasses } from './apply/writers/classes.writer';
import { writeSubjects } from './apply/writers/subjects.writer';
import { writeClassSubjects } from './apply/writers/class-subjects.writer';
import { writeGradingScale } from './apply/writers/grading-scale.writer';
import { writeTerms } from './apply/writers/terms.writer';
import { writeExamTemplates } from './apply/writers/exam-templates.writer';
import type { ApplyPresetDto } from './dto/apply-preset.dto';

/** Order matters: settings first, grading scale needs the year, templates need classes + subjects. */
const WRITERS: ApplyWriter[] = [
  writeSettings,
  writeYear,
  writeClasses,
  writeSubjects,
  writeClassSubjects,
  writeGradingScale,
  writeTerms,
  writeExamTemplates,
  writeCertificates,
];

/** The exact keys `created` always carries (writers that create nothing report 0). */
const RESULT_KEYS: Record<string, string> = {
  settings: 'settings',
  academic_years: 'academicYears',
  academicYears: 'academicYears',
  classes: 'classes',
  subjects: 'subjects',
  classSubjects: 'classSubjects',
  academic_terms: 'academicTerms',
  academicTerms: 'academicTerms',
  grading_scales: 'gradingScales',
  grading_bands: 'gradingBands',
  exam_templates: 'examTemplates',
  exam_template_components: 'examTemplateComponents',
  print_templates: 'printTemplates',
};

const emptyCreated = (): Record<string, number> =>
  Object.fromEntries([...new Set(Object.values(RESULT_KEYS))].map((k) => [k, 0]));

@Injectable()
export class PresetApplyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: PresetRegistryService,
    private readonly audit: AuditService,
    private readonly settingsCache: TenantSettingsCache,
    private readonly storage: StorageService,
  ) {}

  async apply(
    tenantId: string,
    userId: string,
    dto: ApplyPresetDto,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<PresetApplyResult> {
    const pack = this.registry.get(dto.preset_id);
    const stageKeys = new Set(pack.stages.map((s) => s.key));
    const badStages = dto.stages.filter((s) => !stageKeys.has(s));
    if (badStages.length)
      throw new BadRequestException(`Unknown stage(s): ${badStages.join(', ')}`);

    const versions = dto.versions ?? [];
    const versionKeys = new Set((pack.versions ?? []).map((v) => v.key));
    if (versionKeys.size === 0 && versions.length > 0) {
      throw new BadRequestException('This preset has no versions');
    }
    if (versionKeys.size > 0 && versions.length === 0) {
      throw new BadRequestException('Select at least one version');
    }
    const badVersions = versions.filter((v) => !versionKeys.has(v));
    if (badVersions.length) {
      throw new BadRequestException(`Unknown version(s): ${badVersions.join(', ')}`);
    }

    const options: PresetApplyOptions = {
      presetId: dto.preset_id,
      startYear: dto.start_year,
      stages: dto.stages,
      versions,
    };

    // Fast-fail before uploading anything, so a refused apply leaves no stray artwork in storage.
    await this.dataSource.transaction((manager) => this.assertFresh(manager, tenantId));
    // Storage round-trips stay outside the transaction (no I/O under the school row lock).
    const artwork = await uploadCertificateArtwork(pack, tenantId, this.storage);

    const created = await this.dataSource.transaction(async (manager) => {
      await this.assertFresh(manager, tenantId);

      const ctx: ApplyContext = {
        manager,
        tenantId,
        userId,
        pack,
        options,
        artwork,
        ids: {
          classIdByKey: new Map(),
          subjectIdByCode: new Map(),
          classSubjectIdByKey: new Map(),
        },
      };
      const counts = emptyCreated();
      for (const writer of WRITERS) {
        for (const [k, n] of Object.entries(await writer(ctx))) {
          counts[RESULT_KEYS[k] ?? k] = n;
        }
      }

      // The ready-made reports ship with the preset so a new school's Reports page is never empty (8.15 D12).
      await seedSystemReports(manager, tenantId, userId);

      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'CurriculumPreset',
          entity_id: tenantId, // audit_logs.entity_id is a uuid; the pack id lives in new_values
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: { preset: pack.id, version: pack.version, options, created: counts },
          ip_address: context.ip,
          user_agent: context.userAgent,
        },
        manager,
      );
      return counts;
    });

    // After commit only: a rolled-back apply must not evict a still-valid cache entry.
    this.settingsCache.invalidate(tenantId);
    return { created };
  }

  /** Refuses a school that already has a preset or academic rows. Call inside a transaction. */
  private async assertFresh(manager: EntityManager, tenantId: string): Promise<void> {
    // Lock the school row FIRST so two concurrent applies serialise here.
    // ponytail: manual creates (classes, subjects...) take no school lock, so an apply racing
    // one of them is not fully serialised; add the lock to those paths if it ever matters.
    const school = await manager
      .getRepository(School)
      .createQueryBuilder('school')
      .where('school.id = :id', { id: tenantId })
      .setLock('pessimistic_write')
      .getOne();
    if (!school) throw new BadRequestException('School not found');

    // Stored preset read from the LOCKED row, never the cached settings reader.
    const stored = (school.settings as { preset?: unknown } | null)?.preset;
    const blockers = (await countRows(manager, tenantId, FRESH_TENANT_ENTITIES)).filter(
      (c) => c.count > 0,
    );
    if (stored || blockers.length) {
      throw new ConflictException({
        message: 'A curriculum preset can only be applied to a fresh school',
        details: { code: 'PRESET_NOT_FRESH', blockers },
      });
    }
  }
}
