import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../../audit/audit.module';
import { PushModule } from '../../push/push.module';
import { StorageModule } from '../../storage/storage.module';
import { ReportRun } from '../entities/report-run.entity';
import { ReportExportCleanupProcessor } from './report-export-cleanup.processor';
import { ReportExportProcessor } from './report-export.processor';
import {
  REPORT_EXPORT_CLEANUP_QUEUE,
  REPORT_EXPORT_QUEUE,
  ReportExportQueue,
} from './report-export.queue';
import { ReportExportService } from './report-export.service';
import { ReportRowSourceRegistry } from './report-row-sources';
import { ReportRunLogService } from './report-run-log.service';

/**
 * [8.15.10] Streaming CSV/XLSX export plus the run log every export writes; [8.15.16] the queue
 * for exports too large for a request. Global because the six list services and controllers
 * ([8.15.11]) use it, and `AuditModule`, which one of them lives in, is itself imported here.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([ReportRun]),
    AuditModule,
    StorageModule,
    PushModule,
    BullModule.registerQueue({
      name: REPORT_EXPORT_QUEUE,
      // One attempt: a failed export is marked FAILED on its run and the user asks again.
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 100 },
    }),
    BullModule.registerQueue({ name: REPORT_EXPORT_CLEANUP_QUEUE }),
  ],
  providers: [
    ReportExportService,
    ReportRunLogService,
    ReportRowSourceRegistry,
    ReportExportQueue,
    ReportExportProcessor,
    ReportExportCleanupProcessor,
  ],
  exports: [
    ReportExportService,
    ReportRunLogService,
    ReportRowSourceRegistry,
    ReportExportQueue,
    // [8.15.44] The schedule job writes each recipient's file with the same code a queued export uses.
    ReportExportProcessor,
  ],
})
export class ReportExportModule {}
