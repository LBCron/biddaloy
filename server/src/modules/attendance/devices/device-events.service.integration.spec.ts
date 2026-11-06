import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import {
  AttendanceDeviceKind,
  AttendanceEventDirection,
  AttendanceSource,
  AttendanceStatus,
  AttendanceSubjectType,
  EnrollmentStatus,
} from '@biddaloy/shared';
import { DeviceEventsService } from './device-events.service';
import { DeviceService } from './device.service';
import { AttendanceModule } from '../attendance.module';
import { AuthModule } from '../../auth/auth.module';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Shift } from '../../routines/entities/shift.entity';
import { Student } from '../../students/entities/student.entity';
import { AttendanceDevice } from '../entities/attendance-device.entity';
import { AttendanceDeviceEvent } from '../entities/attendance-device-event.entity';
import { AttendanceRecord } from '../entities/attendance-record.entity';
import { AttendanceSession } from '../entities/attendance-session.entity';
import { DeviceEventDto } from '../dto/device.dto';
import { StaffProfile } from '../../staff-profiles/entities/staff-profile.entity';
import { StaffAttendanceRecord } from '../../staff-attendance/entities/staff-attendance-record.entity';
import { User } from '../../users/entities/user.entity';

describe('DeviceEventsService (integration)', () => {
  let service: DeviceEventsService;
  let deviceService: DeviceService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';

  let sectionId: string;
  let otherSectionId: string;
  let otherSectionForOtherTenantId: string;
  let studentId: string;
  let otherTenantStudentId: string;

  function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
  const TODAY = () => isoDate(new Date());

  // `region.timezone` is pinned to UTC — the default is Asia/Dhaka
  // (UTC+6), which would otherwise shift every occurred_at in this file
  // onto a different local date/time than the literal Z-suffixed string
  // suggests.
  async function setTenantSettings(
    tenantId: string,
    attendance: Record<string, unknown>,
  ): Promise<void> {
    await dataSource
      .getRepository(School)
      .update(
        { id: tenantId },
        { settings: { version: 1, region: { timezone: 'UTC' }, attendance } as any },
      );
  }

  async function createActiveDevice(overrides: Record<string, unknown> = {}) {
    const { device } = await deviceService.create({
      tenantId: TENANT_ID,
      userId: SEED_ADMIN_USER_ID,
      dto: { name: 'Test Device', kind: AttendanceDeviceKind.RFID, ...overrides },
      ip: null,
      userAgent: null,
    });
    // `DeviceService.create` returns the API-facing `DeviceResponseDto`
    // (no `token_hash`); the ingest service needs the full entity.
    return dataSource.getRepository(AttendanceDevice).findOneOrFail({ where: { id: device.id } });
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get<DeviceEventsService>(DeviceEventsService);
    deviceService = module.get<DeviceService>(DeviceService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({
        id: OTHER_TENANT,
        name: 'Other Device School',
        slug: 'other-device-school',
      });
    }

    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    const year = await yearRepo.save({
      name: 'Device Events Test Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const klass = await classRepo.save({
      name: 'Device Events Test Class',
      academic_year_id: year.id,
      tenant_id: TENANT_ID,
    });
    const section = await sectionRepo.save({
      section_name: 'Dev Section',
      class_id: klass.id,
      tenant_id: TENANT_ID,
    });
    sectionId = section.id;

    const otherSection = await sectionRepo.save({
      section_name: 'Dev Section 2',
      class_id: klass.id,
      tenant_id: TENANT_ID,
    });
    otherSectionId = otherSection.id;

    const otherYear = await yearRepo.save({
      name: 'Other Tenant Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: OTHER_TENANT,
    });
    const otherClass = await classRepo.save({
      name: 'Other Tenant Class',
      academic_year_id: otherYear.id,
      tenant_id: OTHER_TENANT,
    });
    const otherTenantSection = await sectionRepo.save({
      section_name: 'Other Tenant Section',
      class_id: otherClass.id,
      tenant_id: OTHER_TENANT,
    });
    otherSectionForOtherTenantId = otherTenantSection.id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await setTenantSettings(TENANT_ID, {
      weeklyOffDays: [],
      lateAfter: '08:15',
      absentAfter: '10:00',
      correctionWindowDays: 2,
      allowFutureDates: false,
    });

    const studentRepo = dataSource.getRepository(Student);
    const student = await studentRepo.save({
      full_name: 'Device Test Student',
      registration_number: `DEV-REG-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      roll_number: 1,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });

    // `students` is transactional (truncated before every test), so the
    // other-tenant fixture is re-created here too, not just in beforeAll.
    const otherTenantStudent = await studentRepo.save({
      full_name: 'Other Tenant Student',
      registration_number: `OTHER-REG-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      roll_number: 1,
      class_section_id: otherSectionForOtherTenantId,
      tenant_id: OTHER_TENANT,
    });
    otherTenantStudentId = otherTenantStudent.id;
    studentId = student.id;
  });

  function inEvent(overrides: Partial<DeviceEventDto> = {}): DeviceEventDto {
    return {
      device_event_id: `evt-${Date.now()}-${Math.random()}`,
      occurred_at: `${TODAY()}T02:00:00Z`,
      direction: AttendanceEventDirection.IN,
      ...overrides,
    } as DeviceEventDto;
  }

  it('reports "duplicate" on the second post of the same device_event_id, writing one record', async () => {
    const device = await createActiveDevice();
    const event = inEvent({ student_id: studentId });

    const first = await service.ingest(device, [event]);
    const second = await service.ingest(device, [event]);

    expect(first.results[0].outcome).toBe('accepted');
    expect(second.results[0].outcome).toBe('duplicate');

    const records = await dataSource
      .getRepository(AttendanceRecord)
      .find({ where: { student_id: studentId } });
    expect(records).toHaveLength(1);
  });

  it('classifies PRESENT at/under lateAfter and LATE just after it', async () => {
    const device = await createActiveDevice();

    const onTime = await service.ingest(device, [
      inEvent({ student_id: studentId, occurred_at: `${TODAY()}T08:15:00Z` }),
    ]);
    expect(onTime.results[0].status).toBe(AttendanceStatus.PRESENT);

    const other = await dataSource.getRepository(Student).save({
      full_name: 'Second Device Student',
      registration_number: `DEV-REG-B-${Date.now()}`,
      roll_number: 2,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });
    const late = await service.ingest(device, [
      inEvent({ student_id: other.id, occurred_at: `${TODAY()}T08:16:00Z` }),
    ]);
    expect(late.results[0].status).toBe(AttendanceStatus.LATE);
  });

  it('never overwrites a TEACHER-marked record, but fills a null check_in_at', async () => {
    const device = await createActiveDevice();

    const session = await dataSource.getRepository(AttendanceSession).save({
      tenant_id: TENANT_ID,
      section_id: sectionId,
      date: TODAY(),
      period_no: null,
      source: AttendanceSource.TEACHER,
    });
    const record = await dataSource.getRepository(AttendanceRecord).save({
      tenant_id: TENANT_ID,
      session_id: session.id,
      student_id: studentId,
      date: TODAY(),
      status: AttendanceStatus.PRESENT,
      source: AttendanceSource.TEACHER,
      check_in_at: null,
    });

    const result = await service.ingest(device, [
      inEvent({ student_id: studentId, occurred_at: `${TODAY()}T09:00:00Z` }),
    ]);

    expect(result.results[0].outcome).toBe('skipped_teacher_marked');

    const updated = await dataSource.getRepository(AttendanceRecord).findOneOrFail({
      where: { id: record.id },
    });
    expect(updated.status).toBe(AttendanceStatus.PRESENT); // untouched
    expect(updated.check_in_at).not.toBeNull(); // filled
  });

  describe('special timings (SENSE-09)', () => {
    const special = (from: string, to: string) => ({
      name: 'Ramadan',
      from,
      to,
      shiftId: null,
      lateAfter: '08:45',
      absentAfter: '09:30',
      periods: [],
    });
    const withSpecial = (from: string, to: string) =>
      setTenantSettings(TENANT_ID, {
        weeklyOffDays: [],
        lateAfter: '08:15',
        absentAfter: '10:00',
        correctionWindowDays: 2,
        allowFutureDates: false,
        specialTimings: [special(from, to)],
      });

    it('08:40 is PRESENT on a date inside a special timing with lateAfter 08:45', async () => {
      await withSpecial(TODAY(), TODAY());
      const r = await service.ingest(await createActiveDevice(), [
        inEvent({ student_id: studentId, occurred_at: `${TODAY()}T08:40:00Z` }),
      ]);
      expect(r.results[0].status).toBe(AttendanceStatus.PRESENT);
    });

    it('the same scan is LATE on a normal date (lateAfter 08:15)', async () => {
      await withSpecial('2000-01-01', '2000-01-31');
      const r = await service.ingest(await createActiveDevice(), [
        inEvent({ student_id: studentId, occurred_at: `${TODAY()}T08:40:00Z` }),
      ]);
      expect(r.results[0].status).toBe(AttendanceStatus.LATE);
    });

    // The device must see the same cut-offs the server classifies against.
    it("heartbeat sends today's special cut-offs", async () => {
      await withSpecial(TODAY(), TODAY());
      const hb = await service.heartbeat(await createActiveDevice());
      expect(hb.policy).toEqual({ late_after: '08:45', absent_after: '09:30' });
    });
  });

  describe('shift-aware lateness [41.0]', () => {
    // Tenant pair 08:15 / 10:00; the day shift overrides it to 12:15 / 14:00.
    async function setup(withShiftTimes = true) {
      // Unique names per call: shifts/classes/sections are not truncated between tests.
      const uniq = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const dayShift = await dataSource.getRepository(Shift).save({
        tenant_id: TENANT_ID,
        name: `Day shift ${uniq}`,
        day_starts_at: '12:00',
        day_ends_at: '17:00',
        sequence: 2,
      });
      await setTenantSettings(TENANT_ID, {
        weeklyOffDays: [],
        lateAfter: '08:15',
        absentAfter: '10:00',
        correctionWindowDays: 2,
        allowFutureDates: false,
        shiftTimes: withShiftTimes
          ? [{ shiftId: dayShift.id, lateAfter: '12:15', absentAfter: '14:00' }]
          : [],
      });
      const classRepo = dataSource.getRepository(Class);
      const base = await classRepo.findOneOrFail({ where: { name: 'Device Events Test Class' } });
      const dayClass = await classRepo.save({
        name: `Day Class ${uniq}`,
        academic_year_id: base.academic_year_id,
        tenant_id: TENANT_ID,
        shift_id: dayShift.id,
      });
      const daySection = await dataSource.getRepository(ClassSection).save({
        section_name: `Day ${uniq}`.slice(0, 20),
        class_id: dayClass.id,
        tenant_id: TENANT_ID,
      });
      const dayStudent = await dataSource.getRepository(Student).save({
        full_name: 'Day Student',
        registration_number: `DAY-${uniq}`,
        roll_number: 1,
        class_section_id: daySection.id,
        tenant_id: TENANT_ID,
      });
      return dayStudent.id;
    }

    it('judges a day-shift student against the shift times', async () => {
      const dayStudentId = await setup();
      const device = await createActiveDevice();

      const late = await service.ingest(device, [
        inEvent({ student_id: dayStudentId, occurred_at: `${TODAY()}T12:20:00Z` }),
      ]);
      expect(late.results[0].status).toBe(AttendanceStatus.LATE);
      expect(late.results[0].minutes_late).toBe(5);
    });

    it('marks a day-shift student at 12:00 PRESENT (before the shift pair)', async () => {
      const dayStudentId = await setup();
      const device = await createActiveDevice();

      const r = await service.ingest(device, [
        inEvent({ student_id: dayStudentId, occurred_at: `${TODAY()}T12:00:00Z` }),
      ]);
      expect(r.results[0].status).toBe(AttendanceStatus.PRESENT);
    });

    it('keeps the tenant pair for a class with a shift_id but no shiftTimes entry', async () => {
      const dayStudentId = await setup(false);
      const device = await createActiveDevice();

      const r = await service.ingest(device, [
        inEvent({ student_id: dayStudentId, occurred_at: `${TODAY()}T08:30:00Z` }),
      ]);
      expect(r.results[0].status).toBe(AttendanceStatus.LATE);
      expect(r.results[0].minutes_late).toBe(15);
    });

    it('keeps the tenant pair for a class with no shift_id', async () => {
      await setup();
      const device = await createActiveDevice();

      const r = await service.ingest(device, [
        inEvent({ student_id: studentId, occurred_at: `${TODAY()}T08:30:00Z` }),
      ]);
      expect(r.results[0].status).toBe(AttendanceStatus.LATE);
      expect(r.results[0].minutes_late).toBe(15);
    });
  });

  describe('check-out targets the day register only [41.0 carry-forward]', () => {
    async function periodRecord() {
      const session = await dataSource.getRepository(AttendanceSession).save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        date: TODAY(),
        period_no: 1,
        source: AttendanceSource.TEACHER,
      });
      return dataSource.getRepository(AttendanceRecord).save({
        tenant_id: TENANT_ID,
        session_id: session.id,
        student_id: studentId,
        date: TODAY(),
        status: AttendanceStatus.PRESENT,
        source: AttendanceSource.TEACHER,
      });
    }

    it('rejects OUT when only a period record exists (old code wrote onto it)', async () => {
      const period = await periodRecord();
      const device = await createActiveDevice();

      const r = await service.ingest(device, [
        inEvent({
          student_id: studentId,
          direction: AttendanceEventDirection.OUT,
          occurred_at: `${TODAY()}T16:00:00Z`,
        }),
      ]);

      expect(r.results[0].reason).toBe('no_check_in');
      const after = await dataSource
        .getRepository(AttendanceRecord)
        .findOneOrFail({ where: { id: period.id } });
      expect(after.check_out_at).toBeNull();
    });

    it('writes check_out_at onto the day record, not the period record', async () => {
      const device = await createActiveDevice();
      await service.ingest(device, [inEvent({ student_id: studentId })]);
      const period = await periodRecord();

      await service.ingest(device, [
        inEvent({
          student_id: studentId,
          direction: AttendanceEventDirection.OUT,
          occurred_at: `${TODAY()}T16:00:00Z`,
        }),
      ]);

      const records = await dataSource
        .getRepository(AttendanceRecord)
        .find({ where: { student_id: studentId } });
      expect(records.find((x) => x.id === period.id)?.check_out_at).toBeNull();
      expect(records.find((x) => x.id !== period.id)?.check_out_at).not.toBeNull();
    });
  });

  it('rejects an OUT event with no prior IN as "no_check_in"', async () => {
    const device = await createActiveDevice();

    const result = await service.ingest(device, [
      inEvent({
        student_id: studentId,
        direction: AttendanceEventDirection.OUT,
        occurred_at: `${TODAY()}T16:00:00Z`,
      }),
    ]);

    expect(result.results[0].outcome).toBe('rejected');
    expect(result.results[0].reason).toBe('no_check_in');
  });

  it('rejects an event more than 2 days from today as "out_of_window"', async () => {
    const device = await createActiveDevice();

    const result = await service.ingest(device, [
      inEvent({ student_id: studentId, occurred_at: '2024-01-01T02:00:00Z' }),
    ]);

    expect(result.results[0].outcome).toBe('out_of_window');
  });

  it('reports unknown_student for a student_id belonging to a different tenant', async () => {
    const device = await createActiveDevice();

    const result = await service.ingest(device, [inEvent({ student_id: otherTenantStudentId })]);

    expect(result.results[0].outcome).toBe('unknown_student');
  });

  it('rejects a section-bound device scanning a student from a different section', async () => {
    const device = await createActiveDevice({ section_id: otherSectionId });

    const result = await service.ingest(device, [inEvent({ student_id: studentId })]);

    expect(result.results[0].outcome).toBe('rejected');
    expect(result.results[0].reason).toBe('section_mismatch');
  });

  it('rejects a scan for a student who left as not_on_roll and writes no record (#1805)', async () => {
    const device = await createActiveDevice();
    await dataSource
      .getRepository(Student)
      .update({ id: studentId }, { enrollment_status: EnrollmentStatus.INACTIVE });

    const result = await service.ingest(device, [inEvent({ student_id: studentId })]);

    expect(result.results[0].outcome).toBe('rejected');
    expect(result.results[0].reason).toBe('not_on_roll');
    expect(await dataSource.getRepository(AttendanceRecord).count()).toBe(0);
  });

  it('getRoster omits a student who left and keeps an active one (#1805)', async () => {
    const device = await createActiveDevice({ roster_access: true, section_id: sectionId });
    const stayer = await dataSource.getRepository(Student).save({
      full_name: 'Stayer',
      registration_number: `DEV-STAY-${Date.now()}`,
      roll_number: 2,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });
    await dataSource
      .getRepository(Student)
      .update({ id: studentId }, { enrollment_status: EnrollmentStatus.INACTIVE });

    const roster = await service.getRoster(device);

    expect(roster.map((r) => r.student_id)).toEqual([stayer.id]);
  });

  it('resolves a student scan whose external_ref is a card_no, and still resolves by registration number', async () => {
    const device = await createActiveDevice();
    const card = `CARD-${Date.now()}`;
    const repo = dataSource.getRepository(Student);
    await repo.update({ id: studentId }, { card_no: card });
    const reg = (await repo.findOneOrFail({ where: { id: studentId } })).registration_number;

    const byCard = await service.ingest(device, [inEvent({ external_ref: card })]);
    expect(byCard.results[0].outcome).toBe('accepted');
    const byReg = await service.ingest(device, [inEvent({ external_ref: reg })]);
    // Same student, same day: resolved (not unknown_student).
    expect(byReg.results[0].outcome).not.toBe('unknown_student');
  });

  it("resolves to the student whose registration number equals another student's card_no (registration number wins)", async () => {
    const device = await createActiveDevice();
    const repo = dataSource.getRepository(Student);
    const b = await repo.save({
      full_name: 'Reg Owner B',
      registration_number: `COLLIDE-${Date.now()}`,
      roll_number: 7,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });
    // Student A (the default fixture) carries B's registration number as its card.
    await repo.update({ id: studentId }, { card_no: b.registration_number });

    const result = await service.ingest(device, [inEvent({ external_ref: b.registration_number })]);

    expect(result.results[0].outcome).toBe('accepted');
    const records = await dataSource.getRepository(AttendanceRecord).find();
    expect(records.map((r) => r.student_id)).toEqual([b.id]);
  });

  it("reports unknown_student for another tenant's card_no (tenant isolation)", async () => {
    const device = await createActiveDevice(); // bound to TENANT_ID
    const card = `OTHER-CARD-${Date.now()}`;
    await dataSource.getRepository(Student).update({ id: otherTenantStudentId }, { card_no: card });

    const result = await service.ingest(device, [inEvent({ external_ref: card })]);

    expect(result.results[0].outcome).toBe('unknown_student');
  });

  it('getRoster lists card_no, null for a student without a card', async () => {
    const device = await createActiveDevice({ roster_access: true, section_id: sectionId });
    await dataSource
      .getRepository(Student)
      .update({ id: studentId }, { card_no: `RC-${Date.now()}` });
    const nocard = await dataSource.getRepository(Student).save({
      full_name: 'No Card',
      registration_number: `DEV-NOCARD-${Date.now()}`,
      roll_number: 3,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });

    const roster = await service.getRoster(device);

    expect(roster.find((r) => r.student_id === nocard.id)?.card_no).toBeNull();
    expect(roster.find((r) => r.student_id === studentId)?.card_no).toMatch(/^RC-/);
  });

  it('reports unknown_student when neither student_id nor external_ref is given', async () => {
    const device = await createActiveDevice();

    const result = await service.ingest(device, [inEvent()]);

    expect(result.results[0].outcome).toBe('unknown_student');
  });

  it('reports unknown_student when both student_id and external_ref are given, rather than silently preferring one', async () => {
    const device = await createActiveDevice();

    const result = await service.ingest(device, [
      inEvent({ student_id: studentId, external_ref: 'REG-DOES-NOT-MATTER' }),
    ]);

    expect(result.results[0].outcome).toBe('unknown_student');
    // Confirms it never created a mark for `studentId` from the ambiguous event.
    const records = await dataSource
      .getRepository(AttendanceRecord)
      .find({ where: { student_id: studentId } });
    expect(records).toHaveLength(0);
  });

  it('reports unknown_student for a soft-deleted student, and creates no record', async () => {
    const device = await createActiveDevice();
    const deletedStudent = await dataSource.getRepository(Student).save({
      full_name: 'Soft Deleted Student',
      registration_number: `DEV-REG-DELETED-${Date.now()}`,
      roll_number: 9,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });
    await dataSource.getRepository(Student).softDelete(deletedStudent.id);

    const result = await service.ingest(device, [inEvent({ student_id: deletedStudent.id })]);

    expect(result.results[0].outcome).toBe('unknown_student');
    const records = await dataSource
      .getRepository(AttendanceRecord)
      .find({ where: { student_id: deletedStudent.id } });
    expect(records).toHaveLength(0);
  });

  describe('subject_type: STAFF', () => {
    let staffProfileId: string;

    beforeEach(async () => {
      const user = await dataSource.getRepository(User).save({
        full_name: 'Device Test Staff',
        email: `device-staff-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`,
        password_hash: 'x',
      });
      const profile = await dataSource.getRepository(StaffProfile).save({
        user_id: user.id,
        tenant_id: TENANT_ID,
        employee_id: `EMP-DEV-${Date.now()}`,
      });
      staffProfileId = profile.id;
    });

    it('creates a StaffAttendanceRecord for a subject_type: STAFF event with a valid employee_id external_ref', async () => {
      const device = await createActiveDevice();

      const result = await service.ingest(device, [
        inEvent({
          subject_type: AttendanceSubjectType.STAFF,
          external_ref: (
            await dataSource.getRepository(StaffProfile).findOneOrFail({
              where: { id: staffProfileId },
            })
          ).employee_id,
        }),
      ]);

      expect(result.results[0].outcome).toBe('accepted');
      const records = await dataSource
        .getRepository(StaffAttendanceRecord)
        .find({ where: { staff_profile_id: staffProfileId } });
      expect(records).toHaveLength(1);
    });

    it('reports unknown_staff for an external_ref with no matching employee_id', async () => {
      const device = await createActiveDevice();

      const result = await service.ingest(device, [
        inEvent({ subject_type: AttendanceSubjectType.STAFF, external_ref: 'NO-SUCH-EMPLOYEE' }),
      ]);

      expect(result.results[0].outcome).toBe('unknown_staff');
    });

    it('never overwrites a manually-marked staff record, but fills a null check_in_at', async () => {
      const device = await createActiveDevice();
      const employeeId = (
        await dataSource
          .getRepository(StaffProfile)
          .findOneOrFail({ where: { id: staffProfileId } })
      ).employee_id;

      // Seed a manual (TEACHER-sourced, i.e. admin/self-marked) record first.
      const first = await service.ingest(device, [
        inEvent({ subject_type: AttendanceSubjectType.STAFF, external_ref: employeeId }),
      ]);
      expect(first.results[0].outcome).toBe('accepted');
      await dataSource
        .getRepository(StaffAttendanceRecord)
        .update(
          { staff_profile_id: staffProfileId },
          { source: AttendanceSource.TEACHER, check_in_at: null },
        );

      const second = await service.ingest(device, [
        inEvent({
          subject_type: AttendanceSubjectType.STAFF,
          external_ref: employeeId,
          occurred_at: `${TODAY()}T09:00:00Z`,
        }),
      ]);

      expect(second.results[0].outcome).toBe('skipped_teacher_marked');
      const updated = await dataSource
        .getRepository(StaffAttendanceRecord)
        .findOneOrFail({ where: { staff_profile_id: staffProfileId } });
      expect(updated.check_in_at).not.toBeNull(); // filled
    });

    it('keeps STUDENT-path behavior unchanged when subject_type is omitted', async () => {
      const device = await createActiveDevice();

      const result = await service.ingest(device, [inEvent({ student_id: studentId })]);

      expect(result.results[0].outcome).toBe('accepted');
    });

    it("resolves to the staff whose employee_id equals another staff's card_no (employee_id wins)", async () => {
      const device = await createActiveDevice();
      const user = await dataSource.getRepository(User).save({
        full_name: 'Collide Staff B',
        email: `collide-staff-${Date.now()}@example.com`,
        password_hash: 'x',
      });
      const staffB = await dataSource.getRepository(StaffProfile).save({
        user_id: user.id,
        tenant_id: TENANT_ID,
        employee_id: `EMP-COLLIDE-${Date.now()}`,
      });
      await dataSource
        .getRepository(StaffProfile)
        .update({ id: staffProfileId }, { card_no: staffB.employee_id });

      const result = await service.ingest(device, [
        inEvent({ subject_type: AttendanceSubjectType.STAFF, external_ref: staffB.employee_id }),
      ]);

      expect(result.results[0].outcome).toBe('accepted');
      const records = await dataSource.getRepository(StaffAttendanceRecord).find();
      expect(records.map((r) => r.staff_profile_id)).toEqual([staffB.id]);
    });

    it('resolves a staff scan by card_no, but never by a student card_no (D37)', async () => {
      const device = await createActiveDevice();
      const staffCard = `SCARD-${Date.now()}`;
      await dataSource
        .getRepository(StaffProfile)
        .update({ id: staffProfileId }, { card_no: staffCard });
      const studentCard = `STUCARD-${Date.now()}`;
      await dataSource.getRepository(Student).update({ id: studentId }, { card_no: studentCard });

      const ok = await service.ingest(device, [
        inEvent({ subject_type: AttendanceSubjectType.STAFF, external_ref: staffCard }),
      ]);
      expect(ok.results[0].outcome).toBe('accepted');

      const bad = await service.ingest(device, [
        inEvent({ subject_type: AttendanceSubjectType.STAFF, external_ref: studentCard }),
      ]);
      expect(bad.results[0].outcome).toBe('unknown_staff');
    });

    it("reports unknown_staff for another tenant's employee_id (tenant isolation)", async () => {
      const device = await createActiveDevice(); // bound to TENANT_ID
      const otherUser = await dataSource.getRepository(User).save({
        full_name: 'Other Tenant Staff',
        email: `other-tenant-staff-${Date.now()}@example.com`,
        password_hash: 'x',
      });
      const sameEmployeeId = `EMP-CROSS-${Date.now()}`;
      await dataSource.getRepository(StaffProfile).save({
        user_id: otherUser.id,
        tenant_id: OTHER_TENANT,
        employee_id: sameEmployeeId,
      });

      const result = await service.ingest(device, [
        inEvent({ subject_type: AttendanceSubjectType.STAFF, external_ref: sameEmployeeId }),
      ]);

      expect(result.results[0].outcome).toBe('unknown_staff');
    });
  });
});
