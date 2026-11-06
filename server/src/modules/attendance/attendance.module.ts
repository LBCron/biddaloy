import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceDevice } from './entities/attendance-device.entity';
import { ArrivalNoticeSubscription } from './entities/arrival-notice-subscription.entity';
import { AttendanceDeviceEvent } from './entities/attendance-device-event.entity';
import { Student } from '../students/entities/student.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import {
  COMMUNICATIONS_QUEUE,
  COMMUNICATIONS_QUEUE_JOB_OPTIONS,
} from '../communications/communications.constants';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { CalendarModule } from '../calendar/calendar.module';
import { RoutinesModule } from '../routines/routines.module';
import { ClassModule } from '../classes/classes.module';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { StudentModule } from '../students/students.module';
import { CreditsModule } from '../communications/credits/credits.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceAccessService } from './attendance-access.service';
import { AttendanceSummaryService } from './attendance-summary.service';
import { AttendanceSummaryController } from './attendance-summary.controller';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AttendanceDashboardService } from './attendance-dashboard.service';
import { AttendanceDashboardController } from './attendance-dashboard.controller';
import { AttendanceSeriesScheduler, ATTENDANCE_SERIES_QUEUE } from './attendance-series.scheduler';
import { AbsenceNoticeService } from './absence-notice.service';
import { ArrivalNoticeService } from './arrival-notice.service';
import { AbsenceNoticeController } from './absence-notice.controller';
import { AbsenceNoticeScheduler, ABSENCE_NOTICE_SWEEP_QUEUE } from './absence-notice.scheduler';
import {
  DeviceAbsentSweepScheduler,
  DEVICE_ABSENT_SWEEP_QUEUE,
} from './device-absent-sweep.scheduler';
import { ArrivalSubscriptionsService } from './arrival-subscriptions.service';
import {
  ArrivalSubscriptionsController,
  PortalArrivalSubscriptionsController,
} from './arrival-subscriptions.controller';
import { DeviceService } from './devices/device.service';
import { DeviceEventsService } from './devices/device-events.service';
import { DeviceAuthGuard } from './devices/device-auth.guard';
import { DevicesController } from './devices/devices.controller';
import { DeviceIngestController } from './devices/device-ingest.controller';

/**
 * [9.2] was entity-only. [9.3] fills `providers`/`controllers` in. [9.4]
 * adds `AttendanceSummaryService`/`AttendanceSummaryController` and imports
 * `AcademicYearModule` (now `CalendarModule`, see [17.1.2]) for
 * `SchoolCalendarService` (working-day math) and `StudentModule` for
 * `FamilyAccessService` (PARENT/STUDENT scoping on the summary routes).
 *
 * `Student`/`ClassSection`/`TeacherClassSection` are registered here
 * (rather than importing StudentModule for entities too) so this module's
 * services can query against them without a cross-module DI cycle, same
 * reasoning as `classes.module.ts`'s own comment. The holiday calendar
 * entity (`CalendarEvent`, formerly `SchoolHoliday`) lives in
 * `CalendarModule` — this module no longer queries it directly, going
 * through `SchoolCalendarService` instead (see `attendance.service.ts`'s
 * old `isHoliday` docstring, now removed).
 *
 * `AttendanceService`/`AttendanceAccessService` are exported — [9.4], [9.5]
 * and [9.8] inject them directly rather than re-deriving the same
 * section-access join or register-assembly logic.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AttendanceSession,
      AttendanceRecord,
      AttendanceDevice,
      ArrivalNoticeSubscription,
      AttendanceDeviceEvent,
      Student,
      ClassSection,
      TeacherClassSection,
      Teacher,
      PeriodSlot,
      UserTenant,
      // ReminderBatch/CommunicationLog: [9.8]'s AbsenceNoticeService writes
      // ordinary ReminderBatch/CommunicationLog rows through the same
      // tables the fee-reminder path uses, rather than importing
      // CommunicationsModule and its whole provider graph — those two
      // repositories are all it actually needs.
      ReminderBatch,
      CommunicationLog,
    ]),
    AuditModule,
    SchoolsModule,
    CalendarModule,
    StudentModule,
    CreditsModule,
    RoutinesModule,
    ClassModule, // TeacherScopeService for the class-teacher streaks widget
    DashboardModule,
    // Registered here (not exported from CommunicationsModule) so
    // AbsenceNoticeService can enqueue onto the exact same Redis-backed
    // queue the communications worker already consumes — same queue name,
    // separate producer registration, standard BullMQ multi-module usage.
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
    BullModule.registerQueue({ name: ABSENCE_NOTICE_SWEEP_QUEUE }),
    BullModule.registerQueue({ name: DEVICE_ABSENT_SWEEP_QUEUE }),
    BullModule.registerQueue({ name: ATTENDANCE_SERIES_QUEUE }),
  ],
  providers: [
    AttendanceService,
    AttendanceAccessService,
    AttendanceSummaryService,
    AbsenceNoticeService,
    ArrivalNoticeService,
    AbsenceNoticeScheduler,
    DeviceAbsentSweepScheduler,
    AttendanceDashboardService,
    AttendanceSeriesScheduler,
    ArrivalSubscriptionsService,
    DeviceService,
    DeviceEventsService,
    DeviceAuthGuard,
  ],
  controllers: [
    AttendanceController,
    AttendanceSummaryController,
    AbsenceNoticeController,
    AttendanceDashboardController,
    ArrivalSubscriptionsController,
    PortalArrivalSubscriptionsController,
    DevicesController,
    DeviceIngestController,
  ],
  exports: [
    TypeOrmModule,
    AttendanceService,
    AttendanceAccessService,
    AttendanceSummaryService,
    AttendanceDashboardService,
  ],
})
export class AttendanceModule {}
