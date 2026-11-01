import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CommunicationLog } from './entities/communication-log.entity';
import { ReminderBatch } from './entities/reminder-batch.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { StudentModule } from '../students/students.module';
import { FeeModule } from '../fees/fees.module';
import { AuditModule } from '../audit/audit.module';
import { School } from '../schools/entities/school.entity';
import { SchoolsModule } from '../schools/schools.module';
import { PushModule } from '../push/push.module';
import { CommunicationsService } from './communications.service';
import { BulkReminderService } from './reminders.service';
import { SingleReminderService } from './single-reminder.service';
import { DeliveryStatusService } from './delivery-status.service';
import { CommunicationsController } from './communications.controller';
import { CommunicationsProcessor } from './worker/communications.processor';
import { CommunicationProviderRegistryService } from './providers/communication-provider.registry';
import { MESSAGING_PROVIDERS } from './providers/messaging-providers';
import {
  MessagingConfigResolver,
  MESSAGING_PROVIDER_INSTANCES,
} from './config/messaging-config.resolver';
import { ConnectionTestService } from './testing/connection-test.service';
import { ProviderConnectionTestController } from './testing/provider-connection-test.controller';
import {
  COMMUNICATIONS_QUEUE,
  COMMUNICATIONS_QUEUE_JOB_OPTIONS,
  FEE_NOTIFY_QUEUE,
} from './communications.constants';
import { FeeNotifyProcessor } from './fee-notify.processor';
import { CreditsModule } from './credits/credits.module';
import { CreditsController } from './credits/credits.controller';
import { FeeNotificationsListener } from './fee-notifications.listener';
import { InvoiceNotificationsListener } from './invoice-notifications.listener';
import { InvoicesModule } from '../invoices/invoices.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { CommunicationsDashboardController } from './communications-dashboard.controller';
import { CommunicationsDashboardService } from './communications-dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CommunicationLog, ReminderBatch, Guardian, School]),
    StudentModule,
    DashboardModule,
    // [CodeRabbit review, PR #801] The last of the four edges in the
    // Fees<->Schools cycle (FeeModule -> SchoolsModule ->
    // AccountAccessModule -> CommunicationsModule -> FeeModule) to switch
    // to forwardRef — the other three (in fees.module.ts and
    // account-access.module.ts) already do.
    forwardRef(() => FeeModule),
    AuditModule,
    // #555: the automated dispatcher (CommunicationsProcessor) needs a
    // guardian's linked user id to try push before falling back to the
    // preferred channel. No cycle risk — PushModule only depends on
    // TypeOrmModule, unlike AccountAccessModule (see the forwardRef note
    // below).
    PushModule,
    // #529 (SchoolsModule) added a forwardRef import of AccountAccessModule,
    // which itself eagerly imports this module — Schools -> AccountAccess ->
    // Communications -> Schools. forwardRef here breaks the third edge of
    // that triangle; without it, `SchoolsModule` resolves to `undefined` at
    // require-time depending on which module Nest happens to load first.
    forwardRef(() => SchoolsModule),
    // [16.5.4] `InvoiceNotificationsListener` needs `InvoiceShareService` to
    // mint the receipt link, and `InvoicesController`'s new
    // `POST /invoices/:id/send` needs `CommunicationsService` — the two
    // modules depend on each other, so both sides use `forwardRef` (same
    // shape as the `SchoolsModule` edge above).
    forwardRef(() => InvoicesModule),
    // [#713] `CalendarModule` (calendar reminder SMS, via
    // `CalendarNotifyService`) now imports `CreditsModule`, and
    // `CreditsModule` -> `forwardRef(SchoolsModule)` -> `AccountAccessModule`
    // -> `CommunicationsModule` -> `CreditsModule` closes a second cycle
    // through this bare import (the first is the `InvoicesModule` edge
    // above). `forwardRef` breaks it the same way.
    forwardRef(() => CreditsModule),
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
    BullModule.registerQueue({
      name: FEE_NOTIFY_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
  ],
  providers: [
    CommunicationsService,
    BulkReminderService,
    SingleReminderService,
    DeliveryStatusService,
    CommunicationsProcessor,
    CommunicationProviderRegistryService,
    MessagingConfigResolver,
    ...MESSAGING_PROVIDERS,
    {
      provide: MESSAGING_PROVIDER_INSTANCES,
      useFactory: (...providers: unknown[]) => providers,
      inject: [...MESSAGING_PROVIDERS],
    },
    ConnectionTestService,
    FeeNotificationsListener,
    InvoiceNotificationsListener,
    FeeNotifyProcessor,
    CommunicationsDashboardService,
  ],
  // `CreditsController` ('communications/sms-credits') is declared HERE, first: Nest
  // matches routes in registration order and `CommunicationsController` has
  // `@Get(':id')`, which swallows the literal path (400 'uuid is expected') if it is
  // registered from another module. `SmsCreditService` comes from `CreditsModule`.
  controllers: [
    CreditsController,
    CommunicationsController,
    ProviderConnectionTestController,
    CommunicationsDashboardController,
  ],
  exports: [
    CommunicationsService,
    BulkReminderService,
    SingleReminderService,
    CommunicationProviderRegistryService,
    MessagingConfigResolver,
    ...MESSAGING_PROVIDERS,
  ],
})
export class CommunicationsModule {}
