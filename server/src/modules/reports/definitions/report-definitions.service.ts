import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import {
  AuditAction,
  REPORT_DEFINITION_SCHEMA_VERSION,
  ReportDefinitionStatus,
  UserRole,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { validateDefinition } from '../engine/compiler/validate-definition';
import { seedSystemReports } from '../system/system-reports.seeder';
import { ReportRegistry } from '../engine/registry/registry';
import { ReportDefinitionVersion } from '../entities/report-definition-version.entity';
import { ReportDefinition } from '../entities/report-definition.entity';
import type {
  CatalogueFolderDto,
  CreateReportDefinitionDto,
  UpdateReportDefinitionDto,
} from './dto/report-definition.dto';

export interface DefinitionViewer {
  tenantId: string;
  userId: string;
  role: string;
}

/** Roles that author reports see every published report, whoever it was made for. */
const SEES_ALL = new Set<string>([UserRole.ADMIN, UserRole.SUPER_ADMIN]);

/**
 * [8.15.23] The life of a report (Epic 8.15 D3, D9, D12): a draft you can keep editing, an immutable
 * published version per publish, a copy to start from, and a catalogue of what each role may run.
 * The definition JSON is checked by the compiler's own validator against the registry, never by
 * decorators, so a report can only name fields that exist. Every change leaves an audit entry.
 */
@Injectable()
export class ReportDefinitionsService {
  constructor(
    @InjectRepository(ReportDefinition) private readonly definitions: Repository<ReportDefinition>,
    @InjectRepository(ReportDefinitionVersion)
    private readonly versions: Repository<ReportDefinitionVersion>,
    private readonly registry: ReportRegistry,
    private readonly audit: AuditService,
  ) {}

  /** Throws a 422 naming the problem (never the value) when the definition cannot be saved. */
  private check(definition: ReportDefinitionJson): void {
    // Structure only: the answers to its questions are not known until someone runs it.
    validateDefinition(definition, this.registry.area(definition.subjectArea));
  }

  async createDraft(
    viewer: DefinitionViewer,
    dto: CreateReportDefinitionDto,
  ): Promise<ReportDefinition> {
    this.check(dto.definition);
    const clash = await this.definitions.findOne({
      where: { tenant_id: viewer.tenantId, key: dto.key, deleted_at: IsNull() },
    });
    if (clash) throw new ConflictException('A report with this key already exists.');

    const saved = await this.definitions.save(
      this.definitions.create({
        tenant_id: viewer.tenantId,
        key: dto.key,
        name_en: dto.name_en,
        name_bn: dto.name_bn,
        folder: dto.folder ?? null,
        status: ReportDefinitionStatus.DRAFT,
        visible_roles: dto.visible_roles ?? [],
        draft: dto.definition,
        current_version_id: null,
        system_template_key: null,
        created_by: viewer.userId,
      }),
    );
    await this.record(viewer, AuditAction.CREATE, saved, { key: saved.key });
    return saved;
  }

  async updateDraft(
    viewer: DefinitionViewer,
    id: string,
    dto: UpdateReportDefinitionDto,
  ): Promise<ReportDefinition> {
    const definition = await this.findLive(viewer.tenantId, id);
    if (definition.status === ReportDefinitionStatus.ARCHIVED) {
      throw new ConflictException('An archived report cannot be changed.');
    }
    if (dto.definition) {
      this.check(dto.definition);
      definition.draft = dto.definition;
    }
    if (dto.name_en !== undefined) definition.name_en = dto.name_en;
    if (dto.name_bn !== undefined) definition.name_bn = dto.name_bn;
    if (dto.folder !== undefined) definition.folder = dto.folder;
    if (dto.visible_roles !== undefined) definition.visible_roles = dto.visible_roles;
    const saved = await this.definitions.save(definition);
    await this.record(viewer, AuditAction.UPDATE, saved, { change: 'draft' });
    return saved;
  }

  /**
   * Freezes the draft as the next version (n + 1) and makes it the one people run. The version row is
   * written once and never changes (a trigger enforces it). Runs under a row lock so two people
   * publishing at once get versions 1 and 2, not two version 1s.
   */
  async publish(viewer: DefinitionViewer, id: string): Promise<ReportDefinitionVersion> {
    return this.definitions.manager.transaction(async (m) => {
      const definition = await m
        .getRepository(ReportDefinition)
        .createQueryBuilder('d')
        .setLock('pessimistic_write')
        .where('d.id = :id AND d.tenant_id = :tenantId AND d.deleted_at IS NULL', {
          id,
          tenantId: viewer.tenantId,
        })
        .getOne();
      if (!definition) throw new NotFoundException('Report not found');
      if (definition.status === ReportDefinitionStatus.ARCHIVED) {
        throw new ConflictException('An archived report cannot be published.');
      }
      if (!definition.draft)
        throw new UnprocessableEntityException('There is no draft to publish.');
      this.check(definition.draft);

      const latest = await m
        .getRepository(ReportDefinitionVersion)
        .createQueryBuilder('v')
        .select('COALESCE(MAX(v.version), 0)', 'max')
        .where('v.definition_id = :id AND v.tenant_id = :tenantId', {
          id,
          tenantId: viewer.tenantId,
        })
        .getRawOne<{ max: string }>();
      const version = await m.getRepository(ReportDefinitionVersion).save(
        m.getRepository(ReportDefinitionVersion).create({
          tenant_id: viewer.tenantId,
          definition_id: definition.id,
          version: Number(latest?.max ?? 0) + 1,
          definition: definition.draft,
          schema_version: REPORT_DEFINITION_SCHEMA_VERSION,
          published_by: viewer.userId,
        }),
      );
      definition.current_version_id = version.id;
      definition.status = ReportDefinitionStatus.PUBLISHED;
      await m.getRepository(ReportDefinition).save(definition);
      await this.record(
        viewer,
        AuditAction.UPDATE,
        definition,
        { change: 'published', version: version.version },
        m,
      );
      return version;
    });
  }

  async archive(viewer: DefinitionViewer, id: string): Promise<ReportDefinition> {
    const definition = await this.findLive(viewer.tenantId, id);
    definition.status = ReportDefinitionStatus.ARCHIVED;
    const saved = await this.definitions.save(definition);
    await this.record(viewer, AuditAction.UPDATE, saved, { change: 'archived' });
    return saved;
  }

  /**
   * A new draft from an existing report, your own or a ready one (D12). It copies the draft, or the
   * published version when there is no draft, keeps `system_template_key` so the lineage shows, and
   * takes a free key (`<key>-copy`, `<key>-copy-2`, ...).
   */
  async clone(viewer: DefinitionViewer, id: string): Promise<ReportDefinition> {
    const source = await this.findLive(viewer.tenantId, id);
    let json = source.draft;
    if (!json && source.current_version_id) {
      const version = await this.versions.findOne({
        where: { id: source.current_version_id, tenant_id: viewer.tenantId },
      });
      json = version?.definition ?? null;
    }
    if (!json) throw new UnprocessableEntityException('There is nothing to copy yet.');

    const key = await this.freeKey(viewer.tenantId, `${source.key}-copy`);
    const saved = await this.definitions.save(
      this.definitions.create({
        tenant_id: viewer.tenantId,
        key,
        name_en: `${source.name_en} (copy)`.slice(0, 160),
        name_bn: `${source.name_bn} (কপি)`.slice(0, 160),
        folder: source.folder,
        status: ReportDefinitionStatus.DRAFT,
        visible_roles: [...source.visible_roles],
        draft: json,
        current_version_id: null,
        system_template_key: source.system_template_key,
        created_by: viewer.userId,
      }),
    );
    await this.record(viewer, AuditAction.CREATE, saved, { key, clonedFrom: source.key });
    return saved;
  }

  /**
   * A school made before the ready-made reports shipped has none yet: put them in on first look (D12).
   * One lookup when they are there; a second caller racing us hits the unique key and loses harmlessly.
   */
  private async ensureSystemReports(tenantId: string): Promise<void> {
    const has = await this.definitions
      .createQueryBuilder('d')
      .withDeleted()
      .where('d.tenant_id = :tenantId AND d.system_template_key IS NOT NULL', { tenantId })
      .getExists();
    if (has) return;
    try {
      await seedSystemReports(this.definitions.manager, tenantId, null);
    } catch (e) {
      if ((e as { code?: string }).code !== '23505') throw e;
    }
  }

  /** What this role may run: published reports whose roles include theirs, grouped by folder. */
  async catalogue(viewer: DefinitionViewer): Promise<CatalogueFolderDto[]> {
    await this.ensureSystemReports(viewer.tenantId);
    const qb = this.definitions
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId AND d.deleted_at IS NULL', { tenantId: viewer.tenantId })
      .andWhere('d.status = :status', { status: ReportDefinitionStatus.PUBLISHED })
      .andWhere('d.current_version_id IS NOT NULL');
    if (!SEES_ALL.has(viewer.role)) {
      // An empty list means every role that can open reports.
      qb.andWhere('(cardinality(d.visible_roles) = 0 OR :role = ANY(d.visible_roles))', {
        role: viewer.role,
      });
    }
    const rows = await qb
      .orderBy('d.folder', 'ASC', 'NULLS FIRST')
      .addOrderBy('d.name_en', 'ASC')
      .getMany();

    const folders = new Map<string | null, CatalogueFolderDto>();
    for (const d of rows) {
      const folder = folders.get(d.folder) ?? { folder: d.folder, reports: [] };
      folder.reports.push({
        id: d.id,
        key: d.key,
        name_en: d.name_en,
        name_bn: d.name_bn,
        version_id: d.current_version_id as string,
        system_template_key: d.system_template_key,
      });
      folders.set(d.folder, folder);
    }
    return [...folders.values()];
  }

  /** Every report of the school for the designer, newest first, with its latest version number. */
  async list(tenantId: string, status?: ReportDefinitionStatus) {
    const qb = this.definitions
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId AND d.deleted_at IS NULL', { tenantId })
      .orderBy('d.updated_at', 'DESC');
    if (status) qb.andWhere('d.status = :status', { status });
    const rows = await qb.getMany();
    const numbers = await this.latestVersionNumbers(
      tenantId,
      rows.map((r) => r.id),
    );
    return rows.map((d) => ({ ...d, version: numbers.get(d.id) ?? null }));
  }

  async get(tenantId: string, id: string) {
    const definition = await this.findLive(tenantId, id);
    const numbers = await this.latestVersionNumbers(tenantId, [id]);
    return { ...definition, version: numbers.get(id) ?? null };
  }

  /** A tenant-scoped, not-deleted report, or 404. Never says whether another school has the id. */
  async findLive(tenantId: string, id: string): Promise<ReportDefinition> {
    const definition = await this.definitions.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!definition) throw new NotFoundException('Report not found');
    return definition;
  }

  private async latestVersionNumbers(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.versions
      .createQueryBuilder('v')
      .select('v.definition_id', 'id')
      .addSelect('MAX(v.version)', 'max')
      .where('v.tenant_id = :tenantId AND v.definition_id IN (:...ids)', { tenantId, ids })
      .groupBy('v.definition_id')
      .getRawMany<{ id: string; max: string }>();
    return new Map(rows.map((r) => [r.id, Number(r.max)]));
  }

  private async freeKey(tenantId: string, base: string): Promise<string> {
    for (let n = 1; ; n++) {
      const key = n === 1 ? base : `${base}-${n}`;
      const taken = await this.definitions.exists({
        where: { tenant_id: tenantId, key, deleted_at: IsNull() },
      });
      if (!taken) return key;
    }
  }

  private record(
    viewer: DefinitionViewer,
    action: AuditAction,
    definition: ReportDefinition,
    detail: Record<string, unknown>,
    manager?: EntityManager,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        entity_type: 'ReportDefinition',
        entity_id: definition.id,
        tenant_id: viewer.tenantId,
        performed_by_user_id: viewer.userId,
        // The audit trail says what happened, never the definition itself.
        new_values: { status: definition.status, ...detail },
      },
      manager,
    );
  }
}
