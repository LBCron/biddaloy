import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { Student } from '../students/entities/student.entity';
import { AttendanceDevice } from './entities/attendance-device.entity';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceDeviceEvent } from './entities/attendance-device-event.entity';
import {
  AttendanceDeviceKind,
  AttendanceEventDirection,
  AttendanceStatus,
  EnrollmentStatus,
} from '@biddaloy/shared';

/**
 * Integration tests for the [9.2] attendance entities — run against the
 * real, migrated test database (not `{ synchronize: true, dropSchema: true }`
 * — see `server/CLAUDE.md`'s note on why: the migration's raw-SQL
 * `COALESCE` unique index and the `calendar_events` check constraint are
 * migration-only objects that TypeORM's entity-driven schema sync cannot
 * express, so a `dropSchema` connection would silently rebuild the schema
 * without them and this suite would pass for the wrong reason).
 */
describe('attendance entities (integration)', () => {
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  let academicYearId: string;
  let classId: string;
  let sectionId: string;
  let studentId: string;

  let otherAcademicYearId: string;
  let otherClassId: string;
  let otherSectionId: string;
  let otherStudentId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: TENANT_ID } }))) {
      await schoolRepo.save({ id: TENANT_ID, name: 'Test School', slug: 'test-school' });
    }
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  async function seedSection(tenantId: string) {
    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);
    const studentRepo = dataSource.getRepository(Student);

    const year = await yearRepo.save({
      name: '2026-2027',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: tenantId,
    });
    const klass = await classRepo.save({
      name: 'Class 6',
      academic_year_id: year.id,
      tenant_id: tenantId,
    });
    const section = await sectionRepo.save({
      section_name: 'A',
      class_id: klass.id,
      tenant_id: tenantId,
    });
    const student = await studentRepo.save({
      full_name: 'Test Student',
      registration_number: `REG-${tenantId.slice(-4)}`,
      roll_number: 1,
      class_section_id: section.id,
      tenant_id: tenantId,
      enrollment_status: EnrollmentStatus.ACTIVE,
    });

    return { yearId: year.id, classId: klass.id, sectionId: section.id, studentId: student.id };
  }

  beforeEach(async () => {
    // FK-safe cleanup order — children before parents.
    await dataSource.query('DELETE FROM attendance_device_events');
    await dataSource.query('DELETE FROM attendance_records');
    await dataSource.query('DELETE FROM attendance_sessions');
    await dataSource.query('DELETE FROM attendance_devices');
    await dataSource.query('DELETE FROM calendar_events');
    await dataSource.query('DELETE FROM students');
    await dataSource.query('DELETE FROM class_sections');
    await dataSource.query('DELETE FROM classes');
    await dataSource.query('DELETE FROM academic_years');

    const mine = await seedSection(TENANT_ID);
    academicYearId = mine.yearId;
    classId = mine.classId;
    sectionId = mine.sectionId;
    studentId = mine.studentId;

    const other = await seedSection(OTHER_TENANT);
    otherAcademicYearId = other.yearId;
    otherClassId = other.classId;
    otherSectionId = other.sectionId;
    otherStudentId = other.studentId;
  });

  describe('CalendarEvent', () => {
    let repo: Repository<CalendarEvent>;
    beforeEach(() => {
      repo = dataSource.getRepository(CalendarEvent);
    });

    it('inserts and reads a holiday', async () => {
      const holiday = await repo.save({
        tenant_id: TENANT_ID,
        academic_year_id: academicYearId,
        start_date: '2026-12-16',
        end_date: '2026-12-16',
        name: 'Victory Day',
      });

      const found = await repo.findOne({ where: { id: holiday.id } });
      expect(found?.name).toBe('Victory Day');
      expect(found?.counts_as_working_day).toBe(false);
    });

    it('does not let tenant A read tenant B holiday through a tenant-scoped query', async () => {
      const holiday = await repo.save({
        tenant_id: OTHER_TENANT,
        academic_year_id: otherAcademicYearId,
        start_date: '2026-12-16',
        end_date: '2026-12-16',
        name: 'Victory Day',
      });

      const found = await repo.findOne({ where: { id: holiday.id, tenant_id: TENANT_ID } });
      expect(found).toBeNull();
    });

    it('soft-deletes a holiday and excludes it from a standard findOne', async () => {
      const holiday = await repo.save({
        tenant_id: TENANT_ID,
        academic_year_id: academicYearId,
        start_date: '2026-12-16',
        end_date: '2026-12-16',
        name: 'Victory Day',
      });

      await repo.softDelete(holiday.id);

      const withDeleted = await repo.findOne({
        where: { id: holiday.id },
        withDeleted: true,
      });
      expect(withDeleted?.deleted_at).not.toBeNull();

      const found = await repo.findOne({ where: { id: holiday.id } });
      expect(found).toBeNull();
    });
  });

  describe('AttendanceDevice', () => {
    let repo: Repository<AttendanceDevice>;
    beforeEach(() => {
      repo = dataSource.getRepository(AttendanceDevice);
    });

    it('inserts and reads a device', async () => {
      const device = await repo.save({
        tenant_id: TENANT_ID,
        name: 'Main gate scanner',
        kind: AttendanceDeviceKind.RFID,
        token_hash: 'a'.repeat(64),
        token_last4: '1234',
      });

      const found = await repo.findOne({ where: { id: device.id } });
      expect(found?.name).toBe('Main gate scanner');
    });

    it('does not let tenant A read tenant B device through a tenant-scoped query', async () => {
      const device = await repo.save({
        tenant_id: OTHER_TENANT,
        name: 'Other gate scanner',
        kind: AttendanceDeviceKind.RFID,
        token_hash: 'b'.repeat(64),
        token_last4: '5678',
      });

      const found = await repo.findOne({ where: { id: device.id, tenant_id: TENANT_ID } });
      expect(found).toBeNull();
    });
  });

  describe('AttendanceSession', () => {
    let repo: Repository<AttendanceSession>;
    beforeEach(() => {
      repo = dataSource.getRepository(AttendanceSession);
    });

    it('inserts and reads a session', async () => {
      const session = await repo.save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        date: '2026-09-04',
      });

      const found = await repo.findOne({ where: { id: session.id } });
      expect(found?.date).toBe('2026-09-04');
      expect(found?.period_no).toBeNull();
    });

    it('does not let tenant A read tenant B session through a tenant-scoped query', async () => {
      const session = await repo.save({
        tenant_id: OTHER_TENANT,
        section_id: otherSectionId,
        date: '2026-09-04',
      });

      const found = await repo.findOne({ where: { id: session.id, tenant_id: TENANT_ID } });
      expect(found).toBeNull();
    });

    it('rejects two whole-day sessions for the same section and date', async () => {
      await repo.save({ tenant_id: TENANT_ID, section_id: sectionId, date: '2026-09-04' });

      await expect(
        repo.save({ tenant_id: TENANT_ID, section_id: sectionId, date: '2026-09-04' }),
      ).rejects.toThrow(QueryFailedError);
    });

    it('rejects two sessions with the same section, date and period_no', async () => {
      await repo.save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        date: '2026-09-04',
        period_no: 1,
      });

      await expect(
        repo.save({
          tenant_id: TENANT_ID,
          section_id: sectionId,
          date: '2026-09-04',
          period_no: 1,
        }),
      ).rejects.toThrow(QueryFailedError);
    });

    it('allows two sessions for the same section and date with different period_no', async () => {
      await repo.save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        date: '2026-09-04',
        period_no: 1,
      });

      await expect(
        repo.save({
          tenant_id: TENANT_ID,
          section_id: sectionId,
          date: '2026-09-04',
          period_no: 2,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('AttendanceRecord', () => {
    let sessionRepo: Repository<AttendanceSession>;
    let repo: Repository<AttendanceRecord>;
    let sessionId: string;

    beforeEach(async () => {
      sessionRepo = dataSource.getRepository(AttendanceSession);
      repo = dataSource.getRepository(AttendanceRecord);

      const session = await sessionRepo.save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        date: '2026-09-04',
      });
      sessionId = session.id;
    });

    it('inserts and reads a record', async () => {
      const record = await repo.save({
        tenant_id: TENANT_ID,
        session_id: sessionId,
        student_id: studentId,
        date: '2026-09-04',
        status: AttendanceStatus.PRESENT,
      });

      const found = await repo.findOne({ where: { id: record.id } });
      expect(found?.status).toBe(AttendanceStatus.PRESENT);
    });

    it('does not let tenant A read tenant B record through a tenant-scoped query', async () => {
      const otherSession = await sessionRepo.save({
        tenant_id: OTHER_TENANT,
        section_id: otherSectionId,
        date: '2026-09-04',
      });
      const record = await repo.save({
        tenant_id: OTHER_TENANT,
        session_id: otherSession.id,
        student_id: otherStudentId,
        date: '2026-09-04',
        status: AttendanceStatus.PRESENT,
      });

      const found = await repo.findOne({ where: { id: record.id, tenant_id: TENANT_ID } });
      expect(found).toBeNull();
    });

    it('rejects two records for the same session and student', async () => {
      await repo.save({
        tenant_id: TENANT_ID,
        session_id: sessionId,
        student_id: studentId,
        date: '2026-09-04',
        status: AttendanceStatus.PRESENT,
      });

      await expect(
        repo.save({
          tenant_id: TENANT_ID,
          session_id: sessionId,
          student_id: studentId,
          date: '2026-09-04',
          status: AttendanceStatus.ABSENT,
        }),
      ).rejects.toThrow(QueryFailedError);
    });
  });

  describe('AttendanceDeviceEvent', () => {
    let deviceRepo: Repository<AttendanceDevice>;
    let repo: Repository<AttendanceDeviceEvent>;
    let deviceId: string;

    beforeEach(async () => {
      deviceRepo = dataSource.getRepository(AttendanceDevice);
      repo = dataSource.getRepository(AttendanceDeviceEvent);

      const device = await deviceRepo.save({
        tenant_id: TENANT_ID,
        name: 'Main gate scanner',
        kind: AttendanceDeviceKind.RFID,
        token_hash: 'c'.repeat(64),
        token_last4: '9999',
      });
      deviceId = device.id;
    });

    it('inserts and reads an event', async () => {
      const event = await repo.save({
        tenant_id: TENANT_ID,
        device_id: deviceId,
        device_event_id: 'scan-1',
        occurred_at: new Date('2026-09-04T08:00:00Z'),
        direction: AttendanceEventDirection.IN,
        outcome: 'accepted',
      });

      const found = await repo.findOne({ where: { id: event.id } });
      expect(found?.outcome).toBe('accepted');
    });

    it('rejects two events for the same device and device_event_id', async () => {
      await repo.save({
        tenant_id: TENANT_ID,
        device_id: deviceId,
        device_event_id: 'scan-1',
        occurred_at: new Date('2026-09-04T08:00:00Z'),
        direction: AttendanceEventDirection.IN,
        outcome: 'accepted',
      });

      await expect(
        repo.save({
          tenant_id: TENANT_ID,
          device_id: deviceId,
          device_event_id: 'scan-1',
          occurred_at: new Date('2026-09-04T08:05:00Z'),
          direction: AttendanceEventDirection.IN,
          outcome: 'duplicate',
        }),
      ).rejects.toThrow(QueryFailedError);
    });

    it('does not let tenant A read tenant B event through a tenant-scoped query', async () => {
      const otherDevice = await deviceRepo.save({
        tenant_id: OTHER_TENANT,
        name: 'Other gate scanner',
        kind: AttendanceDeviceKind.RFID,
        token_hash: 'd'.repeat(64),
        token_last4: '4321',
      });

      const event = await repo.save({
        tenant_id: OTHER_TENANT,
        device_id: otherDevice.id,
        device_event_id: 'scan-1',
        occurred_at: new Date('2026-09-04T08:00:00Z'),
        direction: AttendanceEventDirection.IN,
        outcome: 'accepted',
      });

      const found = await repo.findOne({ where: { id: event.id, tenant_id: TENANT_ID } });
      expect(found).toBeNull();
    });
  });

  describe('Student card_no (D9, D37)', () => {
    const repo = () => dataSource.getRepository(Student);
    const newStudent = (tenantId: string, secId: string, n: number, card: string | null) =>
      repo().save({
        full_name: `Card ${n}`,
        registration_number: `CARD-${tenantId.slice(-4)}-${n}`,
        roll_number: 10 + n,
        class_section_id: secId,
        tenant_id: tenantId,
        enrollment_status: EnrollmentStatus.ACTIVE,
        card_no: card,
      });

    it('rejects the same card on two live students of one school', async () => {
      await newStudent(TENANT_ID, sectionId, 1, 'C-1');
      await expect(newStudent(TENANT_ID, sectionId, 2, 'C-1')).rejects.toBeInstanceOf(
        QueryFailedError,
      );
    });

    it('allows the same card in another school', async () => {
      await newStudent(TENANT_ID, sectionId, 1, 'C-1');
      await expect(newStudent(OTHER_TENANT, otherSectionId, 1, 'C-1')).resolves.toBeDefined();
    });

    it('allows many students with no card', async () => {
      await newStudent(TENANT_ID, sectionId, 1, null);
      await expect(newStudent(TENANT_ID, sectionId, 2, null)).resolves.toBeDefined();
    });

    it('lets a card be reused once its student is soft-deleted', async () => {
      const first = await newStudent(TENANT_ID, sectionId, 1, 'C-1');
      await repo().update({ id: first.id }, { deleted_at: new Date() });
      await expect(newStudent(TENANT_ID, sectionId, 2, 'C-1')).resolves.toBeDefined();
    });
  });
});
