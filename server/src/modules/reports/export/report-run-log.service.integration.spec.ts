import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditAction, ExportFormat, ReportRunKind, ReportRunStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { ReportRun } from '../entities/report-run.entity';
import { ReportRunLogService } from './report-run-log.service';

/**
 * [8.15.10] Every export leaves one `report_runs` row and one audit entry
 * (D8). Real DB, real AuditService: the audit row must exist and must never
 * carry row data.
 */
describe('ReportRunLogService (integration)', () => {
  let ds: DataSource;
  let service: ReportRunLogService;
  let tenantA: string;
  let tenantB: string;

  const newSchool = async (): Promise<string> => {
    const rows = await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Run Log ${randomUUID()}`,
      `run-log-${randomUUID()}`,
    ]);
    return rows[0].id as string;
  };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [ReportRunLogService, AuditService]);
    ds = module.get(DataSource);
    service = module.get(ReportRunLogService);
    tenantA = await newSchool();
    tenantB = await newSchool();
  });

  afterAll(async () => {
    // audit_logs is append-only and blocks deleting its schools; the test-database reset clears them.
    await ds.destroy();
  });

  const startExport = (tenantId: string, format: ExportFormat = ExportFormat.CSV) =>
    service.start({
      tenantId,
      userId: null,
      kind: ReportRunKind.EXPORT,
      sourceKey: 'students-list',
      format,
    });

  it('writes a run row and one audit entry without row data when an export finishes', async () => {
    const run = await startExport(tenantA);
    await service.finish(tenantA, run.id, { rowCount: 42, durationMs: 15 });

    const saved = await ds.getRepository(ReportRun).findOneByOrFail({ id: run.id });
    expect(saved.status).toBe(ReportRunStatus.DONE);
    expect(saved.row_count).toBe(42);

    const audits = await ds.getRepository(AuditLog).find({ where: { entity_id: run.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe(AuditAction.REPORT_EXPORT);
    // Only the format and counts are audited, never the rows themselves.
    expect(audits[0].new_values).toEqual({ format: 'CSV', row_count: 42, source: 'students-list' });
  });

  it('stores the error code and writes no audit entry when a run fails', async () => {
    const run = await startExport(tenantA, ExportFormat.XLSX);
    await service.fail(tenantA, run.id, 'EXPORT_WRITE_FAILED');

    const saved = await ds.getRepository(ReportRun).findOneByOrFail({ id: run.id });
    expect(saved.status).toBe(ReportRunStatus.FAILED);
    expect(saved.error_code).toBe('EXPORT_WRITE_FAILED');
    expect(await ds.getRepository(AuditLog).count({ where: { entity_id: run.id } })).toBe(0);
  });

  it("cannot finish or fail another school's run", async () => {
    const run = await startExport(tenantA);

    await service.finish(tenantB, run.id, { rowCount: 1, durationMs: 1 });
    await service.fail(tenantB, run.id, 'EXPORT_WRITE_FAILED');

    const saved = await ds.getRepository(ReportRun).findOneByOrFail({ id: run.id });
    expect(saved.status).toBe(ReportRunStatus.RUNNING);
    expect(await ds.getRepository(AuditLog).count({ where: { entity_id: run.id } })).toBe(0);
  });
});
