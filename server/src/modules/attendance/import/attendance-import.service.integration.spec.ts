import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import {
  AttendanceSessionState,
  AttendanceSource,
  AttendanceStatus,
  TeacherAssignmentType,
  UserRole,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { enrollStudent } from '@test/helpers/enrollment.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import { AuthModule } from '../../auth/auth.module';
import { BulkImportModule } from '../../bulk-import/bulk-import.module';
import { AttendanceModule } from '../attendance.module';
import { AttendanceService } from '../attendance.service';
import { AttendanceImportModule } from './attendance-import.module';
import { AttendanceImportService, ImportCaller } from './attendance-import.service';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Student } from '../../students/entities/student.entity';
import { Teacher } from '../../academics/entities/teacher.entity';
import { User } from '../../users/entities/user.entity';
import { AttendanceSession } from '../entities/attendance-session.entity';
import { AttendanceRecord } from '../entities/attendance-record.entity';
import { AttendanceImport } from '../entities/attendance-import.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';

const HEADER = ['তারিখ', 'শ্রেণি', 'শাখা', 'রোল', 'নাম', 'হাজিরা'];

function addDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const TODAY = () => addDays(0);
const YESTERDAY = () => addDays(-1);

/** A multer-shaped upload built from plain rows. */
async function upload(rows: (string | number | null)[][]): Promise<Express.Multer.File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('হাজিরা');
  ws.addRow(HEADER);
  rows.forEach((r) => ws.addRow(r));
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, originalname: 'sheet.xlsx' } as Express.Multer.File;
}

describe('AttendanceImportService (integration)', () => {
  let service: AttendanceImportService;
  let attendanceService: AttendanceService;
  let dataSource: DataSource;
  const TENANT = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';
  const admin: ImportCaller = {
    tenantId: TENANT,
    userId: SEED_ADMIN_USER_ID,
    role: UserRole.ADMIN,
  };

  let className: string;
  let classId: string;
  const sections: { id: string; name: string; students: Student[] }[] = [];

  async function setSettings(attendance: Record<string, unknown>) {
    await dataSource.getRepository(School).update(
      { id: TENANT },
      {
        settings: {
          version: 1,
          attendance: {
            weeklyOffDays: [],
            correctionWindowDays: 2,
            allowFutureDates: false,
            ...attendance,
          },
        } as never,
      },
    );
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        BulkImportModule,
        AttendanceModule,
        AttendanceImportModule,
        AuthModule,
      ],
    );
    service = module.get(AttendanceImportService);
    attendanceService = module.get(AttendanceService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    if (!(await dataSource.getRepository(School).findOne({ where: { id: OTHER_TENANT } }))) {
      await dataSource
        .getRepository(School)
        .save({ id: OTHER_TENANT, name: 'Import Other School', slug: 'import-other-school' });
    }
    await dataSource
      .getRepository(AcademicYear)
      .update({ tenant_id: TENANT }, { is_current: false });
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `Import Year ${randomUUID().slice(0, 6)}`,
      start_date: addDays(-200),
      end_date: addDays(150),
      is_current: true,
      tenant_id: TENANT,
    });
    className = 'ImpClass';
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: className, academic_year_id: year.id, tenant_id: TENANT });
    classId = klass.id;
    for (const name of ['S1', 'S2', 'S3']) {
      const s = await dataSource
        .getRepository(ClassSection)
        .save({ section_name: name, class_id: klass.id, tenant_id: TENANT });
      sections.push({ id: s.id, name, students: [] });
    }
  }, 60000);

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await setSettings({});
    // Not in the per-test truncate list: clear this file's history rows ourselves.
    await dataSource.query(`DELETE FROM attendance_imports WHERE tenant_id = $1`, [TENANT]);
    // Transactional tables are truncated before every test: re-create the rosters.
    for (const sec of sections) {
      sec.students = [];
      for (const roll of [1, 2]) {
        const st = await dataSource.getRepository(Student).save({
          full_name: `Student ${sec.name}-${roll}`,
          registration_number: `IMP-${sec.name}-${roll}-${randomUUID().slice(0, 6)}`,
          roll_number: roll,
          class_section_id: sec.id,
          tenant_id: TENANT,
        });
        await enrollStudent(dataSource, st);
        sec.students.push(st);
      }
    }
  });

  const row = (
    sec: number,
    date: string,
    roll: number | string,
    status: string | null,
    name = '',
  ) => [date, className, sections[sec].name, roll, name, status];

  async function validateOk(rows: (string | number | null)[][], caller = admin) {
    const res = await service.validate(await upload(rows), caller);
    expect(res.staging_id).toBeTruthy();
    return res;
  }

  describe('validate', () => {
    it('reads a 3-section x 2-date sheet into 6 groups, every row NEW, then commit saves it as IMPORT', async () => {
      const rows = [0, 1, 2].flatMap((s) =>
        [TODAY(), YESTERDAY()].flatMap((d) => [row(s, d, 1, 'P'), row(s, d, 2, 'অ')]),
      );
      const res = await validateOk(rows);
      expect(res.counts).toEqual({ new: 12, changed: 0, unchanged: 0, error: 0 });

      const { import_id } = await service.commit(res.staging_id!, undefined, admin);

      const sessions = await dataSource.getRepository(AttendanceSession).find();
      expect(sessions).toHaveLength(6);
      // An upload never finalizes (D33) and the session is marked as an import.
      expect(sessions.every((s) => s.state === AttendanceSessionState.DRAFT)).toBe(true);
      expect(sessions.every((s) => s.source === AttendanceSource.IMPORT)).toBe(true);
      const records = await dataSource.getRepository(AttendanceRecord).find();
      expect(records).toHaveLength(12);
      expect(records.every((r) => r.source === AttendanceSource.IMPORT)).toBe(true);
      // Roll 2 was written 'অ' = ABSENT.
      const roll2 = sections[0].students[1].id;
      expect(records.find((r) => r.student_id === roll2 && r.date === TODAY())?.status).toBe(
        AttendanceStatus.ABSENT,
      );

      // Every record audit row carries the import id.
      const audits = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_type: 'AttendanceRecord' } });
      expect(audits).toHaveLength(12);
      expect(audits.every((a) => a.new_values?.import_id === import_id)).toBe(true);

      const saved = await dataSource
        .getRepository(AttendanceImport)
        .findOneByOrFail({ id: import_id });
      expect(saved).toMatchObject({
        count_new: 12,
        count_error: 0,
        uploaded_by_user_id: SEED_ADMIN_USER_ID,
      });
      expect(saved.rows).toHaveLength(12);
      expect(saved.rows.every((r) => r.recordId)).toBe(true);
    });

    it('tells NEW, CHANGED (with before/after) and UNCHANGED apart; blank leaves a mark alone', async () => {
      await service.commit(
        (await validateOk([row(0, TODAY(), 1, 'P'), row(0, TODAY(), 2, 'A')])).staging_id!,
        undefined,
        admin,
      );

      const res = await service.validate(
        await upload([
          row(0, TODAY(), 1, 'P'), // same -> UNCHANGED
          row(0, TODAY(), 2, 'L'), // A -> L
          row(1, TODAY(), 1, 'P'), // never marked -> NEW
          row(1, TODAY(), 2, null), // blank -> UNCHANGED, nothing written
        ]),
        admin,
      );
      expect(res.counts).toEqual({ new: 1, changed: 1, unchanged: 2, error: 0 });
      expect(res.overwrite_count).toBe(1);
      expect(res.rows[1]).toMatchObject({
        outcome: 'CHANGED',
        before: AttendanceStatus.ABSENT,
        after: AttendanceStatus.LATE,
      });
      expect(res.rows[3].outcome).toBe('UNCHANGED');
    });

    it('stages nothing when no row can be saved', async () => {
      const res = await service.validate(await upload([row(0, TODAY(), 9, 'P')]), admin);
      expect(res.staging_id).toBeNull();
      expect(res.rows[0]).toMatchObject({ outcome: 'ERROR', code: 'ROLL_NOT_IN_SECTION' });
    });

    it('produces each row code, and no row echoes the submitted text', async () => {
      // Friday-style weekly off on one weekday, picked from "yesterday".
      await setSettings({ weeklyOffDays: [new Date(YESTERDAY()).getUTCDay()] });
      const secret = 'ZZ-SECRET';
      const rows = [
        row(0, TODAY(), 1, 'P', 'Wrong Name'), // NAME_MISMATCH warning, still saved
        row(0, TODAY(), 2, 'Q'), // BAD_STATUS
        row(0, TODAY(), 1, 'A'), // DUPLICATE_ROW
        [TODAY(), className, secret, 1, '', 'P'], // SECTION_NOT_FOUND
        row(1, TODAY(), 77, 'P'), // ROLL_NOT_IN_SECTION
        row(1, addDays(-400), 1, 'P'), // DATE_OUTSIDE_YEAR
        row(1, YESTERDAY(), 1, 'P'), // NON_WORKING_DAY
        row(1, addDays(3), 1, 'P'), // FUTURE_DATE
      ];
      const res = await service.validate(await upload(rows), admin);
      expect(res.rows.map((r) => r.code)).toEqual([
        'NAME_MISMATCH',
        'BAD_STATUS',
        'DUPLICATE_ROW',
        'SECTION_NOT_FOUND',
        'ROLL_NOT_IN_SECTION',
        'DATE_OUTSIDE_YEAR',
        'NON_WORKING_DAY',
        'FUTURE_DATE',
      ]);
      // The warning row is still NEW; the others are errors.
      expect(res.counts).toMatchObject({ new: 1, error: 7 });
      expect(JSON.stringify(res)).not.toContain(secret);
      expect(JSON.stringify(res)).not.toContain('Wrong Name');
    });

    it('NEEDS_CORRECT_PERMISSION: a caller without ATTENDANCE_CORRECT cannot write outside the window', async () => {
      const { teacher } = await makeTeacher(sections[0].id, TeacherAssignmentType.CLASS_TEACHER);
      const res = await service.validate(await upload([row(0, addDays(-10), 1, 'P')]), teacher);
      expect(res.rows[0]).toMatchObject({ outcome: 'ERROR', code: 'NEEDS_CORRECT_PERMISSION' });
      // An admin may (the window needs ATTENDANCE_CORRECT, which ADMIN holds).
      const ok = await service.validate(await upload([row(0, addDays(-10), 1, 'P')]), admin);
      expect(ok.rows[0].outcome).toBe('NEW');
    });

    it('NOT_ALLOWED_SECTION: a subject teacher under CLASS_TEACHER cannot write the day register', async () => {
      await setSettings({ dailySource: 'CLASS_TEACHER' });
      const { teacher } = await makeTeacher(sections[0].id, TeacherAssignmentType.SUBJECT_TEACHER);
      const res = await service.validate(await upload([row(0, TODAY(), 1, 'P')]), teacher);
      expect(res.rows[0]).toMatchObject({ outcome: 'ERROR', code: 'NOT_ALLOWED_SECTION' });
      expect(res.staging_id).toBeNull();
    });
  });

  describe('commit', () => {
    it('a second commit with the same staging id does nothing', async () => {
      const res = await validateOk([row(0, TODAY(), 1, 'P')]);
      await service.commit(res.staging_id!, undefined, admin);
      await expect(service.commit(res.staging_id!, undefined, admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(await dataSource.getRepository(AttendanceImport).count()).toBe(1);
    });

    it('a staging id from tenant A is unknown to tenant B', async () => {
      const res = await validateOk([row(0, TODAY(), 1, 'P')]);
      await expect(
        service.commit(res.staging_id!, undefined, { ...admin, tenantId: OTHER_TENANT }),
      ).rejects.toBeInstanceOf(NotFoundException);
      // ...and A can still use it.
      await service.commit(res.staging_id!, undefined, admin);
    });

    it('stores supersedes_import_id', async () => {
      const first = await service.commit(
        (await validateOk([row(0, TODAY(), 1, 'P')])).staging_id!,
        undefined,
        admin,
      );
      const second = await service.commit(
        (await validateOk([row(0, TODAY(), 1, 'A')])).staging_id!,
        first.import_id,
        admin,
      );
      const saved = await dataSource
        .getRepository(AttendanceImport)
        .findOneByOrFail({ id: second.import_id });
      expect(saved.supersedes_import_id).toBe(first.import_id);
      expect(saved.count_changed).toBe(1);
    });

    it('refuses with a fixed 409 and writes nothing when a teacher saved the register after validate', async () => {
      const res = await validateOk([row(0, TODAY(), 1, 'P'), row(1, TODAY(), 1, 'P')]);
      // A teacher marks student 1 of section 0 ABSENT between validate and commit.
      await attendanceService.putRegister({
        sectionId: sections[0].id,
        tenantId: TENANT,
        role: UserRole.ADMIN,
        userId: SEED_ADMIN_USER_ID,
        ip: null,
        userAgent: null,
        dto: {
          date: TODAY(),
          period_no: null,
          base_version: 0,
          client_request_id: randomUUID(),
          entries: [{ student_id: sections[0].students[0].id, status: AttendanceStatus.ABSENT }],
        } as never,
      });
      const err = await service.commit(res.staging_id!, undefined, admin).catch((e) => e);
      expect(err.getStatus()).toBe(409);
      expect(JSON.stringify(err.getResponse())).not.toContain(sections[0].students[0].id);
      // Nothing from the sheet: only the teacher's one record, no import row, no section-1 session.
      expect(await dataSource.getRepository(AttendanceRecord).count()).toBe(1);
      expect(await dataSource.getRepository(AttendanceImport).count()).toBe(0);
      expect(await dataSource.getRepository(AttendanceSession).count()).toBe(1);
    });

    it('a teacher correcting an imported mark makes it TEACHER-sourced', async () => {
      const res = await validateOk([row(0, TODAY(), 1, 'P')]);
      await service.commit(res.staging_id!, undefined, admin);
      const rec = await dataSource.getRepository(AttendanceRecord).findOneByOrFail({
        student_id: sections[0].students[0].id,
      });
      expect(rec.source).toBe(AttendanceSource.IMPORT);
      await attendanceService.putRegister({
        sectionId: sections[0].id,
        tenantId: TENANT,
        role: UserRole.ADMIN,
        userId: SEED_ADMIN_USER_ID,
        ip: null,
        userAgent: null,
        dto: {
          date: TODAY(),
          period_no: null,
          base_version: 1,
          client_request_id: randomUUID(),
          entries: [{ student_id: rec.student_id, status: AttendanceStatus.ABSENT }],
        } as never,
      });
      const after = await dataSource
        .getRepository(AttendanceRecord)
        .findOneByOrFail({ id: rec.id });
      expect(after).toMatchObject({
        status: AttendanceStatus.ABSENT,
        source: AttendanceSource.TEACHER,
      });
    });

    it('a foreign or unknown supersedes id is a 404 and does not burn the staged sheet', async () => {
      const res = await validateOk([row(0, TODAY(), 1, 'P')]);
      await expect(service.commit(res.staging_id!, randomUUID(), admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // The stage is still usable.
      await service.commit(res.staging_id!, undefined, admin);
    });

    it('rolls the whole sheet back with one fixed 409 when a group cannot be written', async () => {
      const res = await validateOk([row(0, TODAY(), 1, 'P'), row(1, TODAY(), 1, 'P')]);
      // Between validate and commit the second section's day becomes a non-working day.
      await setSettings({ weeklyOffDays: [new Date(TODAY()).getUTCDay()] });
      await expect(service.commit(res.staging_id!, undefined, admin)).rejects.toMatchObject({
        status: 409,
      });
      expect(await dataSource.getRepository(AttendanceRecord).count()).toBe(0);
      expect(await dataSource.getRepository(AttendanceImport).count()).toBe(0);
    });
  });

  describe('history', () => {
    it('a teacher sees only their own uploads; an admin sees all; detail joins the current mark', async () => {
      const { teacher } = await makeTeacher(sections[0].id, TeacherAssignmentType.CLASS_TEACHER);
      const mine = await service.commit(
        (await validateOk([row(0, TODAY(), 1, 'P')], teacher)).staging_id!,
        undefined,
        teacher,
      );
      await service.commit(
        (await validateOk([row(1, TODAY(), 1, 'P')])).staging_id!,
        undefined,
        admin,
      );

      expect((await service.list(1, 20, teacher)).items.map((i) => i.id)).toEqual([mine.import_id]);
      expect((await service.list(1, 20, admin)).total).toBe(2);
      await expect(service.detail(mine.import_id, admin)).resolves.toBeDefined();

      // The detail of someone else's upload is a 404 for a teacher.
      const all = await service.list(1, 20, admin);
      const other = all.items.find((i) => i.id !== mine.import_id)!;
      await expect(service.detail(other.id, teacher)).rejects.toBeInstanceOf(NotFoundException);

      // "Changed later": the register mark is edited after the import.
      await dataSource.query(
        `UPDATE attendance_records SET status = 'ABSENT' WHERE student_id = $1`,
        [sections[0].students[0].id],
      );
      const detail = await service.detail(mine.import_id, teacher);
      expect(detail.rows[0]).toMatchObject({ after: 'PRESENT', current: 'ABSENT' });
    });

    it('detail of another tenant import is a 404', async () => {
      const mine = await service.commit(
        (await validateOk([row(0, TODAY(), 1, 'P')])).staging_id!,
        undefined,
        admin,
      );
      await expect(
        service.detail(mine.import_id, { ...admin, tenantId: OTHER_TENANT }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('template', () => {
    it('builds a sheet for two sections that validates back as all NEW once filled', async () => {
      const { buffer, fileName } = await service.template(
        [sections[0].id, sections[1].id],
        TODAY(),
        admin,
      );
      expect(fileName).toContain(TODAY());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as never);
      const ws = wb.worksheets[0];
      expect(ws.rowCount).toBe(5); // header + 2 students x 2 sections
      for (let r = 2; r <= ws.rowCount; r++) ws.getRow(r).getCell(6).value = 'উ';
      const filled = Buffer.from(await wb.xlsx.writeBuffer());
      const res = await service.validate(
        { buffer: filled, originalname: 'filled.xlsx' } as Express.Multer.File,
        admin,
      );
      expect(res.counts).toMatchObject({ new: 4, error: 0 });
    });

    it('lists the roster by enrollment on the date: an enrolled-elsewhere student is not on this section sheet', async () => {
      const moved = await dataSource.getRepository(Student).save({
        full_name: 'Moved Student',
        registration_number: `IMP-MOVED-${randomUUID().slice(0, 6)}`,
        roll_number: 9,
        class_section_id: sections[0].id, // placed here...
        tenant_id: TENANT,
      });
      await enrollStudent(dataSource, moved, sections[1].id); // ...but enrolled in section 1
      const names = async (sectionIndex: number) => {
        const { buffer } = await service.template([sections[sectionIndex].id], TODAY(), admin);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer as never);
        return wb.worksheets[0].getColumn(5).values.map(String);
      };
      expect(await names(0)).not.toContain('Moved Student');
      expect(await names(1)).toContain('Moved Student');
    });

    it('refuses a section outside the current academic year with the fixed 403', async () => {
      const pastYear = await dataSource.getRepository(AcademicYear).save({
        name: `Past ${randomUUID().slice(0, 6)}`,
        start_date: '2001-01-01',
        end_date: '2001-12-31',
        tenant_id: TENANT,
      });
      const pastClass = await dataSource
        .getRepository(Class)
        .save({ name: 'PastClass', academic_year_id: pastYear.id, tenant_id: TENANT });
      const pastSection = await dataSource
        .getRepository(ClassSection)
        .save({ section_name: 'P1', class_id: pastClass.id, tenant_id: TENANT });
      await expect(service.template([pastSection.id], TODAY(), admin)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a foreign or unwritable section with one fixed 403', async () => {
      await expect(service.template([randomUUID()], TODAY(), admin)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await setSettings({ dailySource: 'CLASS_TEACHER' });
      const { teacher } = await makeTeacher(sections[0].id, TeacherAssignmentType.SUBJECT_TEACHER);
      await expect(service.template([sections[0].id], TODAY(), teacher)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  /** A TEACHER with one assignment of `type` on the section. */
  async function makeTeacher(sectionId: string, type: TeacherAssignmentType) {
    const user = await dataSource.getRepository(User).save({
      email: `imp-teacher-${randomUUID()}@test.com`,
      full_name: 'Import Teacher',
    });
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `IMP-${randomUUID().slice(0, 8)}`,
      tenant_id: TENANT,
      designations: [],
    });
    const [subject] = await dataSource.query(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, $2, $3) RETURNING id`,
      [TENANT, 'Imp Subject', `IM${randomUUID().slice(0, 6)}`],
    );
    await dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        teacher.id,
        sectionId,
        TENANT,
        type === TeacherAssignmentType.SUBJECT_TEACHER ? subject.id : null,
        type,
      ],
    );
    const caller: ImportCaller = { tenantId: TENANT, userId: user.id, role: UserRole.TEACHER };
    return { teacher: caller };
  }
});
