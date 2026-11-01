import { Module, Logger } from '@nestjs/common';
import { resolve } from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { queueWorkers } from './common/queue-workers';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';
import { buildPinoOptions } from './common/logging/pino-options';
import { AppController } from './app.controller';
import { resolveDefaultRateLimit } from './rate-limit';
import { buildDatabaseSsl } from './db-ssl';
import { RedactingTypeOrmLogger } from './db-logger';
import { TeacherStaffProfileSubscriber } from './modules/staff-profiles/teacher-staff-profile.subscriber';
import { buildRateLimitTracker } from './common/rate-limit/rate-limit-tracker';
import { AppThrottlerGuard } from './common/rate-limit/app-throttler.guard';
import { FailOpenThrottlerStorage } from './common/rate-limit/fail-open-throttler-storage';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AcademicYearModule } from './modules/academics/academic-year.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { ClassModule } from './modules/classes/classes.module';
import { CoordinationModule } from './modules/classes/coordination.module';
import { EnrollmentModule } from './modules/enrollments/enrollments.module';
import { UserModule } from './modules/users/users.module';
import { StudentModule } from './modules/students/students.module';
import { FeeModule } from './modules/fees/fees.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { CommunicationsModule } from './modules/communications/communications.module';
import { AuditModule } from './modules/audit/audit.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { RoutinesModule } from './modules/routines/routines.module';
import { AccountAccessModule } from './modules/account-access/account-access.module';
import { WorkbookModule } from './modules/workbook/workbook.module';
import { ExportModule } from './modules/workbook/export/export.module';
import { BackupScheduleModule } from './modules/workbook/schedule/backup-schedule.module';
import { DigestModule } from './modules/dashboard/digest/digest.module';
import { BulkImportModule } from './modules/bulk-import/bulk-import.module';
import { RestoreModule } from './modules/workbook/restore/restore.module';
import { ImportModule } from './modules/workbook/import/import.module';
import { TemplateModule } from './modules/workbook/template/template.module';
import { ReportsModule } from './modules/reports/reports.module';
import { DashboardInsightsModule } from './modules/dashboard/insights/dashboard-insights.module';
import { StaffHrModule } from './modules/staff-hr/staff-hr.module';
import { SearchModule } from './modules/search/search.module';
import { GradingModule } from './modules/grading/grading.module';
import { ExamsModule } from './modules/exams/exams.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { HomeworkModule } from './modules/homework/homework.module';
import { StudyPlansModule } from './modules/study-plans/study-plans.module';
import { AdmissionModule } from './modules/admission/admission.module';
import { StaffProfilesModule } from './modules/staff-profiles/staff-profiles.module';
import { StaffProfile } from './modules/staff-profiles/entities/staff-profile.entity';
import { StaffAttendanceModule } from './modules/staff-attendance/staff-attendance.module';
import { StaffAttendanceSession } from './modules/staff-attendance/entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from './modules/staff-attendance/entities/staff-attendance-record.entity';
import { LeaveModule } from './modules/leave/leave.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { LeaveRecord } from './modules/leave/entities/leave-record.entity';
import { LeavePolicy } from './modules/leave/entities/leave-policy.entity';
import { Application } from './modules/applications/entities/application.entity';
import { ApplicationEvent } from './modules/applications/entities/application-event.entity';
import { ApplicationTag } from './modules/applications/entities/application-tag.entity';
import { ApplicationAttachment } from './modules/applications/entities/application-attachment.entity';
import { AcrModule } from './modules/acr/acr.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { AttentionModule } from './modules/attention/attention.module';
import { SurveysModule } from './modules/surveys/surveys.module';
import { RegistrationModule } from './modules/registration/registration.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { SocialAuthModule } from './modules/auth/social/social-auth.module';
import { TrialModule } from './modules/schools/trial/trial.module';
import { DemoModule } from './modules/demo/demo.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { AcrFormVersion } from './modules/acr/entities/acr-form-version.entity';
import { AcrCriterion } from './modules/acr/entities/acr-criterion.entity';
import { AcrAssessment } from './modules/acr/entities/acr-assessment.entity';
import { AcrScore } from './modules/acr/entities/acr-score.entity';
import { StaffIncident } from './modules/incidents/entities/staff-incident.entity';
import { Alert } from './modules/attention/entities/alert.entity';
import { SeatOrder } from './modules/billing/entities/seat-order.entity';
import { PlatformPayment } from './modules/billing/entities/platform-payment.entity';
import { BillingModule } from './modules/billing/billing.module';
import { IdleAccountModule } from './modules/billing/idle-account.module';
import { PlatformAlert } from './modules/health/platform-alerts/platform-alert.entity';
import { AlertRecipient } from './modules/attention/entities/alert-recipient.entity';
import { Survey } from './modules/surveys/entities/survey.entity';
import { SurveyQuestion } from './modules/surveys/entities/survey-question.entity';
import { SurveyTarget } from './modules/surveys/entities/survey-target.entity';
import { SurveyResponse } from './modules/surveys/entities/survey-response.entity';
import { SurveyAnswer } from './modules/surveys/entities/survey-answer.entity';
import { SmsCreditBalance } from './modules/communications/credits/entities/sms-credit-balance.entity';
import { SmsCreditLedger } from './modules/communications/credits/entities/sms-credit-ledger.entity';
import { Homework } from './modules/homework/entities/homework.entity';
import { HomeworkAssignment } from './modules/homework/entities/homework-assignment.entity';
import { HomeworkSubmission } from './modules/homework/entities/homework-submission.entity';
import { SeatPlansModule } from './modules/seat-plans/seat-plans.module';
import { PresetsModule } from './modules/presets/presets.module';
import { PrintModule } from './modules/print/print.module';
import { SeatPlan } from './modules/seat-plans/entities/seat-plan.entity';
import { SeatPlanSchedule } from './modules/seat-plans/entities/seat-plan-schedule.entity';
import { SeatAllocation } from './modules/seat-plans/entities/seat-allocation.entity';
import { SyllabusTopic } from './modules/homework/entities/syllabus-topic.entity';
import { StudyPlan } from './modules/study-plans/entities/study-plan.entity';
import { LessonDelivery } from './modules/study-plans/entities/lesson-delivery.entity';
import { StudyPlanTemplate } from './modules/study-plans/entities/study-plan-template.entity';
import { ProgramsModule } from './modules/programs/programs.module';
import { Program } from './modules/programs/entities/program.entity';
import { ProgramMilestone } from './modules/programs/entities/program-milestone.entity';
import { ProgramEnrollment } from './modules/programs/entities/program-enrollment.entity';
import { MilestoneAchievement } from './modules/programs/entities/milestone-achievement.entity';
import { Designation } from './modules/staff-hr/entities/designation.entity';
import { StaffHrRecord } from './modules/staff-hr/entities/staff-hr-record.entity';
import { StaffDesignationHistory } from './modules/staff-hr/entities/staff-designation-history.entity';
import { StaffFamilyMember } from './modules/staff-hr/entities/staff-family-member.entity';
import { StaffAddress } from './modules/staff-hr/entities/staff-address.entity';
import { StaffExperience } from './modules/staff-hr/entities/staff-experience.entity';
import { StaffEducation } from './modules/staff-hr/entities/staff-education.entity';
import { StaffTraining } from './modules/staff-hr/entities/staff-training.entity';
import { StaffAchievement } from './modules/staff-hr/entities/staff-achievement.entity';
import { StaffLanguage } from './modules/staff-hr/entities/staff-language.entity';
import { StaffDocument } from './modules/staff-hr/entities/staff-document.entity';
import { ExamTemplate } from './modules/exams/entities/exam-template.entity';
import { ExamTemplateComponent } from './modules/exams/entities/exam-template-component.entity';
import { PrintTemplate } from './modules/print/entities/print-template.entity';
import { PrintTemplateVersion } from './modules/print/entities/print-template-version.entity';
import { PrintAsset } from './modules/print/entities/print-asset.entity';
import { PrinterProfile } from './modules/print/entities/printer-profile.entity';
import { PrintJob } from './modules/print/entities/print-job.entity';
import { PrintJobItem } from './modules/print/entities/print-job-item.entity';
import { validate } from './config/env.validation';

// Entities for auto-loading
import { User } from './modules/users/entities/user.entity';
import { School } from './modules/schools/entities/school.entity';
import { UserTenant } from './modules/auth/entities/user-tenant.entity';
import { Teacher } from './modules/academics/entities/teacher.entity';
import { AcademicYear } from './modules/academics/entities/academic-year.entity';
import { Class } from './modules/academics/entities/class.entity';
import { ClassSection } from './modules/academics/entities/class-section.entity';
import { Student } from './modules/students/entities/student.entity';
import { Guardian } from './modules/students/entities/guardian.entity';
import { FeeStructure } from './modules/fees/entities/fee-structure.entity';
import { FineRule } from './modules/fees/entities/fine-rule.entity';
import { DiscountRule } from './modules/fees/entities/discount-rule.entity';
import { StudentFee } from './modules/fees/entities/student-fee.entity';
import { FeeGeneration } from './modules/fees/entities/fee-generation.entity';
import { RecurringSchedule } from './modules/fees/entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from './modules/fees/entities/recurring-schedule-structure.entity';
import { RecurringScheduleExclusion } from './modules/fees/entities/recurring-schedule-exclusion.entity';
import { StudentWallet } from './modules/fees/entities/student-wallet.entity';
import { WalletTransaction } from './modules/fees/entities/wallet-transaction.entity';
import { Payment } from './modules/fees/entities/payment.entity';
import { PaymentAllocation } from './modules/fees/entities/payment-allocation.entity';
import { Invoice } from './modules/invoices/entities/invoice.entity';
import { InvoiceShareToken } from './modules/invoices/entities/invoice-share-token.entity';
import { CommunicationLog } from './modules/communications/entities/communication-log.entity';
import { ReminderBatch } from './modules/communications/entities/reminder-batch.entity';
import { AuditLog } from './modules/audit/entities/audit-log.entity';
import { PushSubscription } from './modules/push/entities/push-subscription.entity';
import { Enrollment } from './modules/students/entities/enrollment.entity';
import { TeacherClassSection } from './modules/academics/entities/teacher-class-section.entity';
import { CoordinatorAssignment } from './modules/academics/entities/coordinator-assignment.entity';
import { Subject } from './modules/academics/entities/subject.entity';
import { ClassSubject } from './modules/academics/entities/class-subject.entity';
import { CalendarEvent } from './modules/calendar/entities/calendar-event.entity';
import { CalendarEventClass } from './modules/calendar/entities/calendar-event-class.entity';
import { AcademicTerm } from './modules/calendar/entities/academic-term.entity';
import { PublicHolidaySet } from './modules/calendar/entities/public-holiday-set.entity';
import { PublicHolidayEntry } from './modules/calendar/entities/public-holiday-entry.entity';
import { CalendarFeedToken } from './modules/calendar/entities/calendar-feed-token.entity';
import { RefreshToken } from './modules/auth/entities/refresh-token.entity';
import { AttendanceSession } from './modules/attendance/entities/attendance-session.entity';
import { AttendanceRecord } from './modules/attendance/entities/attendance-record.entity';
import { AttendanceDevice } from './modules/attendance/entities/attendance-device.entity';
import { AttendanceDeviceEvent } from './modules/attendance/entities/attendance-device-event.entity';
import { ArrivalNoticeSubscription } from './modules/attendance/entities/arrival-notice-subscription.entity';
import { Shift } from './modules/routines/entities/shift.entity';
import { PeriodSlot } from './modules/routines/entities/period-slot.entity';
import { Room } from './modules/routines/entities/room.entity';
import { Routine } from './modules/routines/entities/routine.entity';
import { RoutineSlot } from './modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from './modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from './modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from './modules/routines/entities/routine-change-request.entity';
import { UserIdentity } from './modules/auth/entities/user-identity.entity';
import { AuthToken } from './modules/account-access/entities/auth-token.entity';
import { WorkbookJob } from './modules/workbook/jobs/workbook-job.entity';
import { GradingScale } from './modules/grading/entities/grading-scale.entity';
import { GradingBand } from './modules/grading/entities/grading-band.entity';
import { Exam } from './modules/exams/entities/exam.entity';
import { ExamComponent } from './modules/exams/entities/exam-component.entity';
import { ExamSchedule } from './modules/exams/entities/exam-schedule.entity';
import { Mark } from './modules/exams/entities/mark.entity';
import { MarkGrid } from './modules/exams/entities/mark-grid.entity';
import { Result } from './modules/exams/entities/result.entity';
import { ResultSubject } from './modules/exams/entities/result-subject.entity';
import { StudentSubjectChoice } from './modules/students/entities/student-subject-choice.entity';
import { StudentLifecycleEvent } from './modules/students/entities/student-lifecycle-event.entity';
import { StudentNote } from './modules/students/entities/student-note.entity';
import { StudentPublicExam } from './modules/students/entities/student-public-exam.entity';
import { AdmissionIntake } from './modules/admission/entities/admission-intake.entity';
import { AdmissionApplicant } from './modules/admission/entities/admission-applicant.entity';
import { AdmissionEvaluation } from './modules/admission/entities/admission-evaluation.entity';
import { PromotionRun } from './modules/promotions/entities/promotion-run.entity';
import { PromotionEntry } from './modules/promotions/entities/promotion-entry.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '..', '..', '.env'),
      validate,
    }),
    LoggerModule.forRoot({
      pinoHttp: buildPinoOptions(process.env.NODE_ENV),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { ssl, warning } = buildDatabaseSsl(
          config.get<string>('NODE_ENV'),
          config.get<string>('DB_SSL'),
          config.get<string>('DB_SSL_REJECT_UNAUTHORIZED'),
        );
        if (warning) {
          new Logger('Bootstrap').warn(warning);
        }

        return {
          type: 'postgres' as const,
          url: config.get<string>('DATABASE_URL'),
          ssl,
          // A pre-built logger instance, not the `logging` boolean below —
          // TypeORM ignores `logging` entirely once `logger` is an object
          // rather than a preset name (see LoggerFactory.create). The
          // instance's own constructor argument is what gates output.
          logger: new RedactingTypeOrmLogger(config.get<string>('NODE_ENV') !== 'production'),
          subscribers: [TeacherStaffProfileSubscriber],
          entities: [
            User,
            School,
            UserTenant,
            Teacher,
            AcademicYear,
            Class,
            ClassSection,
            Student,
            Guardian,
            FeeStructure,
            FineRule,
            DiscountRule,
            StudentFee,
            FeeGeneration,
            RecurringSchedule,
            RecurringScheduleStructure,
            RecurringScheduleExclusion,
            StudentWallet,
            WalletTransaction,
            Payment,
            PaymentAllocation,
            Invoice,
            InvoiceShareToken,
            CommunicationLog,
            ReminderBatch,
            AuditLog,
            // [#2237] Was missing: every /me/push route and PushService hit
            // "No metadata for PushSubscription". Registering it enables
            // Web Push app-wide.
            PushSubscription,
            Enrollment,
            TeacherClassSection,
            // [83.1.2] Coordinator rows (Epic 83).
            CoordinatorAssignment,
            Subject,
            ClassSubject,
            CalendarEvent,
            CalendarEventClass,
            AcademicTerm,
            PublicHolidaySet,
            PublicHolidayEntry,
            CalendarFeedToken,
            RefreshToken,
            AttendanceSession,
            AttendanceRecord,
            AttendanceDevice,
            AttendanceDeviceEvent,
            ArrivalNoticeSubscription,
            AuthToken,
            UserIdentity,
            WorkbookJob,
            GradingScale,
            GradingBand,
            Exam,
            ExamComponent,
            Mark,
            MarkGrid,
            Result,
            ResultSubject,
            ExamSchedule,
            StudentSubjectChoice,
            StudentLifecycleEvent,
            StudentNote,
            StudentPublicExam,
            PromotionRun,
            PromotionEntry,
            Shift,
            PeriodSlot,
            Room,
            Routine,
            RoutineSlot,
            RoutineSlotTeacher,
            RoutineSubstitution,
            RoutineChangeRequest,
            Homework,
            HomeworkAssignment,
            HomeworkSubmission,
            SyllabusTopic,
            StudyPlan,
            LessonDelivery,
            StudyPlanTemplate,
            AdmissionIntake,
            AdmissionApplicant,
            AdmissionEvaluation,
            SeatPlan,
            SeatPlanSchedule,
            SeatAllocation,
            Program,
            ProgramMilestone,
            ProgramEnrollment,
            MilestoneAchievement,
            Designation,
            StaffHrRecord,
            StaffDesignationHistory,
            StaffFamilyMember,
            StaffAddress,
            StaffExperience,
            StaffEducation,
            StaffTraining,
            StaffAchievement,
            StaffLanguage,
            StaffDocument,
            ExamTemplate,
            ExamTemplateComponent,
            PrintTemplate,
            PrintTemplateVersion,
            PrintAsset,
            PrinterProfile,
            PrintJob,
            PrintJobItem,
            // [36.1.1] StaffProfile was missing from this list — the
            // TypeORM connection built here only knows the entities named
            // in this array, so `StaffProfilesService` (and anything else
            // that queries `StaffProfile` through the app's real
            // `DataSource`, e.g. the e2e suite) hit
            // `EntityMetadataNotFoundError` despite `StaffProfilesModule`
            // registering it via `forFeature`. Fixed here as part of
            // [36.2.2] since it blocked this ticket's own e2e test.
            StaffProfile,
            StaffAttendanceSession,
            StaffAttendanceRecord,
            LeaveRecord,
            LeavePolicy,
            Application,
            ApplicationEvent,
            ApplicationTag,
            ApplicationAttachment,
            AcrFormVersion,
            AcrCriterion,
            AcrAssessment,
            AcrScore,
            StaffIncident,
            Alert,
            AlertRecipient,
            PlatformAlert,
            SeatOrder,
            PlatformPayment,
            Survey,
            SurveyQuestion,
            SurveyTarget,
            SurveyResponse,
            SurveyAnswer,
            // [#2216] Missing since 15.6 (#570): every SmsCreditService
            // ledger/balance read threw EntityMetadataNotFoundError on the
            // app's real DataSource, so metered sends never worked outside
            // specs that build their own connection.
            SmsCreditBalance,
            SmsCreditLedger,
          ],
          synchronize: config.get<string>('DB_SYNCHRONIZE') === 'true',
          migrations: ['dist/migrations/*.js'],
          migrationsTableName: 'typeorm_migrations',
        };
      },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379',
        },
      }),
      // One-off scripts boot AppModule for its services but must not start
      // BullMQ workers (they'd consume jobs from a possibly-shared Redis).
      // Read at import time, so scripts flip it first — see
      // common/queue-workers.ts and scripts/script-app-context.ts.
      extraOptions: { manualRegistration: !queueWorkers.enabled },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, JwtService],
      useFactory: (config: ConfigService, jwtService: JwtService) => {
        const { limit, ttl } = resolveDefaultRateLimit(
          config.get<string>('RATE_LIMIT_DEFAULT_LIMIT'),
          config.get<string>('RATE_LIMIT_DEFAULT_TTL_MS'),
        );
        return {
          throttlers: [{ name: 'default', limit, ttl }],
          // Distinct connection from BullMQ's: ioredis's default
          // maxRetriesPerRequest (20) queues each command through several
          // seconds of retries before rejecting, which turns "fail open"
          // into "fail slow" — every request hangs for the full retry
          // window during an outage. enableOfflineQueue: false rejects
          // immediately instead, so FailOpenThrottlerStorage can actually
          // fail open without adding latency.
          storage: new FailOpenThrottlerStorage(
            new ThrottlerStorageRedisService(
              config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379',
              {
                enableOfflineQueue: false,
                maxRetriesPerRequest: 1,
              },
            ),
          ),
          getTracker: buildRateLimitTracker(jwtService, config),
          // The e2e suite fires many requests in sequence against a shared
          // Redis bucket; without this it goes red intermittently on the
          // default tier's limit, not on anything the tests are checking.
          skipIf: () => config.get<string>('NODE_ENV') === 'test',
        };
      },
    }),
    HealthModule,
    AuditModule,
    AuthModule,
    AcademicYearModule,
    CalendarModule,
    ClassModule,
    EnrollmentModule,
    UserModule,
    StudentModule,
    FeeModule,
    InvoicesModule,
    CommunicationsModule,
    BillingModule,
    IdleAccountModule,
    SchoolsModule,
    AttendanceModule,
    RoutinesModule,
    AccountAccessModule,
    WorkbookModule,
    ExportModule,
    BackupScheduleModule,
    DigestModule,
    BulkImportModule,
    ImportModule,
    RestoreModule,
    TemplateModule,
    ReportsModule,
    DashboardInsightsModule,
    SearchModule,
    GradingModule,
    ExamsModule,
    HomeworkModule,
    StudyPlansModule,
    AdmissionModule,
    SeatPlansModule,
    PresetsModule,
    PrintModule,
    ProgramsModule,
    PromotionsModule,
    StaffHrModule,
    StaffProfilesModule,
    StaffAttendanceModule,
    LeaveModule,
    ApplicationsModule,
    AcrModule,
    IncidentsModule,
    AttentionModule,
    SurveysModule,
    PerformanceModule,
    RegistrationModule,
    OnboardingModule,
    SocialAuthModule,
    TrialModule,
    DemoModule,
    // [83.3.2] My coordination. Last on purpose: it imports Exams + Attention (so it cannot live
    // inside ClassModule), and registering it last keeps every other module's route order.
    CoordinationModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
