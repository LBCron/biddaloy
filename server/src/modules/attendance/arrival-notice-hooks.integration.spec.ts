import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { Queue } from 'bullmq';
import {
  ArrivalNoticeChannel,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
  AttendanceDeviceKind,
  AttendanceEventDirection,
  AttendanceStatus,
  CommunicationTrigger,
  UserRole,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { localDate, localToday } from '../../common/time';
import { enrollPlacedStudents } from '@test/helpers/enrollment.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { AttendanceService } from './attendance.service';
import { DeviceEventsService } from './devices/device-events.service';
import { ArrivalNoticeService } from './arrival-notice.service';
import { DeviceService } from './devices/device.service';
import { AttendanceDevice } from './entities/attendance-device.entity';
import { ArrivalNoticeSubscription } from './entities/arrival-notice-subscription.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { DeviceEventDto } from './dto/device.dto';

/** [84.3.1] Teacher finalize + first device punch both reach ArrivalNoticeService, once per guardian per day. */
describe('Arrival notice hooks (integration)', () => {
  let dataSource: DataSource;
  let queue: Queue;
  let attendance: AttendanceService;
  let devices: DeviceEventsService;
  let deviceService: DeviceService;
  let arrivalService: ArrivalNoticeService;
  const T = SEED_TENANT_ID;
  let sectionId: string;
  let studentIds: string[];
  let guardianIds: string[];

  // The school below runs on UTC, so "today" is the UTC date: the spec and the app read one zone.
  const SCHOOL_TZ = 'UTC';
  const TODAY = () => localToday(SCHOOL_TZ);
  const shiftDays = (days: number) =>
    localDate(new Date(Date.now() + days * 86_400_000), SCHOOL_TZ);
  const YESTERDAY = () => shiftDays(-1);

  async function setSettings(arrival: object | undefined, extra: object = {}) {
    await dataSource.getRepository(School).update(
      { id: T },
      {
        settings: {
          version: 1,
          region: { timezone: SCHOOL_TZ },
          attendance: {
            weeklyOffDays: [],
            lateAfter: '08:15',
            absentAfter: '10:00',
            correctionWindowDays: 2,
            allowFutureDates: false,
            ...(arrival ? { arrivalNotice: arrival } : {}),
            ...extra,
          },
        } as any,
      },
    );
  }

  // This test's students only: a log another test left in flight never counts here.
  const logs = () =>
    dataSource.getRepository(CommunicationLog).find({
      where: {
        tenant_id: T,
        trigger: CommunicationTrigger.ARRIVAL_NOTICE,
        student_id: In(studentIds),
      },
    });

  async function device(): Promise<AttendanceDevice> {
    const { device: d } = await deviceService.create({
      tenantId: T,
      userId: SEED_ADMIN_USER_ID,
      dto: { name: 'Gate', kind: AttendanceDeviceKind.RFID },
      ip: null,
      userAgent: null,
    });
    return dataSource.getRepository(AttendanceDevice).findOneOrFail({ where: { id: d.id } });
  }

  const punch = (studentId: string, time: string, date = TODAY()): DeviceEventDto =>
    ({
      device_event_id: `evt-${randomUUID()}`,
      student_id: studentId,
      occurred_at: `${date}T${time}Z`,
      direction: AttendanceEventDirection.IN,
    }) as DeviceEventDto;

  const put = (
    entries: { student_id: string; status: AttendanceStatus }[],
    overrides: Record<string, unknown> = {},
  ) =>
    attendance.putRegister({
      sectionId,
      tenantId: T,
      role: UserRole.ADMIN,
      userId: SEED_ADMIN_USER_ID,
      ip: '127.0.0.1',
      userAgent: 'vitest',
      dto: {
        date: TODAY(),
        period_no: null,
        base_version: 0,
        client_request_id: randomUUID(),
        finalize: true,
        entries,
        ...overrides,
      } as any,
    });

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
        AttendanceModule,
        AuthModule,
      ],
    );
    dataSource = module.get<DataSource>(getDataSourceToken());
    queue = module.get<Queue>(getQueueToken(COMMUNICATIONS_QUEUE));
    attendance = module.get(AttendanceService);
    devices = module.get(DeviceEventsService);
    deviceService = module.get(DeviceService);
    arrivalService = module.get(ArrivalNoticeService);
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(queue, 'add').mockResolvedValue({} as any);
    await setSettings({ enabled: true, smsAllowed: true });
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `Hooks Year ${Date.now()}-${Math.random()}`,
      start_date: shiftDays(-30),
      end_date: shiftDays(30),
      tenant_id: T,
    });
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: 'Hooks Class', academic_year_id: year.id, tenant_id: T });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: 'HK', class_id: klass.id, tenant_id: T });
    sectionId = section.id;
    studentIds = [];
    guardianIds = [];
    // 3 students; only the first two have an active SMS subscription.
    for (let i = 0; i < 3; i++) {
      const g = await dataSource.getRepository(Guardian).save({
        full_name: `Hooks G${i}`,
        relationship: 'Father',
        phone: `01710${Date.now() % 100000}${i}`,
        notifications_enabled: true,
        tenant_id: T,
        user_id: null,
      } as any);
      const s = await dataSource.getRepository(Student).save({
        full_name: `Hooks S${i}`,
        registration_number: `HK-${Date.now()}-${Math.random()}-${i}`,
        roll_number: 800 + i,
        class_section_id: section.id,
        tenant_id: T,
        guardians: [g],
      } as any);
      studentIds.push(s.id);
      guardianIds.push(g.id);
      if (i < 2) {
        await dataSource.getRepository(ArrivalNoticeSubscription).save({
          tenant_id: T,
          student_id: s.id,
          guardian_id: g.id,
          status: ArrivalNoticeStatus.ACTIVE,
          mode: ArrivalNoticeMode.RECURRING,
          channel: ArrivalNoticeChannel.SMS,
        });
      }
    }
    await enrollPlacedStudents(dataSource, T);
  });

  const allPresent = () =>
    studentIds.map((student_id) => ({ student_id, status: AttendanceStatus.PRESENT }));

  describe('teacher finalize', () => {
    it('PRESENT + LATE (both subscribed) -> 2 arrival logs; the ABSENT student gets none', async () => {
      await put([
        { student_id: studentIds[0], status: AttendanceStatus.PRESENT },
        { student_id: studentIds[1], status: AttendanceStatus.LATE },
        { student_id: studentIds[2], status: AttendanceStatus.ABSENT },
      ]);
      expect(await logs()).toHaveLength(2);
    });

    it('3 PRESENT, 2 subscribed -> 2 logs', async () => {
      await put(allPresent());
      expect(await logs()).toHaveLength(2);
    });

    it('a draft save (finalize false) sends nothing', async () => {
      await put(allPresent(), { finalize: false });
      expect(await logs()).toHaveLength(0);
    });

    it('arrivalNotice.enabled=false sends nothing', async () => {
      await setSettings({ enabled: false, smsAllowed: true });
      await put(allPresent());
      expect(await logs()).toHaveLength(0);
    });

    // A guardian unlinked from the child (custody change) must stop hearing about that child,
    // even though the subscription row survives the unlink.
    it('a guardian unlinked after subscribing gets nothing', async () => {
      await dataSource.query(`DELETE FROM student_guardians WHERE student_id = ANY($1::uuid[])`, [
        studentIds,
      ]);
      await put(allPresent());
      expect(await logs()).toHaveLength(0);
    });

    it('finalizing an earlier day sends nothing (the text says "today")', async () => {
      await put(allPresent(), { date: YESTERDAY() });
      expect(await logs()).toHaveLength(0);
    });

    it('queue failure does not fail the finalize, and the register is saved', async () => {
      vi.spyOn(queue, 'add').mockRejectedValue(new Error('redis down'));
      const res = await put(allPresent());
      expect(res.session.state).toBe('FINALIZED');
    });
  });

  describe('device first punch', () => {
    // The hook is fire-and-forget but is *called* before ingest() returns, so call counts are
    // deterministic; only the resulting log rows are awaited, by condition.
    const waitLogs = (n: number) =>
      vi.waitFor(async () => expect(await logs()).toHaveLength(n), { timeout: 5000 });
    const spySend = () => vi.spyOn(arrivalService, 'sendArrivalNotices');

    it('first punch -> 1 log; second and earlier-timestamped punches do not call again', async () => {
      const spy = spySend();
      const d = await device();
      await devices.ingest(d, [punch(studentIds[0], '02:00:00')]);
      expect(spy).toHaveBeenCalledTimes(1);
      await devices.ingest(d, [punch(studentIds[0], '02:30:00')]);
      await devices.ingest(d, [punch(studentIds[0], '01:30:00')]);
      expect(spy).toHaveBeenCalledTimes(1);
      await waitLogs(1);
      await spy.mock.results[0].value;
    });

    it('a batch of first punches calls the service once, grouped by date', async () => {
      const spy = spySend();
      const date = TODAY(); // one date for both punches, so UTC midnight can't split the batch
      await devices.ingest(await device(), [
        punch(studentIds[0], '02:00:00', date),
        punch(studentIds[1], '02:05:00', date),
      ]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].students).toHaveLength(2);
      // The send is fire-and-forget: wait for it, or it lands in the next test (the CI flake).
      // The rows can exist before the call has finished (credit reservation, queue.add), so
      // also wait for the call itself.
      await waitLogs(2);
      await spy.mock.results[0].value;
    });

    it('punch then teacher finalize the same day -> still 1 log for that guardian', async () => {
      const d = await device();
      await devices.ingest(d, [punch(studentIds[0], '02:00:00')]);
      await waitLogs(1);
      const [{ version }] = await dataSource.query(
        `SELECT version FROM attendance_sessions WHERE tenant_id = $1 AND section_id = $2`,
        [T, sectionId],
      );
      await put([{ student_id: studentIds[0], status: AttendanceStatus.PRESENT }], {
        base_version: version,
      });
      expect(await logs()).toHaveLength(1);
    });

    it('an old punch uploaded late sends nothing (the text says "today")', async () => {
      const spy = spySend();
      await devices.ingest(await device(), [punch(studentIds[0], '02:00:00', YESTERDAY())]);
      expect(spy).toHaveBeenCalledTimes(1);
      await spy.mock.results[0].value;
      expect(await logs()).toHaveLength(0);
    });

    // An arrival notice on a DRAFT register must not trigger a correction: finalize itself sends
    // the absence notice, so a correction here too would message the guardian twice.
    it('arrival, DRAFT correction to ABSENT, then finalize -> exactly one absence notice', async () => {
      await setSettings(
        { enabled: true, smsAllowed: true },
        { autoAbsentNotification: { enabled: true, cutoffTime: '00:00' } },
      );
      const d = await device();
      await devices.ingest(d, [punch(studentIds[0], '02:00:00')]);
      await waitLogs(1);
      // Precondition: the arrival notice counts as "told" (not FAILED).
      expect((await logs())[0].status).not.toBe('FAILED');

      const rec = await dataSource
        .getRepository(AttendanceRecord)
        .findOneByOrFail({ student_id: studentIds[0], tenant_id: T });
      await attendance.correctRecord({
        recordId: rec.id,
        tenantId: T,
        role: UserRole.ADMIN,
        userId: SEED_ADMIN_USER_ID,
        dto: { status: AttendanceStatus.ABSENT, reason: 'Marked by mistake' } as any,
        ip: null,
        userAgent: null,
      });
      const [{ version }] = await dataSource.query(
        `SELECT version FROM attendance_sessions WHERE tenant_id = $1 AND section_id = $2`,
        [T, sectionId],
      );
      await put([{ student_id: studentIds[0], status: AttendanceStatus.ABSENT }], {
        base_version: version,
      });

      const absence = await dataSource.query(
        `SELECT l.id FROM communication_logs l
           JOIN reminder_batches b ON b.id = l.reminder_batch_id
          WHERE l.tenant_id = $1 AND l.guardian_id = $2
            AND b.filters_applied->>'purpose' = 'ABSENCE_NOTICE'`,
        [T, guardianIds[0]],
      );
      expect(absence).toHaveLength(1);
    });

    it('arrivalNotice.enabled=false does not call the service', async () => {
      await setSettings({ enabled: false, smsAllowed: true });
      const spy = spySend();
      await devices.ingest(await device(), [punch(studentIds[0], '02:00:00')]);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
