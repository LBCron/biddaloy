import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { ReportRunStatus } from '@biddaloy/shared';
import { StorageService } from '../../storage/storage.service';
import { ReportRun } from '../entities/report-run.entity';
import { REPORT_EXPORT_CLEANUP_QUEUE } from './report-export.queue';

const CLEANUP_JOB_ID = 'report-export-cleanup-daily';
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

/**
 * [8.15.16] Once a day, delete the stored file of every export whose 24 hours are up and mark the
 * run EXPIRED. A file that cannot be deleted keeps its run as DONE, so the next day tries again.
 */
@Injectable()
@Processor(REPORT_EXPORT_CLEANUP_QUEUE, { concurrency: 1 })
export class ReportExportCleanupProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ReportExportCleanupProcessor.name);

  constructor(
    @InjectQueue(REPORT_EXPORT_CLEANUP_QUEUE) private readonly queue: Queue,
    @InjectRepository(ReportRun) private readonly runs: Repository<ReportRun>,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Redis being briefly unavailable at boot must not stop the server from starting.
    try {
      await this.queue.upsertJobScheduler(
        CLEANUP_JOB_ID,
        { every: DAY_MS },
        { name: 'cleanup', opts: { removeOnComplete: true, removeOnFail: 20 } },
      );
    } catch (err) {
      this.logger.error(
        `Could not schedule export cleanup: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async process(): Promise<number> {
    return this.cleanExpired(new Date());
  }

  /** Returns how many files were removed. Exposed so a spec can pass in "now". */
  async cleanExpired(now: Date): Promise<number> {
    let removed = 0;
    for (;;) {
      const batch = await this.runs.find({
        where: {
          status: ReportRunStatus.DONE,
          expires_at: LessThan(now),
          storage_key: Not(IsNull()),
        },
        take: BATCH,
      });
      if (batch.length === 0) return removed;
      let progress = 0;
      for (const run of batch) {
        try {
          // Keys written by the processor are `tenants/<tenant>/reports/...`; refuse any other tenant's.
          await this.storage.deleteForTenant(run.storage_key as string, run.tenant_id);
          await this.runs.update(
            { id: run.id, tenant_id: run.tenant_id },
            { status: ReportRunStatus.EXPIRED, storage_key: null },
          );
          removed++;
          progress++;
        } catch (err) {
          this.logger.warn(
            `Could not remove export ${run.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      // A whole batch that failed would loop forever; stop and let tomorrow retry.
      if (progress === 0) return removed;
    }
  }
}
