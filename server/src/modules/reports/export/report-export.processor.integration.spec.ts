import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { ExportFormat, ReportRunKind, ReportRunStatus } from '@biddaloy/shared';
import { SEED_ADMIN_USER_ID } from '@test/constants';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { PushService } from '../../push/push.service';
import { StorageService } from '../../storage/storage.service';
import { ReportRun } from '../entities/report-run.entity';
import { ReportExportCleanupProcessor } from './report-export-cleanup.processor';
import { ReportExportProcessor } from './report-export.processor';
import {
  ExportQueueUnavailableError,
  QUEUED_EXPORT_MAX_ROWS,
  REPORT_EXPORT_CLEANUP_QUEUE,
  REPORT_EXPORT_QUEUE,
  ReportExportQueue,
} from './report-export.queue';
import { ReportExportService } from './report-export.service';
import { ReportRowSourceRegistry } from './report-row-sources';
import { ReportRunLogService } from './report-run-log.service';

/**
 * [8.15.16] Queued exports against the real database, with an in-memory stand-in for object
 * storage, the push service and the queue. Business rules proved here: a large export lands in
 * storage with a 24-hour expiry and the user is told; an expired file is removed; a run can
 * only be touched by its own school; and a Redis outage fails the queue while small exports
 * keep working (D16).
 */
describe('queued report exports (integration)', () => {
  let ds: DataSource;
  let processor: ReportExportProcessor;
  let cleanup: ReportExportCleanupProcessor;
  let queue: ReportExportQueue;
  let sources: ReportRowSourceRegistry;
  let runLog: ReportRunLogService;
  let exportService: ReportExportService;
  let tenantId: string;
  let otherTenantId: string;

  const stored = new Map<string, Buffer>();
  const failDeletes = new Set<string>();
  const storage = {
    putStream: vi.fn(async (key: string, body: Readable, length: number) => {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.from(c as Buffer));
      const buffer = Buffer.concat(chunks);
      expect(buffer.length).toBe(length); // the declared length is the real file size
      stored.set(key, buffer);
    }),
    deleteForTenant: vi.fn(async (key: string) => {
      if (failDeletes.has(key)) throw new Error('storage down');
      stored.delete(key);
    }),
  };
  const push = { sendToUser: vi.fn().mockResolvedValue({ accepted: 1, transient: 0, pruned: 0 }) };
  const fakeQueue = { add: vi.fn().mockResolvedValue({}), upsertJobScheduler: vi.fn() };

  const newSchool = async (): Promise<string> => {
    const rows = await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Queue ${randomUUID()}`,
      `queue-${randomUUID()}`,
    ]);
    return rows[0].id as string;
  };

  async function* manyRows(n: number): AsyncGenerator<unknown[]> {
    for (let i = 0; i < n; i++) yield [`s${i}`, 'নোট'];
  }

  const queuedRun = (source = 'test-list', format: ExportFormat = ExportFormat.CSV) =>
    runLog.start({
      tenantId,
      userId: null,
      kind: ReportRunKind.EXPORT,
      status: ReportRunStatus.QUEUED,
      sourceKey: source,
      format,
    });

  const job = (runId: string, over: Record<string, unknown> = {}) =>
    ({
      data: {
        runId,
        tenantId,
        userId: 'user-1',
        source: 'test-list',
        query: {},
        format: ExportFormat.CSV,
        ...over,
      },
    }) as never;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      AuditService,
      ReportRunLogService,
      ReportRowSourceRegistry,
      ReportExportService,
      ReportExportQueue,
      ReportExportProcessor,
      ReportExportCleanupProcessor,
      { provide: StorageService, useValue: storage },
      { provide: PushService, useValue: push },
      { provide: getQueueToken(REPORT_EXPORT_QUEUE), useValue: fakeQueue },
      { provide: getQueueToken(REPORT_EXPORT_CLEANUP_QUEUE), useValue: fakeQueue },
    ]);
    ds = module.get(DataSource);
    processor = module.get(ReportExportProcessor);
    cleanup = module.get(ReportExportCleanupProcessor);
    queue = module.get(ReportExportQueue);
    sources = module.get(ReportRowSourceRegistry);
    runLog = module.get(ReportRunLogService);
    exportService = module.get(ReportExportService);
    tenantId = await newSchool();
    otherTenantId = await newSchool();
  });

  beforeEach(() => {
    stored.clear();
    failDeletes.clear();
    vi.clearAllMocks();
    fakeQueue.add.mockResolvedValue({});
    sources.register('test-list', { header: () => ['Name', 'Note'], rows: () => manyRows(12_000) });
  });

  afterAll(async () => {
    // Schools and runs are cleared by the suite's own per-file reset; audit rows are append-only.
    await ds.destroy();
  });

  describe('the processor', () => {
    it('writes a 12,000-row CSV to storage under the school, sets a 24-hour expiry and tells the user', async () => {
      const run = await queuedRun();
      await processor.process(job(run.id));

      const saved = await ds.getRepository(ReportRun).findOneByOrFail({ id: run.id });
      expect(saved.status).toBe(ReportRunStatus.DONE);
      expect(saved.row_count).toBe(12_000);
      expect(saved.storage_key).toMatch(new RegExp(`^tenants/${tenantId}/reports/.+\\.csv$`));
      const hours = ((saved.expires_at as Date).getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThanOrEqual(24);

      // The file is readable and complete: BOM once, header, every row, Bangla intact.
      const text = (stored.get(saved.storage_key as string) as Buffer).toString('utf8');
      expect(text.split('﻿')).toHaveLength(2);
      expect(text.trimEnd().split('\r\n')).toHaveLength(12_001);
      expect(text).toContain('"s11999","নোট"');

      expect(push.sendToUser).toHaveBeenCalledTimes(1);
      expect(push.sendToUser.mock.calls[0].slice(0, 2)).toEqual(['user-1', tenantId]);
      // The temp file is gone once the upload is done.
      expect(existsSync(join(tmpdir(), `report-export-${run.id}.csv`))).toBe(false);
    });

    it('writes an XLSX that exceljs can read back', async () => {
      sources.register('test-list', { header: () => ['Name', 'Note'], rows: () => manyRows(600) });
      const run = await queuedRun('test-list', ExportFormat.XLSX);
      await processor.process(job(run.id, { format: ExportFormat.XLSX }));

      const saved = await ds.getRepository(ReportRun).findOneByOrFail({ id: run.id });
      expect(saved.status).toBe(ReportRunStatus.DONE);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        stored.get(saved.storage_key as string) as unknown as ExcelJS.Buffer,
      );
      const sheet = workbook.worksheets[0];
      expect(sheet.rowCount).toBe(601);
      expect(sheet.getRow(601).values).toEqual([undefined, 's599', 'নোট']);
    });

    it('fails a run for a source it does not know', async () => {
      const run = await queuedRun('gone-list');
      await processor.process(job(run.id, { source: 'gone-list' }));
      const saved = await ds.getRepository(ReportRun).findOneByOrFail({ id: run.id });
      expect(saved.status).toBe(ReportRunStatus.FAILED);
      expect(saved.error_code).toBe('UNKNOWN_SOURCE');
    });

    it('marks the run FAILED and stores nothing when reading rows fails halfway', async () => {
      sources.register('test-list', {
        header: () => ['Name'],
        rows: async function* () {
          yield ['a'];
          throw new Error('database went away');
        },
      });
      const run = await queuedRun();
      await processor.process(job(run.id));

      const saved = await ds.getRepository(ReportRun).findOneByOrFail({ id: run.id });
      expect(saved.status).toBe(ReportRunStatus.FAILED);
      expect(saved.error_code).toBe('EXPORT_FAILED');
      expect(stored.size).toBe(0);
      expect(push.sendToUser).not.toHaveBeenCalled();
      expect(existsSync(join(tmpdir(), `report-export-${run.id}.csv`))).toBe(false);
    });

    it('refuses more than 200,000 rows (D20) and stores nothing', async () => {
      sources.register('test-list', {
        header: () => ['n'],
        rows: async function* () {
          for (let i = 0; i <= QUEUED_EXPORT_MAX_ROWS; i++) yield [i];
        },
      });
      const run = await queuedRun();
      await processor.process(job(run.id));

      const saved = await ds.getRepository(ReportRun).findOneByOrFail({ id: run.id });
      expect(saved.status).toBe(ReportRunStatus.FAILED);
      expect(saved.error_code).toBe('EXPORT_TOO_LARGE');
      expect(stored.size).toBe(0);
    }, 60_000);

    it('a job carrying another school’s id cannot touch the run', async () => {
      const run = await queuedRun();
      await processor.process(job(run.id, { tenantId: otherTenantId }));

      const saved = await ds.getRepository(ReportRun).findOneByOrFail({ id: run.id });
      expect(saved.status).toBe(ReportRunStatus.QUEUED);
      expect(stored.size).toBe(0);
    });

    it('does nothing for a run that is not waiting in the queue any more', async () => {
      const run = await queuedRun();
      await processor.process(job(run.id));
      stored.clear();
      await processor.process(job(run.id)); // a duplicate delivery of the same job
      expect(stored.size).toBe(0);
    });
  });

  describe('the cleanup', () => {
    const doneRun = async (expiresAt: Date) => {
      const run = await queuedRun();
      const key = `tenants/${tenantId}/reports/${randomUUID()}.csv`;
      stored.set(key, Buffer.from('x'));
      await ds
        .getRepository(ReportRun)
        .update(
          { id: run.id },
          { status: ReportRunStatus.DONE, storage_key: key, expires_at: expiresAt },
        );
      return { id: run.id, key };
    };

    it('deletes the file of an expired export and marks the run EXPIRED', async () => {
      const expired = await doneRun(new Date(Date.now() - 1000));
      const fresh = await doneRun(new Date(Date.now() + 3_600_000));

      await cleanup.cleanExpired(new Date());

      const expiredRun = await ds.getRepository(ReportRun).findOneByOrFail({ id: expired.id });
      expect(expiredRun.status).toBe(ReportRunStatus.EXPIRED);
      expect(expiredRun.storage_key).toBeNull();
      expect(stored.has(expired.key)).toBe(false);

      // An export still inside its 24 hours is left alone.
      const freshRun = await ds.getRepository(ReportRun).findOneByOrFail({ id: fresh.id });
      expect(freshRun.status).toBe(ReportRunStatus.DONE);
      expect(stored.has(fresh.key)).toBe(true);
    });

    it('keeps the run DONE when the file cannot be deleted, so the next day tries again', async () => {
      const stuck = await doneRun(new Date(Date.now() - 1000));
      failDeletes.add(stuck.key);

      await cleanup.cleanExpired(new Date());

      const run = await ds.getRepository(ReportRun).findOneByOrFail({ id: stuck.id });
      expect(run.status).toBe(ReportRunStatus.DONE);
      expect(run.storage_key).toBe(stuck.key);
    });
  });

  describe('the queue (D16: Redis down fails closed)', () => {
    it('enqueue writes a QUEUED run and hands the job over under the run id', async () => {
      const runId = await queue.enqueue({
        tenantId,
        userId: SEED_ADMIN_USER_ID,
        source: 'test-list',
        query: { section_id: 'x' },
        format: ExportFormat.CSV,
      });

      const saved = await ds.getRepository(ReportRun).findOneByOrFail({ id: runId });
      expect(saved.status).toBe(ReportRunStatus.QUEUED);
      expect(fakeQueue.add).toHaveBeenCalledWith(
        'export',
        expect.objectContaining({ runId, tenantId, source: 'test-list' }),
        { jobId: runId },
      );
    });

    it('with Redis down, enqueue throws and the run is marked FAILED', async () => {
      fakeQueue.add.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

      await expect(
        queue.enqueue({
          tenantId,
          userId: SEED_ADMIN_USER_ID,
          source: 'test-list',
          query: {},
          format: ExportFormat.CSV,
        }),
      ).rejects.toBeInstanceOf(ExportQueueUnavailableError);

      const failed = await ds
        .getRepository(ReportRun)
        .findOneByOrFail({ tenant_id: tenantId, error_code: 'QUEUE_UNAVAILABLE' });
      expect(failed.status).toBe(ReportRunStatus.FAILED);
    });

    it('a small export still works while the queue is down', async () => {
      fakeQueue.add.mockRejectedValue(new Error('redis down'));

      const file = await exportService.export({
        tenantId,
        userId: null,
        kind: ReportRunKind.EXPORT,
        format: ExportFormat.CSV,
        header: ['Name', 'Note'],
        rows: manyRows(3),
        filename: 'small',
      });

      const chunks: Buffer[] = [];
      for await (const c of file.getStream()) chunks.push(Buffer.from(c as Buffer));
      expect(Buffer.concat(chunks).toString('utf8').trimEnd().split('\r\n')).toHaveLength(4);
      // The run is logged when the stream ends; wait for it so no write lands after this test.
      await expect
        .poll(
          async () =>
            (await ds.getRepository(ReportRun).findOneBy({ tenant_id: tenantId }))?.status,
        )
        .toBe(ReportRunStatus.DONE);
    });
  });
});
