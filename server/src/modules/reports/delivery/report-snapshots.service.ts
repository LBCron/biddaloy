import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { IsNull, Repository } from 'typeorm';
import {
  AuditAction,
  ExportFormat,
  ReportRunKind,
  ReportRunStatus,
  type UserRole,
} from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { SchoolsService } from '../../schools/schools.service';
import { StorageService } from '../../storage/storage.service';
import { tenantObjectKeyNamed } from '../../storage/storage-key';
import { DEFINITION_SOURCE } from '../engine/runner/definition-row-source';
import { ReportDefinitionVersion } from '../entities/report-definition-version.entity';
import { ReportDefinition } from '../entities/report-definition.entity';
import { ReportRun } from '../entities/report-run.entity';
import { ReportSnapshot } from '../entities/report-snapshot.entity';
import { ReportExportProcessor } from '../export/report-export.processor';
import { ReportRunLogService } from '../export/report-run-log.service';
import type {
  CreateReportSnapshotDto,
  ListReportSnapshotsQueryDto,
  ReportSnapshotDto,
  ReportSnapshotPageDto,
} from './dto/report-delivery.dto';
import { SEES_ALL, roleMayDownloadReports, roleMaySeeDefinition } from './report-schedules.service';

export interface SnapshotViewer {
  tenantId: string;
  userId: string;
  role: string;
}

const CONTENT_TYPE: Record<ExportFormat, string> = {
  [ExportFormat.CSV]: 'text/csv; charset=utf-8',
  [ExportFormat.XLSX]: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * [8.15.44] "Keep today's copy" (Epic 8.15 D3, D8). A snapshot is a stored file of one of your runs,
 * dated by `as_of`. It is a COPY of the bytes under its own key (`tenants/<tenant>/report-snapshots/<id>.<ext>`),
 * so the daily export cleanup, which only deletes the run's file, never touches it, and it never expires.
 * Snapshots are read-only: there is no update and no delete here.
 *
 * Who may read one (re-checked on every list and every download, never remembered):
 * the role can take files out (REPORTS_EXPORT), the report is still visible to the role, and the
 * person made the copy or is ADMIN. The file was built with its maker's rights, so a narrower role
 * (an accountant, a committee member) must never receive an admin's copy.
 */
@Injectable()
export class ReportSnapshotsService {
  constructor(
    @InjectRepository(ReportSnapshot) private readonly snapshots: Repository<ReportSnapshot>,
    @InjectRepository(ReportRun) private readonly runs: Repository<ReportRun>,
    @InjectRepository(ReportDefinitionVersion)
    private readonly versions: Repository<ReportDefinitionVersion>,
    @InjectRepository(ReportDefinition) private readonly definitions: Repository<ReportDefinition>,
    private readonly storage: StorageService,
    private readonly exporter: ReportExportProcessor,
    private readonly runLog: ReportRunLogService,
    private readonly schools: SchoolsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Keeps one of the caller's own runs. A run that still has its file (a finished queued export or
   * scheduled run, within its 24 hours) is copied; a run with no file (a screen run) is written again
   * now, with the same answers, for the caller's own role.
   */
  async freeze(
    viewer: SnapshotViewer,
    runId: string,
    dto: CreateReportSnapshotDto,
  ): Promise<ReportSnapshotDto> {
    if (!roleMayDownloadReports(viewer.role)) throw new NotFoundException('Run not found');
    const run = await this.runs.findOne({
      where: { id: runId, tenant_id: viewer.tenantId, run_by: viewer.userId },
    });
    if (!run) throw new NotFoundException('Run not found');

    const versionId = this.versionOf(run);
    if (!versionId) throw new UnprocessableEntityException('This run cannot be kept.');
    const version = await this.versions.findOne({
      where: { id: versionId, tenant_id: viewer.tenantId },
    });
    const definition = version
      ? await this.definitions.findOne({
          where: { id: version.definition_id, tenant_id: viewer.tenantId, deleted_at: IsNull() },
        })
      : null;
    // The same answer for a run of a report you may not see: it is not yours to keep.
    if (!version || !definition || !roleMaySeeDefinition(definition, viewer.role, true)) {
      throw new NotFoundException('Run not found');
    }

    const asOf = await this.checkAsOf(viewer.tenantId, dto.as_of);
    const source = await this.fileOf(viewer, run, version.id);
    const id = randomUUID();
    const format = source.format;
    const key = tenantObjectKeyNamed(
      viewer.tenantId,
      'report-snapshots',
      id,
      format === ExportFormat.XLSX ? 'xlsx' : 'csv',
    );
    await this.copy(source.storageKey, key, viewer.tenantId, format);
    try {
      const saved = await this.snapshots.save(
        this.snapshots.create({
          id,
          tenant_id: viewer.tenantId,
          run_id: run.id,
          definition_version_id: version.id,
          as_of: asOf,
          label: (dto.label?.trim() || `${definition.name_en} ${asOf}`).slice(0, 160),
          storage_key: key,
          row_count: source.rowCount,
          created_by: viewer.userId,
        }),
      );
      await this.audit.record({
        action: AuditAction.CREATE,
        // `ReportSnapshot` is not an audit entity type; the entry hangs on the run that was kept.
        entity_type: 'ReportRun',
        entity_id: run.id,
        tenant_id: viewer.tenantId,
        performed_by_user_id: viewer.userId,
        // Says that a copy was kept, never what is in it.
        new_values: {
          change: 'snapshot',
          snapshot_id: saved.id,
          as_of: asOf,
          format,
          row_count: saved.row_count,
        },
      });
      return this.toDto(saved, definition);
    } catch (error) {
      // No row points at the copy, so nothing could ever delete it: remove it now.
      await this.storage.deleteForTenant(key, viewer.tenantId).catch(() => undefined);
      throw error;
    }
  }

  /** Snapshots the caller may download, newest first. */
  async list(
    viewer: SnapshotViewer,
    query: ListReportSnapshotsQueryDto,
  ): Promise<ReportSnapshotPageDto> {
    const limit = Math.min(query.limit ?? 20, 100);
    const offset = query.offset ?? 0;
    if (!roleMayDownloadReports(viewer.role)) return { items: [], limit, offset, has_more: false };

    const qb = this.snapshots
      .createQueryBuilder('s')
      .innerJoin(
        ReportDefinitionVersion,
        'v',
        'v.id = s.definition_version_id AND v.tenant_id = s.tenant_id',
      )
      .innerJoinAndMapOne(
        's.d',
        ReportDefinition,
        'd',
        'd.id = v.definition_id AND d.tenant_id = s.tenant_id AND d.deleted_at IS NULL',
      )
      .where('s.tenant_id = :tenantId', { tenantId: viewer.tenantId });
    if (!SEES_ALL.has(viewer.role)) {
      qb.andWhere('s.created_by = :userId', { userId: viewer.userId });
      qb.andWhere('(cardinality(d.visible_roles) = 0 OR :role = ANY(d.visible_roles))', {
        role: viewer.role,
      });
    }
    const rows = await qb
      .orderBy('s.created_at', 'DESC')
      .addOrderBy('s.id', 'ASC')
      .skip(offset)
      .take(limit + 1)
      .getMany();
    const items = rows
      .slice(0, limit)
      .map((s) => this.toDto(s, (s as unknown as { d: ReportDefinition }).d));
    return { items, limit, offset, has_more: rows.length > limit };
  }

  /** The kept file, or a plain 404 for every reason (not yours, not visible any more, another school). */
  async download(viewer: SnapshotViewer, id: string): Promise<StreamableFile> {
    const snapshot = await this.snapshots.findOne({ where: { id, tenant_id: viewer.tenantId } });
    const version = snapshot
      ? await this.versions.findOne({
          where: { id: snapshot.definition_version_id, tenant_id: viewer.tenantId },
        })
      : null;
    const definition = version
      ? await this.definitions.findOne({
          where: { id: version.definition_id, tenant_id: viewer.tenantId, deleted_at: IsNull() },
        })
      : null;
    if (
      !snapshot ||
      !definition ||
      !roleMayDownloadReports(viewer.role) ||
      !roleMaySeeDefinition(definition, viewer.role, false) ||
      !(SEES_ALL.has(viewer.role) || snapshot.created_by === viewer.userId)
    ) {
      throw new NotFoundException('Snapshot not found');
    }
    const format = snapshot.storage_key.endsWith('.xlsx') ? ExportFormat.XLSX : ExportFormat.CSV;
    const stored = await this.storage.getForTenant(snapshot.storage_key, viewer.tenantId);
    return new StreamableFile(stored.body, {
      type: stored.contentType ?? CONTENT_TYPE[format],
      disposition: `attachment; filename="snapshot-${snapshot.id}.${format === ExportFormat.XLSX ? 'xlsx' : 'csv'}"`,
    });
  }

  /** The published version a run belongs to: its own, or the one saved with a queued definition export. */
  private versionOf(run: ReportRun): string | null {
    if (run.definition_version_id) return run.definition_version_id;
    const saved = run.params?.versionId;
    return run.source_key === DEFINITION_SOURCE && typeof saved === 'string' ? saved : null;
  }

  /** A run's stored file while it lasts; otherwise a new file made now for the caller's own role. */
  private async fileOf(viewer: SnapshotViewer, run: ReportRun, versionId: string) {
    const lasts =
      run.status === ReportRunStatus.DONE &&
      run.storage_key &&
      run.expires_at &&
      run.expires_at.getTime() > Date.now();
    if (lasts) {
      return {
        storageKey: run.storage_key as string,
        format: run.format ?? ExportFormat.XLSX,
        rowCount: run.row_count,
      };
    }
    const format = run.format ?? ExportFormat.XLSX;
    const saved = run.params?.params;
    const answers =
      run.source_key === DEFINITION_SOURCE && saved && typeof saved === 'object'
        ? (saved as Record<string, unknown>)
        : (run.params ?? {});
    const query = { versionId, role: viewer.role as UserRole, params: answers };
    const fresh = await this.runLog.start({
      tenantId: viewer.tenantId,
      userId: viewer.userId,
      kind: ReportRunKind.SNAPSHOT,
      status: ReportRunStatus.QUEUED,
      sourceKey: DEFINITION_SOURCE,
      definitionVersionId: versionId,
      format,
      params: query,
    });
    await this.exporter.process({
      data: {
        runId: fresh.id,
        tenantId: viewer.tenantId,
        userId: viewer.userId,
        source: DEFINITION_SOURCE,
        query,
        format,
      },
    } as Job);
    const done = await this.runs.findOne({ where: { id: fresh.id, tenant_id: viewer.tenantId } });
    if (done?.status !== ReportRunStatus.DONE || !done.storage_key) {
      throw new UnprocessableEntityException('This run cannot be kept right now.');
    }
    return { storageKey: done.storage_key, format, rowCount: done.row_count };
  }

  /** Copies the stored bytes to the snapshot's own key through a temp file (memory stays flat). */
  private async copy(
    from: string,
    to: string,
    tenantId: string,
    format: ExportFormat,
  ): Promise<void> {
    const stored = await this.storage.getForTenant(from, tenantId);
    const temp = join(tmpdir(), `report-snapshot-${randomUUID()}`);
    try {
      await pipeline(stored.body, createWriteStream(temp));
      const { size } = await stat(temp);
      await this.storage.putStream(to, createReadStream(temp), size, CONTENT_TYPE[format]);
    } finally {
      await rm(temp, { force: true });
    }
  }

  /** A real calendar date, not after the school's today. Default: today. */
  private async checkAsOf(tenantId: string, asOf: string | undefined): Promise<string> {
    const today = await this.schools.todayFor(tenantId);
    if (asOf === undefined) return today;
    const real = new Date(`${asOf}T00:00:00Z`);
    if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== asOf || asOf > today) {
      throw new BadRequestException('as_of must be a real date, not in the future.');
    }
    return asOf;
  }

  private toDto(s: ReportSnapshot, d: ReportDefinition): ReportSnapshotDto {
    return {
      id: s.id,
      definition_id: d.id,
      name_en: d.name_en,
      name_bn: d.name_bn,
      as_of: s.as_of,
      label: s.label,
      row_count: s.row_count,
      created_at: s.created_at.toISOString(),
    };
  }
}
