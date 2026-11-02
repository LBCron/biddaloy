import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExportFormat, ReportRunKind, ReportRunStatus } from '@biddaloy/shared';
import { ReportRunLogService } from './report-run-log.service';

export const REPORT_EXPORT_QUEUE = 'report-export';
export const REPORT_EXPORT_CLEANUP_QUEUE = 'report-export-cleanup';
export const REPORT_EXPORT_JOB = 'export';

/** D8: the file can be downloaded for a day. */
export const EXPORT_FILE_TTL_MS = 24 * 60 * 60 * 1000;
/** D20: the most rows one queued export writes. */
export const QUEUED_EXPORT_MAX_ROWS = 200_000;
/** How long `enqueue` waits for Redis before it gives up (a down Redis would otherwise hang forever). */
export const ENQUEUE_TIMEOUT_MS = 3_000;

export interface ReportExportJobData {
  runId: string;
  tenantId: string;
  userId: string;
  /** Row source name, e.g. `students-list`. */
  source: string;
  query: Record<string, unknown>;
  format: ExportFormat;
}

/** D16: Redis is down, so a queued export cannot start. Small exports still work. */
export class ExportQueueUnavailableError extends Error {
  readonly code = 'EXPORT_QUEUE_UNAVAILABLE';
  constructor() {
    super('Large downloads are not available right now. Narrow the filters or try again later.');
    this.name = 'ExportQueueUnavailableError';
  }
}

export interface EnqueueExportInput {
  tenantId: string;
  userId: string;
  source: string;
  query: Record<string, unknown>;
  format: ExportFormat;
}

/**
 * [8.15.16] Starts a queued export: writes the QUEUED `report_runs` row, then hands the job to
 * BullMQ. The row comes first, so a job always has a run to report progress on. If Redis does
 * not answer in time the run is marked FAILED and the caller gets `ExportQueueUnavailableError`
 * (fails closed, D16).
 */
@Injectable()
export class ReportExportQueue {
  constructor(
    @InjectQueue(REPORT_EXPORT_QUEUE) private readonly queue: Queue<ReportExportJobData>,
    private readonly runLog: ReportRunLogService,
  ) {}

  async enqueue(input: EnqueueExportInput): Promise<string> {
    const run = await this.runLog.start({
      tenantId: input.tenantId,
      userId: input.userId,
      kind: ReportRunKind.EXPORT,
      status: ReportRunStatus.QUEUED,
      sourceKey: input.source,
      format: input.format,
      params: input.query,
    });
    try {
      await withTimeout(
        this.queue.add(REPORT_EXPORT_JOB, { ...input, runId: run.id }, { jobId: run.id }),
        ENQUEUE_TIMEOUT_MS,
      );
    } catch {
      await this.runLog.fail(input.tenantId, run.id, 'QUEUE_UNAVAILABLE');
      throw new ExportQueueUnavailableError();
    }
    return run.id;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
