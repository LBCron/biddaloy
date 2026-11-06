import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID } from '@test/constants';
import { enrollPlacedStudents } from '@test/helpers/enrollment.helper';
import { DeviceAbsentSweepScheduler } from './device-absent-sweep.scheduler';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceDevice } from './entities/attendance-device.entity';
import { AttendanceDeviceEvent } from './entities/attendance-device-event.entity';
import { Shift } from '../routines/entities/shift.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import {
  AttendanceDeviceKind,
  AttendanceEventDirection,
  AttendanceSessionState,
  AttendanceSource,
  AttendanceStatus,
  DailyAttendanceSource,
} from '@biddaloy/shared';

/** [76.2.04] DEVICE absent sweep against a real DB. Cut-off '00:00' so it never depends on the clock. */
describe('DeviceAbsentSweepScheduler (integration)', () => {
  let sweeper: DeviceAbsentSweepScheduler;
  let dataSource: DataSource;

  const TENANT = SEED_TENANT_ID;
  const OTHER = '00000000-0000-4000-8000-000000000098';
  let sectionId: string;
  let classId: string;
  let otherSectionId: string;
  let studentIds: string[];
  let otherStudentId: string;

  const settings = (dailySource: DailyAttendanceSource) =>
    ({
      version: 1,
      attendance: { weeklyOffDays: [], dailySource, lateAfter: '00:00', absentAfter: '00:00' },
    }) as any;

  async function setSource(tenantId: string, dailySource: DailyAttendanceSource) {
    await dataSource.getRepository(School).update(
      { id: tenantId },
      {
        settings: settings(dailySource),
      },
    );
  }

  async function addScan(tenantId: string, student: string | null) {
    const device = await dataSource.getRepository(AttendanceDevice).save({
      tenant_id: tenantId,
      name: 'gate',
      kind: AttendanceDeviceKind.RFID,
      token_hash: `h-${tenantId}-${Math.random()}`.slice(0, 64),
      token_last4: 'abcd',
    });
    await dataSource.getRepository(AttendanceDeviceEvent).save({
      tenant_id: tenantId,
      device_id: device.id,
      device_event_id: 'e-1',
      student_id: student,
      occurred_at: new Date(),
      direction: AttendanceEventDirection.IN,
      outcome: 'accepted',
    });
  }

  async function mark(student: string, status: AttendanceStatus, source: AttendanceSource) {
    const today = await dataSource.query(`SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date AS d`);
    const date = new Date(today[0].d).toLocaleDateString('en-CA');
    const sessionRepo = dataSource.getRepository(AttendanceSession);
    let session = await sessionRepo.findOne({
      where: { tenant_id: TENANT, section_id: sectionId, date },
    });
    session ??= await sessionRepo.save({
      tenant_id: TENANT,
      section_id: sectionId,
      date,
      period_no: null,
      state: AttendanceSessionState.DRAFT,
      source: AttendanceSource.TEACHER,
    });
    await dataSource.getRepository(AttendanceRecord).save({
      tenant_id: TENANT,
      session_id: session.id,
      student_id: student,
      date,
      status,
      source,
    });
  }

  const records = (tenantId: string) =>
    dataSource.getRepository(AttendanceRecord).find({ where: { tenant_id: tenantId } });

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    sweeper = module.get(DeviceAbsentSweepScheduler);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER } }))) {
      await schoolRepo.save({ id: OTHER, name: 'Sweep Other', slug: 'sweep-other' });
    }
    const seedYear = await dataSource
      .getRepository(AcademicYear)
      .findOneByOrFail({ id: SEED_ACADEMIC_YEAR_ID });
    if (!seedYear.is_current) {
      await dataSource
        .getRepository(AcademicYear)
        .update({ id: seedYear.id }, { is_current: true });
    }
    const klass = await dataSource.getRepository(Class).save({
      name: 'Sweep Class',
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: TENANT,
    });
    classId = klass.id;
    sectionId = (
      await dataSource
        .getRepository(ClassSection)
        .save({ section_name: 'Sweep Sec', class_id: klass.id, tenant_id: TENANT })
    ).id;
    const otherYear = await dataSource.getRepository(AcademicYear).save({
      name: 'Sweep Other Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: true,
      tenant_id: OTHER,
    });
    const otherClass = await dataSource.getRepository(Class).save({
      name: 'Sweep Other Class',
      academic_year_id: otherYear.id,
      tenant_id: OTHER,
    });
    otherSectionId = (
      await dataSource
        .getRepository(ClassSection)
        .save({ section_name: 'Sweep Other Sec', class_id: otherClass.id, tenant_id: OTHER })
    ).id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    await setSource(TENANT, DailyAttendanceSource.DEVICE);
    await setSource(OTHER, DailyAttendanceSource.DEVICE);
    const repo = dataSource.getRepository(Student);
    studentIds = [];
    for (let i = 1; i <= 5; i++) {
      studentIds.push(
        (
          await repo.save({
            full_name: `Sweep ${i}`,
            registration_number: `SW-${i}`,
            roll_number: i,
            class_section_id: sectionId,
            tenant_id: TENANT,
          })
        ).id,
      );
    }
    otherStudentId = (
      await repo.save({
        full_name: 'Sweep Other',
        registration_number: 'SW-O',
        roll_number: 1,
        class_section_id: otherSectionId,
        tenant_id: OTHER,
      })
    ).id;
    await enrollPlacedStudents(dataSource);
  });

  it('marks only the unmarked ABSENT/SYSTEM, audits each, leaves register DRAFT, is re-run safe', async () => {
    await addScan(TENANT, studentIds[0]);
    await mark(studentIds[0], AttendanceStatus.PRESENT, AttendanceSource.DEVICE);
    await mark(studentIds[1], AttendanceStatus.PRESENT, AttendanceSource.DEVICE);
    await mark(studentIds[2], AttendanceStatus.PRESENT, AttendanceSource.DEVICE);
    await mark(studentIds[3], AttendanceStatus.LEAVE, AttendanceSource.TEACHER);
    await mark(studentIds[4], AttendanceStatus.LATE, AttendanceSource.TEACHER);

    // 5 students, all marked: nothing to insert.
    expect(await sweeper.sweepTenant(TENANT)).toBe(0);

    // Add two more unmarked students.
    const repo = dataSource.getRepository(Student);
    const extra = await Promise.all(
      [6, 7].map((i) =>
        repo.save({
          full_name: `Sweep ${i}`,
          registration_number: `SW-${i}`,
          roll_number: i,
          class_section_id: sectionId,
          tenant_id: TENANT,
        }),
      ),
    );
    await enrollPlacedStudents(dataSource);
    const before = await records(TENANT);

    expect(await sweeper.sweepTenant(TENANT)).toBe(2);
    const after = await records(TENANT);
    const added = after.filter((r) => !before.some((b) => b.id === r.id));
    expect(added.map((r) => r.student_id).sort()).toEqual(extra.map((s) => s.id).sort());
    expect(added.every((r) => r.status === AttendanceStatus.ABSENT)).toBe(true);
    expect(added.every((r) => r.source === AttendanceSource.SYSTEM)).toBe(true);
    // D5: existing marks untouched.
    for (const b of before) {
      const a = after.find((r) => r.id === b.id)!;
      expect([a.status, a.source]).toEqual([b.status, b.source]);
    }
    const sessions = await dataSource
      .getRepository(AttendanceSession)
      .find({ where: { tenant_id: TENANT, section_id: sectionId } });
    expect(sessions.every((s) => s.state === AttendanceSessionState.DRAFT)).toBe(true);

    const audits = await dataSource
      .getRepository(AuditLog)
      .find({ where: { tenant_id: TENANT, entity_type: 'AttendanceRecord' } });
    const swept = audits.filter((a) => (a.new_values as any)?.sweep === 'device_absent');
    expect(swept.map((a) => a.entity_id).sort()).toEqual(added.map((r) => r.id).sort());

    // Second run inserts nothing.
    expect(await sweeper.sweepTenant(TENANT)).toBe(0);
    expect((await records(TENANT)).length).toBe(after.length);
  });

  it('does nothing for a tenant with no device scans today, and never touches another tenant', async () => {
    // TENANT has no scans; OTHER has one and its own unmarked student.
    expect(await sweeper.sweepTenant(TENANT)).toBe(0);
    expect(await records(TENANT)).toHaveLength(0);

    await addScan(OTHER, otherStudentId);
    expect(await sweeper.sweepTenant(OTHER)).toBe(1);
    const otherRecords = await records(OTHER);
    expect(otherRecords.map((r) => r.student_id)).toEqual([otherStudentId]);
    // The seed tenant's students stay unmarked.
    expect(await records(TENANT)).toHaveLength(0);
  });

  it('skips the school when every scan is an unknown student', async () => {
    await addScan(TENANT, null);
    expect(await sweeper.sweepTenant(TENANT)).toBe(0);
    expect(await records(TENANT)).toHaveLength(0);
  });

  it('leaves a FINALIZED register alone', async () => {
    await addScan(TENANT, studentIds[0]);
    await mark(studentIds[0], AttendanceStatus.PRESENT, AttendanceSource.DEVICE);
    await dataSource
      .getRepository(AttendanceSession)
      .update(
        { tenant_id: TENANT, section_id: sectionId },
        { state: AttendanceSessionState.FINALIZED },
      );
    expect(await sweeper.sweepTenant(TENANT)).toBe(0);
    expect(await records(TENANT)).toHaveLength(1);
  });

  it('excludes students who left or were deleted, and bumps the session version', async () => {
    await addScan(TENANT, studentIds[0]);
    // 3 leaves the roll (inactive enrollment, no leaving event), 4 is soft-deleted.
    await dataSource.query(
      `UPDATE enrollments SET enrollment_status = 'INACTIVE' WHERE student_id = $1`,
      [studentIds[3]],
    );
    await dataSource.getRepository(Student).softDelete({ id: studentIds[4] });
    expect(await sweeper.sweepTenant(TENANT)).toBe(3);
    const swept = (await records(TENANT)).map((r) => r.student_id);
    expect(swept).not.toContain(studentIds[3]);
    expect(swept).not.toContain(studentIds[4]);
    const session = await dataSource
      .getRepository(AttendanceSession)
      .findOneByOrFail({ tenant_id: TENANT, section_id: sectionId });
    expect(session.version).toBe(2);
  });

  it('skips a class on a class-scoped holiday', async () => {
    await addScan(TENANT, studentIds[0]);
    const today = (await dataSource.query(`SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date AS d`))[0]
      .d;
    const date = new Date(today).toLocaleDateString('en-CA');
    const event = await dataSource.getRepository(CalendarEvent).save({
      tenant_id: TENANT,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      start_date: date,
      end_date: date,
      name: 'Class Break',
      counts_as_working_day: false,
      published_at: new Date(),
    });
    await dataSource
      .getRepository(CalendarEventClass)
      .save({ event_id: event.id, class_id: classId, tenant_id: TENANT });
    try {
      expect(await sweeper.sweepTenant(TENANT)).toBe(0);
      expect(await records(TENANT)).toHaveLength(0);
    } finally {
      await dataSource.getRepository(CalendarEventClass).delete({ event_id: event.id });
      await dataSource.getRepository(CalendarEvent).delete({ id: event.id });
    }
  });

  it('uses the shift own absentAfter: swept after its cut-off, not before', async () => {
    await addScan(TENANT, studentIds[0]);
    const shift = await dataSource.getRepository(Shift).save({
      tenant_id: TENANT,
      name: 'Sweep Shift',
      day_starts_at: '08:00',
      day_ends_at: '14:00',
      sequence: 99,
    });
    await dataSource.getRepository(Class).update({ id: classId }, { shift_id: shift.id });
    const withShift = (absentAfter: string) =>
      dataSource.getRepository(School).update(
        { id: TENANT },
        {
          settings: {
            version: 1,
            attendance: {
              weeklyOffDays: [],
              dailySource: DailyAttendanceSource.DEVICE,
              lateAfter: '00:00',
              absentAfter: '00:00',
              shiftTimes: [{ shiftId: shift.id, lateAfter: '00:00', absentAfter }],
            },
          } as any,
        },
      );
    try {
      await withShift('23:59'); // shift cut-off not reached yet (school-wide one has passed)
      expect(await sweeper.sweepTenant(TENANT)).toBe(0);
      await withShift('00:00');
      expect(await sweeper.sweepTenant(TENANT)).toBe(5);
    } finally {
      await dataSource.getRepository(Class).update({ id: classId }, { shift_id: null });
    }
  });

  it('ignores a school whose source is not DEVICE', async () => {
    await addScan(TENANT, null);
    await setSource(TENANT, DailyAttendanceSource.ANY);
    expect(await sweeper.sweepTenant(TENANT)).toBe(0);
    expect(await records(TENANT)).toHaveLength(0);
  });
});
