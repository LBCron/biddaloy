import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from '../schools/entities/school.entity';
import { ATTENTION_DELIVERY_QUEUE, ATTENTION_QUEUE } from './attention.constants';
import { PushModule } from '../push/push.module';
import { AlertDeliveryService } from './delivery/alert-delivery.service';
import { AttentionScheduler } from './engine/attention-scheduler';
import { SchoolsModule } from '../schools/schools.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ClassModule } from '../classes/classes.module';
import { AttentionHealthService } from './health/attention-health.service';
import { PlatformAttentionHealthController } from './health/platform-attention-health.controller';
import { AttentionController } from './api/attention.controller';
import { AttentionQueryService } from './api/attention-query.service';
import { CreditsModule } from '../communications/credits/credits.module';
import {
  COMMUNICATIONS_QUEUE,
  COMMUNICATIONS_QUEUE_JOB_OPTIONS,
} from '../communications/communications.constants';
import { GuardianSmsFallbackService } from './delivery/guardian-sms-fallback.service';
import { AuditModule } from '../audit/audit.module';
import { AlertsReportController } from './report/alerts-report.controller';
import { AlertsReportService } from './report/alerts-report.service';
import { ManualAlertsController } from './manual/manual-alerts.controller';
import { ManualAlertsService } from './manual/manual-alerts.service';
import { Alert } from './entities/alert.entity';
import { AlertRecipient } from './entities/alert-recipient.entity';
import { RuleRegistryService } from './rules/rule-registry.service';
import { RuleContextService } from './rules/rule-context.service';
import { AlertWriterService } from './engine/alert-writer.service';
import { SetupRulesModule } from './rules/setup/setup-rules.module';
import { SystemRulesModule } from './rules/system/system-rules.module';
import { StructureRulesModule } from './rules/structure/structure-rules.module';
import { AttendanceRulesModule } from './rules/attendance/attendance-rules.module';
import { PeriodRulesModule } from './rules/period/period-rules.module';
import { HomeworkRulesModule } from './rules/homework/homework-rules.module';
import { ClassRulesModule } from './rules/class/class-rules.module';
import { StudyPlanRulesModule } from './rules/study-plan/study-plan-rules.module';
import { FeesRulesModule } from './rules/fees/fees-rules.module';
import { ExamsRulesModule } from './rules/exams/exams-rules.module';
import { OfficeRulesModule } from './rules/office/office-rules.module';
import { FamilyRulesModule } from './rules/family/family-rules.module';
import { CommonRulesModule } from './rules/common/common-rules.module';
import { PlatformRulesModule } from './rules/platform/platform-rules.module';
import { BillingRulesModule } from './rules/billing/billing-rules.module';

/**
 * Attention engine (Epic 67, D11: runs in the API process).
 * attention.module.ts is edited in chain by 67.1.04 (#2047) -> .05 -> .07 -> .08 -> .09.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Alert, AlertRecipient, School]),
    BullModule.registerQueue({ name: ATTENTION_QUEUE }),
    BullModule.registerQueue({ name: ATTENTION_DELIVERY_QUEUE }),
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
    ConfigModule,
    PushModule,
    DiscoveryModule,
    SchoolsModule,
    CalendarModule,
    ClassModule,
    AuditModule,
    CreditsModule,
    SetupRulesModule,
    SystemRulesModule,
    StructureRulesModule,
    AttendanceRulesModule,
    PeriodRulesModule,
    HomeworkRulesModule,
    ClassRulesModule,
    StudyPlanRulesModule,
    FeesRulesModule,
    ExamsRulesModule,
    OfficeRulesModule,
    FamilyRulesModule,
    CommonRulesModule,
    PlatformRulesModule,
    BillingRulesModule,
  ],
  controllers: [
    AttentionController,
    ManualAlertsController,
    AlertsReportController,
    PlatformAttentionHealthController,
  ],
  providers: [
    RuleRegistryService,
    RuleContextService,
    AlertWriterService,
    AttentionScheduler,
    AttentionQueryService,
    ManualAlertsService,
    AlertsReportService,
    AlertDeliveryService,
    GuardianSmsFallbackService,
    AttentionHealthService,
  ],
  // [83.3.2] ManualAlertsService: My coordination's notify rides the manual-alert path (D8).
  exports: [
    RuleRegistryService,
    RuleContextService,
    AlertWriterService,
    AttentionQueryService,
    ManualAlertsService,
  ],
})
export class AttentionModule {}
