import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { enrollPlacedStudents } from '@test/helpers/enrollment.helper';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, IsNull } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { AttendanceService } from './attendance.service';
import { AbsenceNoticeService } from './absence-notice.service';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import {
  AttendanceStatus,
  AttendanceSessionState,
  CommunicationMedium,
  CommunicationStatus,
  EnrollmentStatus,
  UserRole,
} from '@biddaloy/shared';
import { Enrollment } from '../students/entities/enrollment.entity';

/**
 * Integration tests for [9.8]'s `AbsenceNoticeService`, run against a real,
 * migrated database plus a real Redis-backed queue (same `BullModule`
 * config `app.module.ts` uses) — `queue.add` in `sendAbsenceNotices` is
 * exercised for real here, not mocked, since the whole point of this
 * module is that it reuses the communications worker's queue unchanged.
 */
describe('AbsenceNoticeService (integration)', () => {
  let attendanceService: AttendanceService;
  let absenceNoticeService: AbsenceNoticeService;
  let dataSource: DataSource;
  let queue: Queue;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';
  const ADMIN_USER_ID = SEED_ADMIN_USER_ID;

  let sectionId: string;
  let studentId1: string;
  let studentId2: string;
  let guardianId: string;

  function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
  function addDays(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return isoDate(d);
  }
  const TODAY = () => addDays(0);

  async function setTenantSettings(
    tenantId: string,
    attendance: Record<string, unknown>,
  ): Promise<void> {
    await dataSource.getRepository(School).update(
      { id: tenantId },
      {
        settings: {
          version: 1,
          attendance,
          region: { timezone: 'Asia/Dhaka' },
        } as any,
      },
    );
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
        AttendanceModule,
        AuthModule,
      ],
    );
    attendanceService = module.get<AttendanceService>(AttendanceService);
    absenceNoticeService = module.get<AbsenceNoticeService>(AbsenceNoticeService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    queue = module.get<Queue>(getQueueToken(COMMUNICATIONS_QUEUE));

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({
        id: OTHER_TENANT,
        name: 'Other School',
        slug: 'absence-notice-other',
      });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    await setTenantSettings(TENANT_ID, {
      weeklyOffDays: [],
      correctionWindowDays: 2,
      allowFutureDates: false,
      autoAbsentNotification: { enabled: true, cutoffTime: '00:00' },
    });

    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);
    const studentRepo = dataSource.getRepository(Student);
    const guardianRepo = dataSource.getRepository(Guardian);

    const year = await yearRepo.save({
      name: `Absence Notice Test Year ${Date.now()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const klass = await classRepo.save({
      name: 'Absence Notice Class',
      academic_year_id: year.id,
      tenant_id: TENANT_ID,
    });
    const section = await sectionRepo.save({
      section_name: 'AN',
      class_id: klass.id,
      tenant_id: TENANT_ID,
    });
    sectionId = section.id;

    const guardian = await guardianRepo.save({
      full_name: 'Guardian One',
      relationship: 'Father',
      phone: '01711111111',
      is_primary_contact: true,
      notifications_enabled: true,
      preferred_communication: CommunicationMedium.SMS,
      tenant_id: TENANT_ID,
    });
    guardianId = guardian.id;

    const s1 = await studentRepo.save({
      full_name: 'Student One',
      registration_number: `AN-REG-1-${Date.now()}`,
      roll_number: 1,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
      guardians: [guardian],
    });
    const s2 = await studentRepo.save({
      full_name: 'Student Two',
      registration_number: `AN-REG-2-${Date.now()}`,
      roll_number: 2,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
      guardians: [guardian],
    });
    studentId1 = s1.id;
    studentId2 = s2.id;
    await enrollPlacedStudents(dataSource, TENANT_ID);
  });

  function basePutDto(overrides: Record<string, unknown> = {}) {
    return {
      date: TODAY(),
      period_no: null,
      base_version: 0,
      client_request_id: randomUUID(),
      finalize: true,
      entries: [
        { student_id: studentId1, status: AttendanceStatus.ABSENT },
        { student_id: studentId2, status: AttendanceStatus.PRESENT },
      ],
      ...overrides,
    } as any;
  }

  function putParams(overrides: Record<string, unknown> = {}) {
    return {
      sectionId,
      tenantId: TENANT_ID,
      role: UserRole.ADMIN,
      userId: ADMIN_USER_ID,
      ip: '127.0.0.1',
      userAgent: 'vitest',
      ...overrides,
    };
  }

  it('finalizing via PUT { finalize: true } creates a batch, stamps notified_at, and queues a job', async () => {
    await attendanceService.putRegister(putParams({ dto: basePutDto() }));

    const session = await dataSource.getRepository(AttendanceSession).findOne({
      where: { tenant_id: TENANT_ID, section_id: sectionId, date: TODAY(), period_no: IsNull() },
    });
    expect(session?.notified_at).not.toBeNull();

    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID }, order: { created_at: 'DESC' } });
    expect(batch).not.toBeNull();
    expect(batch?.total_recipients).toBe(1);

    const logs = await dataSource
      .getRepository(CommunicationLog)
      .find({ where: { reminder_batch_id: batch!.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].guardian_id).toBe(guardianId);
  });

  async function meterTenant(availableCredit: number | null): Promise<void> {
    await dataSource.getRepository(School).update(
      { id: TENANT_ID },
      {
        settings: {
          version: 1,
          attendance: {
            weeklyOffDays: [],
            correctionWindowDays: 2,
            allowFutureDates: false,
            autoAbsentNotification: { enabled: true, cutoffTime: '00:00' },
          },
          communications: { sms: { metering: 'PLATFORM', provider: 'test' } },
          region: { timezone: 'Asia/Dhaka' },
        } as any,
      },
    );
    await dataSource.query(`DELETE FROM sms_credit_balance WHERE tenant_id = $1`, [TENANT_ID]);
    if (availableCredit !== null) {
      await dataSource.query(
        `INSERT INTO sms_credit_balance (tenant_id, available, reserved, updated_at)
         VALUES ($1, $2, 0, now())`,
        [TENANT_ID, availableCredit],
      );
    }
  }

  async function latestBatchLogs(): Promise<CommunicationLog[]> {
    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID }, order: { created_at: 'DESC' } });
    return dataSource
      .getRepository(CommunicationLog)
      .find({ where: { reminder_batch_id: batch!.id } });
  }

  it('metered tenant with 0 credit: no SMS queued, log FAILED INSUFFICIENT_SMS_CREDIT (#2216)', async () => {
    await meterTenant(null);
    const addSpy = vi.spyOn(queue, 'add');

    try {
      await attendanceService.putRegister(putParams({ dto: basePutDto() }));

      const logs = await latestBatchLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('FAILED');
      expect((logs[0].metadata as any).reason).toBe('INSUFFICIENT_SMS_CREDIT');
      // Nothing was queued for this log — the worker never sees it.
      expect(addSpy.mock.calls.some(([, data]) => (data as any)?.logId === logs[0].id)).toBe(false);
    } finally {
      addSpy.mockRestore();
    }
  });

  it('metered tenant with credit: one RESERVE per SMS log and available drops by the segments (#2216)', async () => {
    await meterTenant(10);

    await attendanceService.putRegister(putParams({ dto: basePutDto() }));

    const logs = await latestBatchLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('QUEUED');
    const ledger = await dataSource.query(
      `SELECT kind, units FROM sms_credit_ledger WHERE tenant_id = $1 AND idempotency_key = $2`,
      [TENANT_ID, `batch:${logs[0].id}`],
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe('RESERVE');
    const [bal] = await dataSource.query(
      `SELECT available FROM sms_credit_balance WHERE tenant_id = $1`,
      [TENANT_ID],
    );
    expect(Number(bal.available)).toBe(10 - Number(ledger[0].units));
  });

  it('finalizing the same session twice sends nothing the second time and creates no second batch', async () => {
    await attendanceService.putRegister(putParams({ dto: basePutDto() }));
    const batchCountAfterFirst = await dataSource
      .getRepository(ReminderBatch)
      .count({ where: { tenant_id: TENANT_ID } });

    const result = await absenceNoticeService.sendAbsenceNotices({
      tenantId: TENANT_ID,
      sectionId,
      date: TODAY(),
      initiatedByUserId: ADMIN_USER_ID,
    });

    expect(result.skipped_reason).toBe('already_notified');
    expect(result.batch_id).toBeNull();
    const batchCountAfterSecond = await dataSource
      .getRepository(ReminderBatch)
      .count({ where: { tenant_id: TENANT_ID } });
    expect(batchCountAfterSecond).toBe(batchCountAfterFirst);
  });

  it('does not create a batch when autoAbsentNotification is disabled, but preview still works', async () => {
    await setTenantSettings(TENANT_ID, {
      weeklyOffDays: [],
      correctionWindowDays: 2,
      allowFutureDates: false,
      autoAbsentNotification: { enabled: false, cutoffTime: '00:00' },
    });

    await attendanceService.putRegister(putParams({ dto: basePutDto() }));

    const batchCount = await dataSource
      .getRepository(ReminderBatch)
      .count({ where: { tenant_id: TENANT_ID } });
    expect(batchCount).toBe(0);

    const preview = await absenceNoticeService.previewAbsenceNotice({
      tenantId: TENANT_ID,
      sectionId,
      date: TODAY(),
      userId: ADMIN_USER_ID,
      ip: null,
      userAgent: null,
    });
    expect(preview.recipients).toHaveLength(1);
    expect(preview.recipients[0].guardian_id).toBe(guardianId);
  });

  describe('correction after the notice (D16)', () => {
    let guardianId2: string;
    const OFF = {
      weeklyOffDays: [],
      correctionWindowDays: 2,
      allowFutureDates: false,
      autoAbsentNotification: { enabled: false, cutoffTime: '00:00' },
    };

    beforeEach(async () => {
      // Karim (student 2) gets his own guardian so "that child's guardians only" is observable.
      const g2 = await dataSource.getRepository(Guardian).save({
        full_name: 'Guardian Two',
        relationship: 'Mother',
        phone: '01722222222',
        is_primary_contact: true,
        notifications_enabled: true,
        preferred_communication: CommunicationMedium.SMS,
        tenant_id: TENANT_ID,
      });
      guardianId2 = g2.id;
      await dataSource.getRepository(Student).save({ id: studentId2, guardians: [{ id: g2.id }] });
      // Rahim (student 1) ABSENT, Karim (student 2) PRESENT; finalized -> one notice to guardian 1.
      await attendanceService.putRegister(putParams({ dto: basePutDto() }));
    });

    const allLogs = () =>
      dataSource
        .getRepository(CommunicationLog)
        .find({ where: { tenant_id: TENANT_ID }, order: { created_at: 'ASC' } });

    const setEnglish = () =>
      dataSource.getRepository(School).update(
        { id: TENANT_ID },
        {
          settings: {
            version: 1,
            attendance: { ...OFF, autoAbsentNotification: { enabled: true, cutoffTime: '00:00' } },
            region: { timezone: 'Asia/Dhaka', locale: 'en-US' },
          } as any,
        },
      );

    const correct = async (studentId: string, status: AttendanceStatus) => {
      const rec = await dataSource
        .getRepository(AttendanceRecord)
        .findOneByOrFail({ student_id: studentId, tenant_id: TENANT_ID });
      await attendanceService.correctRecord({
        recordId: rec.id,
        tenantId: TENANT_ID,
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
        dto: { status, reason: 'Marked by mistake' } as any,
        ip: null,
        userAgent: null,
      });
    };

    it("ABSENT -> PRESENT sends one correction, to that child's guardian only; repeating adds nothing", async () => {
      expect(await allLogs()).toHaveLength(1);

      await correct(studentId1, AttendanceStatus.PRESENT);

      const logs = await allLogs();
      expect(logs).toHaveLength(2);
      expect(logs[1].guardian_id).toBe(guardianId);
      // [#3136] The seeded school stores no locale, so it gets the bn-BD default (Bangla).
      expect(logs[1].message_body).toContain('সংশোধন:');
      expect(logs[1].message_body).toContain('Student One');

      // Same correction replayed (e.g. a retried request): the reference key stops a second send.
      await absenceNoticeService.notifyCorrection({
        tenantId: TENANT_ID,
        sessionId: (
          await dataSource.getRepository(AttendanceRecord).findOneByOrFail({
            student_id: studentId1,
            tenant_id: TENANT_ID,
          })
        ).session_id,
        studentId: studentId1,
        oldStatus: AttendanceStatus.ABSENT,
        newStatus: AttendanceStatus.PRESENT,
        userId: ADMIN_USER_ID,
      });
      expect(await allLogs()).toHaveLength(2);
    });

    it("PRESENT -> ABSENT after the notice sends that child's absence notice once, to his guardian only", async () => {
      await setEnglish(); // the seeded school has no locale (Bangla default); pin English to read the text
      await correct(studentId2, AttendanceStatus.ABSENT);

      const logs = await allLogs();
      expect(logs).toHaveLength(2);
      expect(logs[1].guardian_id).toBe(guardianId2);
      expect(logs[1].message_body).toContain('was marked absent today');
      expect(logs[1].message_body).toContain('Student Two');
      expect(logs.filter((l) => l.guardian_id === guardianId)).toHaveLength(1);
    });

    it('bn-BD school gets the Bangla correction text', async () => {
      await dataSource.getRepository(School).update(
        { id: TENANT_ID },
        {
          settings: {
            version: 1,
            attendance: {
              weeklyOffDays: [],
              correctionWindowDays: 2,
              allowFutureDates: false,
              autoAbsentNotification: { enabled: true, cutoffTime: '00:00' },
            },
            region: { timezone: 'Asia/Dhaka', locale: 'bn-BD' },
          } as any,
        },
      );
      await correct(studentId1, AttendanceStatus.PRESENT);
      const logs = await allLogs();
      expect(logs[1].message_body).toContain('সংশোধন:');
      expect(logs[1].message_body).toContain('Student One');
    });

    // #2262: the guardian's latest message must always match the record.
    const purposes = async () =>
      (
        await dataSource.query(
          `SELECT b.filters_applied->>'purpose' AS purpose
             FROM communication_logs l JOIN reminder_batches b ON b.id = l.reminder_batch_id
            WHERE l.tenant_id = $1 AND l.guardian_id = $2 ORDER BY l.created_at`,
          [TENANT_ID, guardianId],
        )
      ).map((r: { purpose: string }) => r.purpose);

    it('ABSENT -> LEAVE says "not absent", never "present"', async () => {
      await setEnglish();
      await correct(studentId1, AttendanceStatus.LEAVE);
      const logs = await allLogs();
      expect(logs).toHaveLength(2);
      expect(logs[1].message_body).toBe(
        `Correction: Student One was not absent on ${TODAY()}. Sorry for the earlier message.`,
      );
    });

    it('ABSENT -> PRESENT -> ABSENT tells the guardian again that the child was absent', async () => {
      await correct(studentId1, AttendanceStatus.PRESENT);
      await correct(studentId1, AttendanceStatus.ABSENT);
      expect(await purposes()).toEqual(['ABSENCE_NOTICE', 'ABSENCE_CORRECTION', 'ABSENCE_NOTICE']);
    });

    it('ABSENT -> PRESENT -> LATE says sorry once', async () => {
      await correct(studentId1, AttendanceStatus.PRESENT);
      await correct(studentId1, AttendanceStatus.LATE);
      expect(await purposes()).toEqual(['ABSENCE_NOTICE', 'ABSENCE_CORRECTION']);
    });

    it('ABSENT -> PRESENT -> ABSENT -> LATE never sends two sorries in a row', async () => {
      await correct(studentId1, AttendanceStatus.PRESENT);
      await correct(studentId1, AttendanceStatus.ABSENT);
      await correct(studentId1, AttendanceStatus.LATE);
      expect(await purposes()).toEqual([
        'ABSENCE_NOTICE',
        'ABSENCE_CORRECTION',
        'ABSENCE_NOTICE',
        'ABSENCE_CORRECTION',
      ]);
    });

    it('a FAILED notice does not count as told: no sorry for a message never received', async () => {
      await dataSource
        .getRepository(CommunicationLog)
        .update({ tenant_id: TENANT_ID }, { status: CommunicationStatus.FAILED });
      await correct(studentId1, AttendanceStatus.PRESENT);
      expect(await allLogs()).toHaveLength(1);
    });

    it('a FAILED notice does not block a first notice when the child is marked absent again', async () => {
      await dataSource
        .getRepository(CommunicationLog)
        .update({ tenant_id: TENANT_ID }, { status: CommunicationStatus.FAILED });
      await correct(studentId1, AttendanceStatus.PRESENT);
      await correct(studentId1, AttendanceStatus.ABSENT);
      const logs = await allLogs();
      expect(logs).toHaveLength(2);
      expect(await purposes()).toEqual(['ABSENCE_NOTICE', 'ABSENCE_NOTICE']);
    });

    it('switch off: a correction sends nothing', async () => {
      await setTenantSettings(TENANT_ID, OFF);
      await correct(studentId1, AttendanceStatus.PRESENT);
      expect(await allLogs()).toHaveLength(1);
    });
  });

  it('#2269: a child who left the section after being marked absent gets no notice', async () => {
    await attendanceService.putRegister(putParams({ dto: basePutDto({ finalize: false }) }));
    await dataSource
      .getRepository(Enrollment)
      .update(
        { student_id: studentId1, tenant_id: TENANT_ID },
        { enrollment_status: EnrollmentStatus.TRANSFERRED },
      );
    await dataSource
      .getRepository(AttendanceSession)
      .update(
        { section_id: sectionId, tenant_id: TENANT_ID },
        { state: AttendanceSessionState.FINALIZED },
      );

    const result = await absenceNoticeService.sendAbsenceNotices({
      tenantId: TENANT_ID,
      sectionId,
      date: TODAY(),
      initiatedByUserId: ADMIN_USER_ID,
    });

    expect(result.total_recipients).toBe(0);
  });

  it('does nothing for a DRAFT (not finalized) session', async () => {
    await attendanceService.putRegister(putParams({ dto: basePutDto({ finalize: false }) }));

    const result = await absenceNoticeService.sendAbsenceNotices({
      tenantId: TENANT_ID,
      sectionId,
      date: TODAY(),
      initiatedByUserId: ADMIN_USER_ID,
    });

    expect(result.skipped_reason).toBe('not_finalized');
    expect(result.batch_id).toBeNull();
  });

  it("never lets tenant B's guardians appear in tenant A's batch", async () => {
    const otherSectionRepo = dataSource.getRepository(ClassSection);
    const otherYearRepo = dataSource.getRepository(AcademicYear);
    const otherClassRepo = dataSource.getRepository(Class);
    const otherStudentRepo = dataSource.getRepository(Student);
    const otherGuardianRepo = dataSource.getRepository(Guardian);

    const otherYear = await otherYearRepo.save({
      name: 'Other Tenant Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: OTHER_TENANT,
    });
    const otherClass = await otherClassRepo.save({
      name: 'Other Class',
      academic_year_id: otherYear.id,
      tenant_id: OTHER_TENANT,
    });
    const otherSection = await otherSectionRepo.save({
      section_name: 'OTH',
      class_id: otherClass.id,
      tenant_id: OTHER_TENANT,
    });
    const otherGuardian = await otherGuardianRepo.save({
      full_name: 'Other Tenant Guardian',
      relationship: 'Mother',
      phone: '01799999999',
      is_primary_contact: true,
      notifications_enabled: true,
      preferred_communication: CommunicationMedium.SMS,
      tenant_id: OTHER_TENANT,
    });
    await otherStudentRepo.save({
      full_name: 'Other Tenant Student',
      registration_number: `OTH-REG-${Date.now()}`,
      roll_number: 1,
      class_section_id: otherSection.id,
      tenant_id: OTHER_TENANT,
      guardians: [otherGuardian],
    });
    await enrollPlacedStudents(dataSource, OTHER_TENANT);

    // Tenant A's send only ever resolves tenant A's own section/students —
    // there is no shared code path that could cross tenant_id boundaries,
    // but this asserts the observable outcome directly.
    await attendanceService.putRegister(putParams({ dto: basePutDto() }));

    const batch = await dataSource
      .getRepository(ReminderBatch)
      .findOne({ where: { tenant_id: TENANT_ID }, order: { created_at: 'DESC' } });
    const logs = await dataSource
      .getRepository(CommunicationLog)
      .find({ where: { reminder_batch_id: batch!.id } });
    expect(logs.every((l) => l.guardian_id === guardianId)).toBe(true);
    expect(logs.some((l) => l.guardian_id === otherGuardian.id)).toBe(false);
  });

  it('resolves nothing for a section+date with no session at all', async () => {
    const result = await absenceNoticeService.sendAbsenceNotices({
      tenantId: TENANT_ID,
      sectionId,
      date: addDays(30),
      initiatedByUserId: ADMIN_USER_ID,
    });

    expect(result.skipped_reason).toBe('no_session');
    expect(result.batch_id).toBeNull();
  });
});
