import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Payment } from '../fees/entities/payment.entity';
import { CollectionsReportService } from './collections-report.service';
import { ReportsController } from './reports.controller';
import { ReportsDashboardController } from './reports-dashboard.controller';
import { DashboardModule } from '../dashboard/dashboard.module';
import { SchoolsModule } from '../schools/schools.module';
import { ReportEngineModule } from './engine/report-engine.module';
import { StorageModule } from '../storage/storage.module';
import { ReportDefinitionsController } from './report-definitions.controller';
import { ReportDefinitionsService } from './definitions/report-definitions.service';
import { ReportExportModule } from './export/report-export.module';
import { ReportDeliveryModule } from './delivery/report-delivery.module';
import { ReportDeliveryController } from './report-delivery.controller';
import { PlatformReportUsageController } from './platform-report-usage.controller';
import { PlatformReportUsageService } from './platform-report-usage.service';
import { ReportMetaController } from './report-meta.controller';
import { ReportRunsController } from './report-runs.controller';
import {
  ReportDefinition,
  ReportDefinitionVersion,
  ReportRun,
  ReportSchedule,
  ReportSnapshot,
} from './entities';

/** [16.6.2] Reports module — read-only aggregate views over data owned by
 * other modules (fees/payments). Registers `Payment` for `TypeOrmModule`
 * so its `Repository`'s `manager` can run the report's raw aggregate SQL,
 * which also reaches into `payment_allocations`, `student_fees`,
 * `fee_structures`, `invoices`, `students`, and `users` — all already
 * migrated by their owning modules, so no entities beyond `Payment` need
 * registering here. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      ReportDefinition,
      ReportDefinitionVersion,
      ReportRun,
      ReportSchedule,
      ReportSnapshot,
    ]),
    AuditModule,
    DashboardModule,
    SchoolsModule,
    ReportExportModule,
    ReportDeliveryModule,
    ReportEngineModule,
    StorageModule,
  ],
  providers: [CollectionsReportService, ReportDefinitionsService, PlatformReportUsageService],
  controllers: [
    ReportsController,
    ReportsDashboardController,
    ReportMetaController,
    ReportDefinitionsController,
    ReportRunsController,
    ReportDeliveryController,
    PlatformReportUsageController,
  ],
})
export class ReportsModule {}
