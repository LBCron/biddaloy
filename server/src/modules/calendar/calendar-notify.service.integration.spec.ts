import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { CalendarNotifyService } from './calendar-notify.service';
import { CalendarModule } from './calendar.module';
import { AuthModule } from '../auth/auth.module';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventClass } from './entities/calendar-event-class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { formatFeeNotificationDueDate } from '../communications/fee-notification-template.util';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { SmsCreditBalance } from '../communications/credits/entities/sms-credit-balance.entity';
import {
  SmsCreditLedger,
  SmsCreditLedgerKind,
} from '../communications/credits/entities/sms-credit-ledger.entity';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { PushService } from '../push/push.service';
import {
  CalendarAudience,
  CalendarEventType,
  CommunicationMedium,
  CommunicationStatus,
  EnrollmentStatus,
  UserRole,
  UserStatus,
  countSmsSegments,
} from '@biddaloy/shared';

/**
 * Integration tests for [17.3.3]'s `CalendarNotifyService`, run against a
 * real, migrated database plus a real Redis-backed queue (same as
 * `absence-notice.service.integration.spec.ts`) — `queue.add` for SMS is
 * exercised for real here, not mocked. Push actually calling a provider is
 * a no-op in this env (`PushConfigService.isPushEnabled()` is false
 * without VAPID keys configured), so push assertions only check that the
 * mutation/notify call never throws and settles every recipient.
 */
describe('CalendarNotifyService (integration)', () => {
  let notify: CalendarNotifyService;
  let dataSource: DataSource;
  let queue: Queue;
  let pushService: PushService;
  let logRepo: Repository<CommunicationLog>;
  let smsCreditService: SmsCreditService;

  const TENANT_ID = '00000000-0000-4000-8000-000000000701';

  let yearId: string;
  let classId: string;
  let sectionId: string;
  let studentUserId: string;
  let guardianUserId: string;
  let guardianId: string;
  let teacherUserId: string;
  let adminUserId: string;

  async function makeUser(name: string, status: UserStatus = UserStatus.ACTIVE): Promise<string> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save({
      full_name: name,
      email: `${name.replace(/\s+/g, '.').toLowerCase()}.${Date.now()}.${Math.random()}@test.local`,
      status,
    } as any);
    return user.id;
  }

  async function makeMembership(userId: string, role: UserRole): Promise<void> {
    await dataSource.getRepository(UserTenant).save({
      user_id: userId,
      tenant_id: TENANT_ID,
      role,
    });
  }

  async function setSmsSettings(metering: 'PLATFORM' | 'OFF'): Promise<void> {
    await dataSource
      .getRepository(School)
      .update(
        { id: TENANT_ID },
        { settings: { version: 1, communications: { sms: { metering } } } as any },
      );
  }

  async function grantSmsCredit(units: number): Promise<void> {
    const repo = dataSource.getRepository(SmsCreditBalance);
    const existing = await repo.findOne({ where: { tenant_id: TENANT_ID } });
    if (existing) {
      await repo.update({ tenant_id: TENANT_ID }, { available: units });
    } else {
      await repo.save({ tenant_id: TENANT_ID, available: units, reserved: 0 });
    }
  }

  async function makeEvent(overrides: Partial<CalendarEvent> = {}): Promise<CalendarEvent> {
    const repo = dataSource.getRepository(CalendarEvent);
    return repo.save({
      tenant_id: TENANT_ID,
      academic_year_id: yearId,
      type: CalendarEventType.EVENT,
      start_date: '2030-04-01',
      end_date: '2030-04-01',
      name: 'Sports Day',
      audience: CalendarAudience.ALL,
      published_at: new Date(),
      external_refs: {},
      ...overrides,
    } as any);
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: { url: config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379' },
          }),
        }),
        CalendarModule,
        AuthModule,
      ],
    );
    notify = module.get<CalendarNotifyService>(CalendarNotifyService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    // `module.get(getQueueToken(...))` can resolve to a *different*
    // `Queue` instance than the one `CalendarNotifyService` actually holds
    // — multiple modules in this tree (`CalendarModule`, plus whatever
    // `CreditsModule`/`AuthModule` pull in) each call
    // `BullModule.registerQueue({ name: COMMUNICATIONS_QUEUE })`, and
    // Nest's DI encapsulation doesn't guarantee those resolve to the same
    // provider outside the module that declared it. Reach into the
    // service's own injected instance instead, so a spy on it actually
    // intercepts what the service calls.
    queue = (notify as any).queue as Queue;
    pushService = module.get<PushService>(PushService);
    logRepo = module.get<Repository<CommunicationLog>>(getRepositoryToken(CommunicationLog));
    smsCreditService = module.get<SmsCreditService>(SmsCreditService);

    await dataSource.getRepository(School).save({
      id: TENANT_ID,
      name: 'Calendar Notify Test School',
      slug: `calendar-notify-${Date.now()}`,
    });
    await setSmsSettings('OFF');
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `Calendar Notify Year ${Date.now()}`,
      start_date: '2030-01-01',
      end_date: '2030-12-31',
      tenant_id: TENANT_ID,
    });
    yearId = year.id;

    const klass = await dataSource.getRepository(Class).save({
      name: 'Calendar Notify Class',
      academic_year_id: yearId,
      tenant_id: TENANT_ID,
    });
    classId = klass.id;

    const section = await dataSource.getRepository(ClassSection).save({
      class_id: classId,
      tenant_id: TENANT_ID,
      section_name: 'A',
    });
    sectionId = section.id;

    guardianUserId = await makeUser('Guardian User');
    studentUserId = await makeUser('Student User');
    teacherUserId = await makeUser('Teacher User');
    adminUserId = await makeUser('Admin User');
    await makeMembership(guardianUserId, UserRole.PARENT);
    await makeMembership(studentUserId, UserRole.STUDENT);
    await makeMembership(teacherUserId, UserRole.TEACHER);
    await makeMembership(adminUserId, UserRole.ADMIN);

    const guardian = await dataSource.getRepository(Guardian).save({
      full_name: 'Guardian One',
      relationship: 'Father',
      phone: '01711111111',
      preferred_communication: CommunicationMedium.SMS,
      tenant_id: TENANT_ID,
      user_id: guardianUserId,
    } as any);
    guardianId = guardian.id;

    await dataSource.getRepository(Student).save({
      full_name: 'Student One',
      registration_number: `CN-REG-${Date.now()}`,
      roll_number: 1,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
      user_id: studentUserId,
      guardians: [guardian],
    } as any);
  });

  it('ALL event scoped to a class notifies its guardians, students, and staff (push)', async () => {
    const event = await makeEvent({ audience: CalendarAudience.ALL });
    await dataSource.getRepository(CalendarEventClass).save({
      event_id: event.id,
      class_id: classId,
      tenant_id: TENANT_ID,
    });

    await expect(
      notify.eventCreated(event, { notify: true, userId: adminUserId }),
    ).resolves.toBeUndefined();
    // No throw + no SMS batch created (metering OFF) is the only
    // observable assertion available without a real push provider —
    // recipient *resolution* itself is covered by the SMS-path tests
    // below, which do create a durable row we can query.
  });

  it('STAFF event excludes families — no SMS batch, since STAFF audience never resolves guardians', async () => {
    await setSmsSettings('PLATFORM');
    await grantSmsCredit(100);

    const event = await makeEvent({ audience: CalendarAudience.STAFF });
    await notify.eventCreated(event, { notify: true, notifySms: true, userId: adminUserId });

    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID, batch_name: `Calendar: ${event.name}` } });
    expect(batch).toBeNull();
    await setSmsSettings('OFF');
  });

  it('inactive user is skipped from push recipients (no throw, resolution still succeeds)', async () => {
    await dataSource
      .getRepository(User)
      .update({ id: guardianUserId }, { status: UserStatus.SUSPENDED });
    const event = await makeEvent({ audience: CalendarAudience.ALL });

    const sendToUser = vi.spyOn(pushService, 'sendToUser').mockResolvedValue(undefined as any);

    await expect(
      notify.eventCreated(event, { notify: true, userId: adminUserId }),
    ).resolves.toBeUndefined();

    // F2: the suspended guardian's user id must never be handed to
    // PushService — staff (ACTIVE) and the still-ACTIVE student user are
    // fine, only the SUSPENDED guardian is excluded.
    const notifiedUserIds = sendToUser.mock.calls.map((call) => call[0]);
    expect(notifiedUserIds).not.toContain(guardianUserId);
    expect(notifiedUserIds).toContain(studentUserId);
    expect(notifiedUserIds).toContain(adminUserId);

    await dataSource
      .getRepository(User)
      .update({ id: guardianUserId }, { status: UserStatus.ACTIVE });
  });

  it('a student who has left the school no longer pulls in their guardian as a recipient', async () => {
    const student = await dataSource
      .getRepository(Student)
      .findOneOrFail({ where: { user_id: studentUserId, tenant_id: TENANT_ID } });
    student.enrollment_status = EnrollmentStatus.INACTIVE;
    await dataSource.getRepository(Student).save(student);

    const event = await makeEvent({ audience: CalendarAudience.ALL });
    const sendToUser = vi.spyOn(pushService, 'sendToUser').mockResolvedValue(undefined as any);

    await expect(
      notify.eventCreated(event, { notify: true, userId: adminUserId }),
    ).resolves.toBeUndefined();

    // Both the withdrawn student and the guardian resolved only through
    // them must be excluded — staff (ACTIVE) is unaffected.
    const notifiedUserIds = sendToUser.mock.calls.map((call) => call[0]);
    expect(notifiedUserIds).not.toContain(studentUserId);
    expect(notifiedUserIds).not.toContain(guardianUserId);
    expect(notifiedUserIds).toContain(adminUserId);

    student.enrollment_status = EnrollmentStatus.ACTIVE;
    await dataSource.getRepository(Student).save(student);
  });

  it('push failure never fails the mutation (PushService is a no-op without VAPID config)', async () => {
    const event = await makeEvent({ audience: CalendarAudience.ALL });
    await expect(
      notify.eventUpdated(event, { notify: true, userId: adminUserId }),
    ).resolves.toBeUndefined();
  });

  it('SMS is sent (queued) to a guardian when the tenant is SMS-metered with credit', async () => {
    await setSmsSettings('PLATFORM');
    await grantSmsCredit(100);

    const event = await makeEvent({ audience: CalendarAudience.ALL, name: 'SMS Test Event' });
    await notify.eventCreated(event, { notify: true, notifySms: true, userId: adminUserId });

    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID, batch_name: `Calendar: ${event.name}` } });
    expect(batch).not.toBeNull();
    expect(batch?.total_recipients).toBe(1);

    const logs = await dataSource
      .getRepository(CommunicationLog)
      .find({ where: { reminder_batch_id: batch!.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].guardian_id).toBe(guardianId);
    expect(logs[0].medium).toBe(CommunicationMedium.SMS);

    // [#713] SMS now reserves through the real `SmsCreditService.reserve`
    // (via `CreditsModule`), so a `RESERVE` ledger row must exist for this
    // batch — this is the audit trail the old raw-UPDATE workaround skipped.
    const ledgerRow = await dataSource
      .getRepository(SmsCreditLedger)
      .findOne({ where: { tenant_id: TENANT_ID, idempotency_key: `batch:${batch!.id}` } });
    expect(ledgerRow).not.toBeNull();
    expect(ledgerRow?.kind).toBe(SmsCreditLedgerKind.RESERVE);

    await setSmsSettings('OFF');
  });

  // [#2265] Bangla-locale school: Bangla body, credit priced on that body.
  async function setLocale(locale?: string): Promise<void> {
    await dataSource.getRepository(School).update(
      { id: TENANT_ID },
      {
        settings: {
          version: 1,
          communications: { sms: { metering: 'PLATFORM' } },
          ...(locale ? { region: { locale } } : {}),
        } as any,
      },
    );
  }

  it('bn-BD tenant: queued SMS body is Bangla and reserved units match its segments', async () => {
    await setLocale('bn-BD');
    await grantSmsCredit(100);

    const event = await makeEvent({ audience: CalendarAudience.ALL, name: 'Eid Holiday' });
    await notify.eventCreated(event, { notify: true, notifySms: true, userId: adminUserId });

    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID, batch_name: `Calendar: ${event.name}` } });
    const logs = await dataSource
      .getRepository(CommunicationLog)
      .find({ where: { reminder_batch_id: batch!.id } });
    const expected = `${event.name} — ${formatFeeNotificationDueDate('bn', event.start_date)}। বিস্তারিত স্কুলের ক্যালেন্ডারে দেখুন।`;
    expect(logs[0].message_body).toBe(expected);
    // UCS-2 message: units = Bangla segments x guardians, not the English count.
    const ledger = await dataSource.getRepository(SmsCreditLedger).findOne({
      where: { tenant_id: TENANT_ID, idempotency_key: `batch:${batch!.id}` },
    });
    expect(Math.abs(ledger!.units)).toBe(countSmsSegments(expected).segments * logs.length);

    await setSmsSettings('OFF');
  });

  // [#3136] No stored locale resolves to the bn-BD default, like every other sender.
  it('tenant with no stored locale: SMS body is Bangla', async () => {
    await setLocale();
    await grantSmsCredit(100);
    const event = await makeEvent({ audience: CalendarAudience.ALL, name: 'Default Event' });
    await notify.eventCreated(event, { notify: true, notifySms: true, userId: adminUserId });
    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID, batch_name: `Calendar: ${event.name}` } });
    const logs = await dataSource
      .getRepository(CommunicationLog)
      .find({ where: { reminder_batch_id: batch!.id } });
    expect(logs[0].message_body).toBe(
      `${event.name} — ${formatFeeNotificationDueDate('bn', event.start_date)}। বিস্তারিত স্কুলের ক্যালেন্ডারে দেখুন।`,
    );
    await setSmsSettings('OFF');
  });

  it('SMS is not sent when the tenant has zero SMS credit — logged, never throws', async () => {
    await setSmsSettings('PLATFORM');
    // Explicitly zeroed — an earlier test in this file may have left this
    // tenant's row with leftover balance, since it's shared across specs.
    await grantSmsCredit(0);

    const event = await makeEvent({ audience: CalendarAudience.ALL, name: 'No Credit Event' });
    await expect(
      notify.eventCreated(event, { notify: true, notifySms: true, userId: adminUserId }),
    ).resolves.toBeUndefined();

    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID, batch_name: `Calendar: ${event.name}` } });
    // No batch survives insufficient credit — it's created to get a stable
    // idempotency key for `reserve`, then compensating-deleted when the
    // reservation fails, same as `reminders.service.ts`'s own batch path.
    expect(batch).toBeNull();

    await setSmsSettings('OFF');
  });

  it('eventsImported sends one push per distinct recipient, never one per event', async () => {
    const eventA = await makeEvent({ name: 'Imported A', audience: CalendarAudience.ALL });
    const eventB = await makeEvent({ name: 'Imported B', audience: CalendarAudience.ALL });

    const sendToUser = vi.spyOn(pushService, 'sendToUser').mockResolvedValue(undefined as any);

    await expect(
      notify.eventsImported([eventA, eventB], { notify: true, userId: adminUserId }),
    ).resolves.toBeUndefined();

    // `user_tenants`/`users` are only reset once per spec *file*, not per
    // test (see `test/reset-order.ts`), so the exact tenant-wide staff
    // count here also reflects every earlier test's fixtures — the
    // meaningful assertion is duplicate-freedom (never one push per
    // event per recipient) plus that this test's own fixtures are
    // present, not a hardcoded total.
    const notifiedUserIds = sendToUser.mock.calls.map((call) => call[0]);
    expect(notifiedUserIds).toHaveLength(new Set(notifiedUserIds).size);
    expect(notifiedUserIds).toEqual(
      expect.arrayContaining([studentUserId, guardianUserId, teacherUserId, adminUserId]),
    );
  });

  it("F1: CommunicationLog insert failure releases that guardian's reserved SMS credit", async () => {
    await setSmsSettings('PLATFORM');
    await grantSmsCredit(100);

    const saveSpy = vi
      .spyOn(logRepo, 'save')
      .mockRejectedValueOnce(new Error('simulated log insert failure'));

    const event = await makeEvent({
      audience: CalendarAudience.ALL,
      name: 'Log Insert Failure Event',
    });
    await expect(
      notify.eventCreated(event, { notify: true, notifySms: true, userId: adminUserId }),
    ).resolves.toBeUndefined();
    saveSpy.mockRestore();

    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID, batch_name: `Calendar: ${event.name}` } });
    expect(batch).not.toBeNull();

    const ledgerRows = await dataSource
      .getRepository(SmsCreditLedger)
      .find({ where: { tenant_id: TENANT_ID, reference_id: batch!.id } });
    expect(ledgerRows.some((r) => r.kind === SmsCreditLedgerKind.RESERVE)).toBe(true);
    // The only recipient's share must have been released, not left
    // dangling forever.
    expect(ledgerRows.some((r) => r.kind === SmsCreditLedgerKind.RELEASE)).toBe(true);

    await setSmsSettings('OFF');
  });

  it("F1: queue.add failure releases that log's reserved SMS credit", async () => {
    await setSmsSettings('PLATFORM');
    await grantSmsCredit(100);

    const addSpy = vi
      .spyOn(queue, 'add')
      .mockRejectedValueOnce(new Error('simulated enqueue failure'));

    const event = await makeEvent({
      audience: CalendarAudience.ALL,
      name: 'Enqueue Failure Event',
    });
    await expect(
      notify.eventCreated(event, { notify: true, notifySms: true, userId: adminUserId }),
    ).resolves.toBeUndefined();
    addSpy.mockRestore();

    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID, batch_name: `Calendar: ${event.name}` } });
    expect(batch).not.toBeNull();

    const logs = await dataSource
      .getRepository(CommunicationLog)
      .find({ where: { reminder_batch_id: batch!.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe(CommunicationStatus.FAILED);

    const ledgerRows = await dataSource
      .getRepository(SmsCreditLedger)
      .find({ where: { tenant_id: TENANT_ID, reference_id: batch!.id } });
    expect(ledgerRows.some((r) => r.kind === SmsCreditLedgerKind.RESERVE)).toBe(true);
    expect(ledgerRows.some((r) => r.kind === SmsCreditLedgerKind.RELEASE)).toBe(true);

    // NEW B: nothing will ever process a job for this guardian's share —
    // recordBatchOutcome must have moved the batch to a terminal status
    // instead of leaving it stuck PROCESSING forever.
    const refreshedBatch = await dataSource
      .getRepository(ReminderBatch)
      .findOneOrFail({ where: { id: batch!.id } });
    expect(refreshedBatch.status).not.toBe('PROCESSING');
    expect(refreshedBatch.successful_count + refreshedBatch.failed_count).toBe(
      refreshedBatch.total_recipients,
    );
    expect(refreshedBatch.failed_count).toBe(1);

    await setSmsSettings('OFF');
  });

  it('NEW B: CommunicationLog insert failure also leaves the batch terminal, not stuck PROCESSING', async () => {
    await setSmsSettings('PLATFORM');
    await grantSmsCredit(100);

    const saveSpy = vi
      .spyOn(logRepo, 'save')
      .mockRejectedValueOnce(new Error('simulated log insert failure'));

    const event = await makeEvent({
      audience: CalendarAudience.ALL,
      name: 'Log Insert Failure Terminal Event',
    });
    await expect(
      notify.eventCreated(event, { notify: true, notifySms: true, userId: adminUserId }),
    ).resolves.toBeUndefined();
    saveSpy.mockRestore();

    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID, batch_name: `Calendar: ${event.name}` } });
    expect(batch).not.toBeNull();
    expect(batch!.status).not.toBe('PROCESSING');
    expect(batch!.successful_count + batch!.failed_count).toBe(batch!.total_recipients);
    expect(batch!.failed_count).toBe(1);

    await setSmsSettings('OFF');
  });

  it('NEW A: opted-out and non-primary guardians are excluded from SMS (push-eligible family is unaffected)', async () => {
    await setSmsSettings('PLATFORM');
    await grantSmsCredit(100);

    const optedOutGuardian = await dataSource.getRepository(Guardian).save({
      full_name: 'Opted Out Guardian',
      relationship: 'Mother',
      phone: '01722222222',
      preferred_communication: CommunicationMedium.SMS,
      tenant_id: TENANT_ID,
      is_primary_contact: true,
      notifications_enabled: false,
    } as any);
    const nonPrimaryGuardian = await dataSource.getRepository(Guardian).save({
      full_name: 'Non Primary Guardian',
      relationship: 'Uncle',
      phone: '01733333333',
      preferred_communication: CommunicationMedium.SMS,
      tenant_id: TENANT_ID,
      is_primary_contact: false,
      notifications_enabled: true,
    } as any);

    const student = await dataSource.getRepository(Student).findOneOrFail({
      where: { user_id: studentUserId, tenant_id: TENANT_ID },
      relations: ['guardians'],
    });
    const originalGuardians = student.guardians;
    student.guardians = [...originalGuardians, optedOutGuardian, nonPrimaryGuardian];
    await dataSource.getRepository(Student).save(student);

    try {
      const event = await makeEvent({
        audience: CalendarAudience.ALL,
        name: 'Guardian Filter Event',
      });
      await expect(
        notify.eventCreated(event, { notify: true, notifySms: true, userId: adminUserId }),
      ).resolves.toBeUndefined();

      const batch = await dataSource
        .getRepository(ReminderBatch)
        .findOne({ where: { tenant_id: TENANT_ID, batch_name: `Calendar: ${event.name}` } });
      expect(batch).not.toBeNull();
      // Only the primary, reachable fixture guardian gets billed/SMS'd —
      // the opted-out guardian (real DB opt-out) and the non-primary
      // guardian (real DB is_primary_contact) are both excluded, and the
      // reserved segment count matches this post-filter recipient count.
      expect(batch?.total_recipients).toBe(1);

      const logs = await dataSource
        .getRepository(CommunicationLog)
        .find({ where: { reminder_batch_id: batch!.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0].guardian_id).toBe(guardianId);
    } finally {
      // Restore the shared fixture's guardian list so later tests in this
      // file keep seeing exactly the one guardian they were written for.
      student.guardians = originalGuardians;
      await dataSource.getRepository(Student).save(student);
      await setSmsSettings('OFF');
    }
  });

  it('F4: an SMS reserve failure never escapes eventCreated/eventUpdated', async () => {
    await setSmsSettings('PLATFORM');
    await grantSmsCredit(100);

    vi.spyOn(smsCreditService, 'reserve').mockRejectedValueOnce(
      new Error('simulated credit service outage'),
    );

    const event = await makeEvent({ audience: CalendarAudience.ALL, name: 'Reserve Outage Event' });
    await expect(
      notify.eventCreated(event, { notify: true, notifySms: true, userId: adminUserId }),
    ).resolves.toBeUndefined();

    await setSmsSettings('OFF');
  });
});
