import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ExportFormat, ReportRunStatus } from '@biddaloy/shared';
import { PushService } from '../../push/push.service';
import { StorageService } from '../../storage/storage.service';
import { tenantObjectKey } from '../../storage/storage-key';
import { CsvStreamWriter } from './csv-stream.writer';
import {
  EXPORT_FILE_TTL_MS,
  QUEUED_EXPORT_MAX_ROWS,
  REPORT_EXPORT_QUEUE,
  type ReportExportJobData,
} from './report-export.queue';
import { ReportRowSourceRegistry } from './report-row-sources';
import { ReportRunLogService } from './report-run-log.service';
import { XlsxStreamWriter } from './xlsx-stream.writer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReportRun } from '../entities/report-run.entity';

const CHUNK_ROWS = 500;
const CONTENT_TYPE: Record<ExportFormat, string> = {
  [ExportFormat.CSV]: 'text/csv; charset=utf-8',
  [ExportFormat.XLSX]: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * [8.15.16] Runs one queued export. Rows go from the list's own query, through the CSV or XLSX
 * writer, into a temp file in chunks (memory stays flat for 200,000 rows), then the file is
 * uploaded and removed. The run row ends DONE with a 24-hour expiry, or FAILED with a code.
 */
@Processor(REPORT_EXPORT_QUEUE, { concurrency: 2 })
export class ReportExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportExportProcessor.name);

  constructor(
    @InjectRepository(ReportRun) private readonly runs: Repository<ReportRun>,
    private readonly sources: ReportRowSourceRegistry,
    private readonly runLog: ReportRunLogService,
    private readonly storage: StorageService,
    private readonly push: PushService,
  ) {
    super();
  }

  async process(job: Job<ReportExportJobData>): Promise<void> {
    const { runId, tenantId, userId, source, query, format } = job.data;
    // The tenant is part of the lookup: a job can never touch another school's run.
    const run = await this.runs.findOne({ where: { id: runId, tenant_id: tenantId } });
    if (!run || run.status !== ReportRunStatus.QUEUED) return;

    const rowSource = this.sources.get(source);
    if (!rowSource) {
      await this.runLog.fail(tenantId, runId, 'UNKNOWN_SOURCE');
      return;
    }

    const startedAt = Date.now();
    await this.runs.update({ id: runId, tenant_id: tenantId }, { status: ReportRunStatus.RUNNING });
    const extension = format === ExportFormat.XLSX ? 'xlsx' : 'csv';
    const tempPath = join(tmpdir(), `report-export-${runId}.${extension}`);

    let uploadedKey: string | undefined;
    try {
      const rowCount = await this.writeFile(tempPath, format, rowSource, tenantId, userId, query);
      const key = tenantObjectKey(tenantId, 'reports', extension);
      const { size } = await stat(tempPath);
      await this.storage.putStream(key, createReadStream(tempPath), size, CONTENT_TYPE[format]);
      uploadedKey = key;
      await this.runLog.finish(tenantId, runId, {
        rowCount,
        durationMs: Date.now() - startedAt,
        storageKey: key,
        expiresAt: new Date(Date.now() + EXPORT_FILE_TTL_MS),
      });
      await this.notify(userId, tenantId);
    } catch (err) {
      const code = err instanceof TooManyRowsError ? 'EXPORT_TOO_LARGE' : 'EXPORT_FAILED';
      this.logger.error(
        `Queued export ${runId} failed: ${err instanceof Error ? err.message : err}`,
      );
      // The cleanup job only sweeps DONE runs, so an object uploaded before the failure would stay forever.
      if (uploadedKey) {
        await this.storage
          .deleteForTenant(uploadedKey, tenantId)
          .catch((e: unknown) =>
            this.logger.warn(
              `Orphaned export ${uploadedKey} not deleted: ${e instanceof Error ? e.message : e}`,
            ),
          );
      }
      // Best effort: with the DB down `fail` throws too, and a worker has no global handler to catch it.
      await this.runLog
        .fail(tenantId, runId, code)
        .catch((e: unknown) =>
          this.logger.error(
            `Export ${runId} not marked failed: ${e instanceof Error ? e.message : e}`,
          ),
        );
    } finally {
      await rm(tempPath, { force: true });
    }
  }

  private async writeFile(
    path: string,
    format: ExportFormat,
    source: NonNullable<ReturnType<ReportRowSourceRegistry['get']>>,
    tenantId: string,
    userId: string,
    query: Record<string, unknown>,
  ): Promise<number> {
    const file = createWriteStream(path);
    const header = await source.header(tenantId, userId, query);
    const xlsx = format === ExportFormat.XLSX ? new XlsxStreamWriter(file, header) : undefined;
    const csv = format === ExportFormat.CSV ? new CsvStreamWriter() : undefined;
    const csvDone = csv
      ? new Promise<void>((resolve, reject) => {
          file.once('finish', resolve);
          csv.once('error', reject);
          file.once('error', reject);
        })
      : undefined;
    // Nothing awaits csvDone until the loop ends; without this a stream error is an unhandled rejection.
    csvDone?.catch(() => undefined);
    csv?.pipe(file);
    csv?.write([header]);

    let count = 0;
    let chunk: unknown[][] = [];
    const flush = () => {
      if (chunk.length === 0) return;
      if (xlsx) xlsx.writeRows(chunk);
      else csv?.write(chunk);
      chunk = [];
    };
    try {
      for await (const row of source.rows(tenantId, userId, query)) {
        if (++count > QUEUED_EXPORT_MAX_ROWS) throw new TooManyRowsError();
        chunk.push(row as unknown[]);
        if (chunk.length >= CHUNK_ROWS) flush();
      }
      flush();
      if (xlsx) await xlsx.finish();
      else {
        csv?.end();
        await csvDone;
      }
      return count;
    } catch (err) {
      // Release the descriptor; the caller removes the file itself.
      csv?.unpipe(file);
      file.destroy();
      throw err;
    }
  }

  private async notify(userId: string, tenantId: string): Promise<void> {
    try {
      await this.push.sendToUser(userId, tenantId, {
        type: 'report-export-ready',
        title: 'Your file is ready',
        body: 'The download is ready for the next 24 hours.',
        url: '/reports',
      });
    } catch (err) {
      // The file is ready either way; a failed notification must not fail the export.
      this.logger.warn(
        `Export-ready notification failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

class TooManyRowsError extends Error {}
