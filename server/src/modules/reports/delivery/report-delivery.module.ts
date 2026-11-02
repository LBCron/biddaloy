import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../../audit/audit.module';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { CommunicationsModule } from '../../communications/communications.module';
import { SchoolsModule } from '../../schools/schools.module';
import { StorageModule } from '../../storage/storage.module';
import { ReportDefinitionVersion } from '../entities/report-definition-version.entity';
import { ReportDefinition } from '../entities/report-definition.entity';
import { ReportRun } from '../entities/report-run.entity';
import { ReportSchedule } from '../entities/report-schedule.entity';
import { ReportSnapshot } from '../entities/report-snapshot.entity';
import { ReportScheduleProcessor } from './report-schedule.processor';
import { REPORT_SCHEDULE_QUEUE, ReportSchedulesService } from './report-schedules.service';
import { ReportSnapshotsService } from './report-snapshots.service';

/**
 * [8.15.44] Scheduled email links and kept copies of reports (Epic 8.15 D15). The export module is
 * global, so the run log and the export processor come from there. `CommunicationsModule` sits in
 * forwardRef cycles with fees and schools, so it is imported the same way.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReportSchedule,
      ReportSnapshot,
      ReportDefinition,
      ReportDefinitionVersion,
      ReportRun,
      UserTenant,
    ]),
    AuditModule,
    StorageModule,
    forwardRef(() => SchoolsModule),
    forwardRef(() => CommunicationsModule),
    BullModule.registerQueue({
      name: REPORT_SCHEDULE_QUEUE,
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 20 },
    }),
  ],
  providers: [ReportSchedulesService, ReportSnapshotsService, ReportScheduleProcessor],
  exports: [ReportSchedulesService, ReportSnapshotsService],
})
export class ReportDeliveryModule {}
