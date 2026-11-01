import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import {
  COMMUNICATIONS_QUEUE_JOB_OPTIONS,
  FEE_NOTIFY_QUEUE,
} from '../communications/communications.constants';
import { FeeStructure } from './entities/fee-structure.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { FeeGeneration } from './entities/fee-generation.entity';
import { RecurringSchedule } from './entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from './entities/recurring-schedule-structure.entity';
import { RecurringScheduleExclusion } from './entities/recurring-schedule-exclusion.entity';
import { StudentWallet } from './entities/student-wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { School } from '../schools/entities/school.entity';
import { Program } from '../programs/entities/program.entity';
import { AuditModule } from '../audit/audit.module';
import { StudentModule } from '../students/students.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { SchoolsModule } from '../schools/schools.module';
import { FeeStructureService, PaymentService } from './fees.service';
import { PaymentsQueryService } from './payments-query.service';
import { FeeGenerationService, NoopDiscountResolver } from './fee-generation.service';
import { FeeDuesService } from './fee-dues.service';
import { FeeGenerationsService } from './fee-generations.service';
import { FeeGenerationBatchService } from './fee-generation-batch.service';
import { RecurringSchedulesService } from './recurring-schedules.service';
import { FeeController } from './fees.controller';
import { StudentStatementController } from './statement/student-statement.controller';
import { StudentStatementService } from './statement/student-statement.service';
import { FeeGenerationsController } from './fee-generations.controller';
import { RecurringSchedulesController } from './recurring-schedules.controller';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { CheckoutCartService } from './checkout-cart.service';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { PaymentReversalService } from './payment-reversal.service';
import { FeesDailyScheduler } from './fees-daily.scheduler';
import { FEES_DAILY_QUEUE } from './fees.constants';
import { DiscountRule } from './entities/discount-rule.entity';
import { FineRule } from './entities/fine-rule.entity';
import { DiscountRulesService } from './discount-rules.service';
import { DiscountRulesController } from './discount-rules.controller';
import { LateFeeService } from './late-fee.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { FineRulesService } from './fines/fine-rules.service';
import { FineRulesController } from './fines/fine-rules.controller';
import { FineSweepService } from './fines/fine-sweep.service';
import { FineSweepController } from './fines/fine-sweep.controller';
import { FinesService } from './fines/fines.service';
import { FinesController } from './fines/fines.controller';
import { DashboardModule } from '../dashboard/dashboard.module';
import { FeesDashboardController } from './fees-dashboard.controller';
import { ReportExportModule } from '../reports/export/report-export.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeeStructure,
      Payment,
      PaymentAllocation,
      StudentFee,
      FeeGeneration,
      RecurringSchedule,
      RecurringScheduleStructure,
      RecurringScheduleExclusion,
      StudentWallet,
      WalletTransaction,
      Student,
      Class,
      ClassSection,
      AcademicYear,
      Invoice,
      School,
      DiscountRule,
      FineRule,
      Program,
      CalendarEvent,
    ]),
    BullModule.registerQueue({ name: FEES_DAILY_QUEUE }),
    BullModule.registerQueue({
      name: FEE_NOTIFY_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
    AuditModule,
    DashboardModule,
    StudentModule,
    InvoicesModule,
    // [8.15.35] StudentStatementService writes the report run log. The module is @Global in the
    // app, but a spec that boots FeesModule alone does not load it, so import it here.
    ReportExportModule,
    // [CI failure, PR #801] FeeModule -> SchoolsModule -> AccountAccessModule
    // -> CommunicationsModule -> FeeModule is a cycle — CommunicationsModule
    // already forwardRef()s its own edge to SchoolsModule for exactly this
    // triangle (see the comment on that import in
    // communications.module.ts). This edge was a plain import until
    // FeesDailyScheduler needed SchoolsService ([16.7.2]) — without
    // forwardRef here, SchoolsModule resolves to undefined depending on
    // which module Nest happens to construct first.
    forwardRef(() => SchoolsModule),
  ],
  providers: [
    StudentStatementService,
    FeeStructureService,
    PaymentService,
    PaymentsQueryService,
    FeeGenerationService,
    FeeDuesService,
    FeeGenerationsService,
    FeeGenerationBatchService,
    RecurringSchedulesService,
    WalletService,
    // [16.7.3] `DiscountRulesService` implements the `DiscountResolver`
    // interface `NoopDiscountResolver` stubbed out — same DI token, real
    // class, so `FeeGenerationService`'s constructor (typed
    // `NoopDiscountResolver`) resolves the real thing without changing.
    DiscountRulesService,
    { provide: NoopDiscountResolver, useExisting: DiscountRulesService },
    CheckoutCartService,
    CheckoutService,
    PaymentReversalService,
    // [16.7.4] Registering this provider is what fills the `@Optional()
    // lateFeeService?` seam `fees-daily.scheduler.ts` ([16.7.2]/#676) left
    // for this ticket — Nest resolves it into that constructor parameter
    // automatically once it's a real provider in this module.
    LateFeeService,
    // [38.2.5] Fills the `@Optional() fineSweepService?` seam
    // `fees-daily.scheduler.ts` ([38.1]/#1112) left for this ticket, same
    // pattern as `LateFeeService` above. `FineSweepService` needs
    // `SchoolCalendarService` — provided directly here (with its own
    // `CalendarEvent` repository above) rather than importing the whole
    // `CalendarModule`: `CalendarModule` itself imports `SchoolsModule`,
    // and `FeeModule` is already reachable from `SchoolsModule` via
    // `SchoolsModule -> AccountAccessModule -> CommunicationsModule ->
    // FeeModule` (see the `forwardRef(() => SchoolsModule)` comment
    // above) — importing `CalendarModule` here closed that into a second
    // cycle through `CalendarModule`'s own (non-forwardRef'd) `SchoolsModule`
    // edge, breaking every other module that reaches `CalendarModule`
    // through `SchoolsModule` (e.g. `AttendanceModule`).
    // `SchoolCalendarService`'s other two dependencies (`SchoolsService`,
    // `AuditService`) are already available here.
    SchoolCalendarService,
    FineRulesService,
    FineSweepService,
    FinesService,
    FeesDailyScheduler,
  ],
  // CheckoutController is registered before FeeController: both declare
  // routes under `payments/*`, and Nest/Express match routes in
  // registration order. `CheckoutController`'s `payments/cart` and
  // `payments/checkout` are literal segments that `FeeController`'s
  // `payments/:id` (GET, 16.4.3) would otherwise shadow (`:id` matches any
  // single segment, including "cart"/"checkout") if FeeController's routes
  // registered first.
  controllers: [
    StudentStatementController,
    CheckoutController,
    FeeController,
    FeeGenerationsController,
    RecurringSchedulesController,
    WalletController,
    DiscountRulesController,
    FineRulesController,
    FineSweepController,
    FinesController,
    FeesDashboardController,
  ],
  exports: [
    FeeStructureService,
    PaymentService,
    PaymentsQueryService,
    FeeGenerationService,
    FeeDuesService,
    FeeGenerationsService,
    FeeGenerationBatchService,
    RecurringSchedulesService,
    WalletService,
    CheckoutCartService,
    DiscountRulesService,
  ],
})
export class FeeModule {}
