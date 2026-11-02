import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction, type ExportFormat, ReportRunKind, ReportRunStatus } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { ReportRun } from '../entities/report-run.entity';

export interface StartRunInput {
  tenantId: string;
  userId: string | null;
  kind: ReportRunKind;
  /** Coded source (`students-list`) when there is no published definition. */
  sourceKey?: string | null;
  definitionVersionId?: string | null;
  format?: ExportFormat | null;
  params?: Record<string, unknown>;
  /** QUEUED for a job waiting in the queue; RUNNING (default) for work that starts now. */
  status?: ReportRunStatus;
}

/**
 * [8.15.10] Writes the `report_runs` row for every run and export (D8) and,
 * for exports, one audit entry carrying the format and row count, never the
 * rows. Every method is tenant-scoped: a run id from another school is a no-op.
 */
@Injectable()
export class ReportRunLogService {
  constructor(
    @InjectRepository(ReportRun) private readonly runs: Repository<ReportRun>,
    private readonly audit: AuditService,
  ) {}

  async start(input: StartRunInput): Promise<ReportRun> {
    return this.runs.save(
      this.runs.create({
        tenant_id: input.tenantId,
        run_by: input.userId,
        kind: input.kind,
        status: input.status ?? ReportRunStatus.RUNNING,
        source_key: input.sourceKey ?? null,
        definition_version_id: input.definitionVersionId ?? null,
        format: input.format ?? null,
        params: input.params ?? {},
      }),
    );
  }

  async finish(
    tenantId: string,
    runId: string,
    result: {
      rowCount: number;
      durationMs: number;
      /** A queued export's stored file and when it stops being downloadable. */
      storageKey?: string;
      expiresAt?: Date;
    },
  ): Promise<void> {
    const run = await this.runs.findOne({ where: { id: runId, tenant_id: tenantId } });
    if (!run) return;
    run.status = ReportRunStatus.DONE;
    run.row_count = result.rowCount;
    run.duration_ms = result.durationMs;
    if (result.storageKey) run.storage_key = result.storageKey;
    if (result.expiresAt) run.expires_at = result.expiresAt;
    await this.runs.save(run);
    if (run.kind === ReportRunKind.EXPORT) {
      await this.audit.record({
        action: AuditAction.REPORT_EXPORT,
        entity_type: 'ReportRun',
        entity_id: run.id,
        tenant_id: tenantId,
        performed_by_user_id: run.run_by,
        new_values: { format: run.format, row_count: run.row_count, source: run.source_key },
      });
    }
  }

  async fail(tenantId: string, runId: string, errorCode: string): Promise<void> {
    await this.runs.update(
      { id: runId, tenant_id: tenantId },
      { status: ReportRunStatus.FAILED, error_code: errorCode.slice(0, 40) },
    );
  }
}
