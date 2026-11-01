import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { DataSource, IsNull } from 'typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import {
  AttendanceSessionState,
  AttendanceStatus,
  AudienceTab,
  AudienceTarget,
  UserRole,
} from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { AuthModule } from '../auth/auth.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
import { AttendanceSession } from '../attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../attendance/entities/attendance-record.entity';
import { addDays } from '../attendance/attendance-policy.util';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { SchoolsModule } from '../schools/schools.module';
import { SchoolsService } from '../schools/schools.service';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AudienceService } from './audience.service';
import { AudienceQueryDto } from './dto/audience-query.dto';

/**
 * The four advanced audience tabs (EXAM_FAILED, FEE_DUE, LOW_ATTENDANCE, ORG_GROUP).
 * Two fresh schools, A and B, so the whole-tenant tabs are exact. Students, bills, exams and
 * attendance are rebuilt before each test because the suite wipes those tables between tests.
 */
describe('Audience advanced filters (integration)', () => {
  let ds: DataSource;
  let service: AudienceService;
  let attendance: AttendanceSummaryService;
  let calendar: SchoolCalendarService;
  const stamp = Date.now();
  const admin = { role: UserRole.ADMIN, userId: '00000000-0000-4000-8000-000000000001' };

  let A: string;
  let B: string;
  let today: string;
  let yearA: string;
  let yearB: string;
  let c1: string; // shift 'Morning', version 'Bangla'
  let c2: string; // shift NULL, shift_id -> shifts row 'Day'
  let cB: string;
  let c1s1: string; // group 'Science'
  let c1s2: string;
  let c2s1: string;
  let sB1: string;
  let teacherUser: string;
  let shiftId: string;
  let shiftIdB: string;

  // per-test fixtures
  let s1: string;
  let s2: string;
  let s3: string;
  let s4: string;
  let s5: string;
  let sTransferred: string;
  let sB: string;
  let gA: string;
  let gB: string;
  let scaleA: string;
  let scaleB: string;

  const q = (over: Partial<AudienceQueryDto>): AudienceQueryDto =>
    ({ page: 1, limit: 100, ...over }) as AudienceQueryDto;
  const ids = (r: { items: { studentId: string | null }[] }) => r.items.map((i) => i.studentId);
  const students = (tab: AudienceTab, over: Partial<AudienceQueryDto> = {}, actor = admin) =>
    service.list(A, actor, q({ target: AudienceTarget.STUDENTS, tab, ...over }));
  const teacher = () => ({ role: UserRole.TEACHER, userId: teacherUser });

  const one = async (sql: string, params: unknown[]) =>
    (await ds.query(sql, params))[0].id as string;
  const mkStudent = (name: string, section: string, tenant: string, status: string, n: number) =>
    one(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, `ADV-${stamp}-${name}`, n, section, tenant, status],
    );
  const mkGuardian = async (name: string, tenant: string, ...kids: string[]) => {
    const g = await one(
      `INSERT INTO guardians (full_name, relationship, phone, tenant_id)
       VALUES ($1, 'Father', '01700000000', $2) RETURNING id`,
      [name, tenant],
    );
    for (const k of kids)
      await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
        k,
        g,
      ]);
    return g;
  };
  const mkExam = (tenant: string, year: string, cls: string, status: string) =>
    one(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Adv Exam ' || substr(gen_random_uuid()::text, 1, 8), 'TERM', $3, $4, NOW(), NOW()) RETURNING id`,
      [year, cls, status, tenant],
    );
  const mkResult = (
    tenant: string,
    exam: string,
    student: string,
    section: string,
    scale: string,
    fail: boolean,
    position: number,
    deleted = false,
  ) =>
    ds.query(
      `INSERT INTO results
         (exam_id, student_id, section_id, total_marks, gpa, grade, position, section_position, is_fail,
          grading_scale_id, grading_scale_revision, rule_version, computed_at, tenant_id, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, 50.00, 1.00, 'F', $4, 1, $5, $6, 1, 'nctb-v1', NOW(), $7, NOW(), NOW(),
               CASE WHEN $8::boolean THEN NOW() END)`,
      [exam, student, section, position, fail, scale, tenant, deleted],
    );
  const mkBill = async (
    tenant: string,
    cls: string,
    year: string,
    rows: {
      student: string;
      total: string;
      paid: string;
      oneOff?: string;
      status: string;
      due: string;
      deleted?: boolean;
    }[],
  ) => {
    const fs = await one(
      `INSERT INTO fee_structures (fee_type, name, amount, class_id, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ('MONTHLY_TUITION', 'Adv Tuition', 1000, $1, $2, $3, NOW(), NOW()) RETURNING id`,
      [cls, year, tenant],
    );
    for (const r of rows)
      await ds.query(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, total_amount,
           paid_amount, discount_amount, one_off_discount_amount, status, due_date, created_at, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7, $7, $8, $9::date, NOW(), NOW(),
                 CASE WHEN $10::boolean THEN NOW() END)`,
        [
          r.student,
          year,
          fs,
          addDays(today, -20),
          r.total,
          r.paid,
          r.oneOff ?? '0',
          r.status,
          r.due,
          r.deleted ?? false,
        ],
      );
  };
  const markDay = async (
    section: string,
    studentId: string,
    date: string,
    status: AttendanceStatus,
  ) => {
    const sessions = ds.getRepository(AttendanceSession);
    let session = await sessions.findOne({
      where: { tenant_id: A, section_id: section, date, period_no: IsNull() },
    });
    if (!session)
      session = await sessions.save({
        tenant_id: A,
        section_id: section,
        date,
        period_no: null,
        state: AttendanceSessionState.FINALIZED,
      });
    await ds.getRepository(AttendanceRecord).save({
      tenant_id: A,
      session_id: session.id,
      student_id: studentId,
      date,
      status,
    });
  };

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [AudienceService, TeacherScopeService],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, SchoolsModule, AuthModule],
    );
    ds = module.get(DataSource);
    service = module.get(AudienceService);
    attendance = module.get(AttendanceSummaryService);
    calendar = module.get(SchoolCalendarService, { strict: false });
    const mkSchool = (n: string) =>
      one(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
        `Adv ${n}`,
        `adv-${n}-${stamp}`,
      ]);
    A = await mkSchool('a');
    B = await mkSchool('b');
    today = await module.get(SchoolsService).todayFor(A);
    const mkYear = (tenant: string, from: string, to: string) =>
      one(
        `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
         VALUES ('AdvYear', $1::date, $2::date, true, $3) RETURNING id`,
        [from, to, tenant],
      );
    yearA = await mkYear(A, addDays(today, -14), addDays(today, 200));
    yearB = await mkYear(B, addDays(today, -14), addDays(today, 200));
    shiftId = await one(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, 'Day', '08:00', '14:00', 1) RETURNING id`,
      [A],
    );
    shiftIdB = await one(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, 'Day', '08:00', '14:00', 1) RETURNING id`,
      [B],
    );
    const mkClass = (
      tenant: string,
      year: string,
      shift: string | null,
      version: string | null,
      shiftRow: string | null,
    ) =>
      one(
        `INSERT INTO classes (tenant_id, name, academic_year_id, shift, version, shift_id)
         VALUES ($1, 'Adv Class', $2, $3, $4, $5) RETURNING id`,
        [tenant, year, shift, version, shiftRow],
      );
    c1 = await mkClass(A, yearA, 'Morning', 'Bangla', null);
    c2 = await mkClass(A, yearA, null, null, shiftId);
    cB = await mkClass(B, yearB, 'Morning', 'Bangla', shiftIdB);
    const mkSection = (tenant: string, cls: string, name: string, group: string | null) =>
      one(
        `INSERT INTO class_sections (tenant_id, class_id, section_name, group_name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenant, cls, name, group],
      );
    c1s1 = await mkSection(A, c1, 'S1', 'Science');
    c1s2 = await mkSection(A, c1, 'S2', null);
    c2s1 = await mkSection(A, c2, 'S1', null);
    sB1 = await mkSection(B, cB, 'S1', 'Science');
    teacherUser = await one(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Adv Teacher', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`adv-teacher-${stamp}@example.com`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'TEACHER', NOW(), NOW())`,
      [teacherUser, A],
    );
  }, 120_000);

  beforeEach(async () => {
    // via the repository so the subscriber creates the staff profile
    const t = await ds.getRepository(Teacher).save({
      user_id: teacherUser,
      employee_id: `ADV-${stamp}`,
      tenant_id: A,
      designations: [],
    });
    await ds.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
       VALUES ($1, $2, $3, 'CLASS_TEACHER')`,
      [t.id, c1s1, A],
    );
    s1 = await mkStudent('s1', c1s1, A, 'ACTIVE', 1);
    s2 = await mkStudent('s2', c1s1, A, 'ACTIVE', 2);
    s3 = await mkStudent('s3', c1s1, A, 'ACTIVE', 3);
    s4 = await mkStudent('s4', c1s2, A, 'ACTIVE', 4);
    s5 = await mkStudent('s5', c2s1, A, 'ACTIVE', 5);
    sTransferred = await mkStudent('sT', c1s1, A, 'TRANSFERRED', 6);
    sB = await mkStudent('sB', sB1, B, 'ACTIVE', 1);
    gA = await mkGuardian('Adv Guardian A', A, s1, s2); // one guardian, two children
    gB = await mkGuardian('Adv Guardian B', B, sB);
    // grading scales are wiped between tests too
    const mkScale = (tenant: string, year: string) =>
      one(
        `INSERT INTO grading_scales (name, revision, academic_year_id, tenant_id, created_at, updated_at)
         VALUES ('Adv scale', 1, $1, $2, NOW(), NOW()) RETURNING id`,
        [year, tenant],
      );
    scaleA = await mkScale(A, yearA);
    scaleB = await mkScale(B, yearB);
  }, 60_000);

  afterAll(async () => {
    const both = [A, B];
    // rows that block the year delete (NO ACTION foreign keys), children first
    await ds.query(`DELETE FROM student_fees WHERE academic_year_id IN ($1, $2)`, [yearA, yearB]);
    await ds.query(`DELETE FROM fee_structures WHERE tenant_id = ANY($1::uuid[])`, [both]);
    await ds.query(`DELETE FROM results WHERE tenant_id = ANY($1::uuid[])`, [both]);
    await ds.query(`DELETE FROM exams WHERE tenant_id = ANY($1::uuid[])`, [both]);
    await ds.query(`DELETE FROM grading_scales WHERE tenant_id = ANY($1::uuid[])`, [both]);
    await ds.query(`DELETE FROM attendance_records WHERE tenant_id = ANY($1::uuid[])`, [both]);
    await ds.query(`DELETE FROM attendance_sessions WHERE tenant_id = ANY($1::uuid[])`, [both]);
    await ds.query(`DELETE FROM student_guardians WHERE guardian_id = ANY($1::uuid[])`, [[gA, gB]]);
    await ds.query(`DELETE FROM guardians WHERE tenant_id = ANY($1::uuid[])`, [both]);
    await ds.query(`DELETE FROM students WHERE tenant_id = ANY($1::uuid[])`, [both]);
    // schools cascade to their children; the user rows and the teacher are ours alone
    await ds.query(`DELETE FROM teacher_class_sections WHERE tenant_id = ANY($1::uuid[])`, [both]);
    await ds.query(`DELETE FROM teachers WHERE employee_id = $1`, [`ADV-${stamp}`]);
    await ds.query(
      `DELETE FROM staff_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`adv-teacher-${stamp}@%`],
    );
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id = ANY($1::uuid[])`, [both]);
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`adv-teacher-${stamp}@%`]);
    await ds.query(`DELETE FROM schools WHERE id = ANY($1::uuid[])`, [both]);
  });

  it('EXAM_FAILED returns the failed, not the passed or the soft-deleted result', async () => {
    const exam = await mkExam(A, yearA, c1, 'PUBLISHED');
    await mkResult(A, exam, s1, c1s1, scaleA, true, 1);
    await mkResult(A, exam, s2, c1s1, scaleA, false, 2);
    await mkResult(A, exam, s3, c1s1, scaleA, true, 3, true); // deleted on recompute
    const r = await students(AudienceTab.EXAM_FAILED, { examId: exam });
    expect(ids(r)).toEqual([s1]);
    const g = await service.list(
      A,
      admin,
      q({ target: AudienceTarget.GUARDIANS, tab: AudienceTab.EXAM_FAILED, examId: exam }),
    );
    // the guardian of two children shows once, for the child who failed
    expect(g.items.map((i) => [i.guardianId, i.studentId])).toEqual([[gA, s1]]);
  });

  it('EXAM_FAILED answers one 404 for a foreign, unpublished or unknown exam', async () => {
    const foreign = await mkExam(B, yearB, cB, 'PUBLISHED');
    await mkResult(B, foreign, sB, sB1, scaleB, true, 1);
    const processed = await mkExam(A, yearA, c1, 'PROCESSED');
    const draft = await mkExam(A, yearA, c1, 'DRAFT');
    for (const examId of [foreign, processed, draft, randomUUID()])
      await expect(students(AudienceTab.EXAM_FAILED, { examId })).rejects.toThrow(
        NotFoundException,
      );
  });

  it('FEE_DUE counts only open, overdue bills with a balance, exact to the paisa', async () => {
    const past = addDays(today, -3);
    await mkBill(A, c1, yearA, [
      // fully paid: out
      { student: s1, total: '1000.00', paid: '1000.00', status: 'PAID', due: past },
      // 0.01 still owed: in (no tolerance)
      { student: s2, total: '1000.00', paid: '999.99', status: 'PARTIALLY_PAID', due: past },
      // due today is not yet overdue (strict <): out
      { student: s3, total: '1000.00', paid: '0', status: 'PENDING', due: today },
      // soft-deleted: out
      { student: s4, total: '1000.00', paid: '0', status: 'PENDING', due: past, deleted: true },
      // discount covers the whole bill: balance 0, out
      { student: s5, total: '1000.00', paid: '0', oneOff: '1000.00', status: 'PENDING', due: past },
    ]);
    await mkBill(B, cB, yearB, [
      { student: sB, total: '1000.00', paid: '0', status: 'PENDING', due: past },
    ]);
    const r = await students(AudienceTab.FEE_DUE);
    expect(ids(r)).toEqual([s2]);
    // the other school's overdue student never shows
    expect(ids(r)).not.toContain(sB);
  });

  const range = () => ({ from: addDays(today, -14), to: today });
  /** PRESENT/ABSENT on every working day of C1 for the two students of section S1. */
  const markGoodAndBad = async () => {
    const { from, to } = range();
    const { dates } = await calendar.getWorkingDays({ tenantId: A, from, to, classId: c1 });
    for (const d of dates) {
      await markDay(c1s1, s1, d, AttendanceStatus.PRESENT); // good
      await markDay(c1s1, s2, d, AttendanceStatus.ABSENT); // bad
    }
    return dates.length;
  };

  it('LOW_ATTENDANCE equals the attendance report list', async () => {
    const n = await markGoodAndBad();
    expect(n).toBeGreaterThan(0);
    const { from, to } = range();
    const report = await attendance.getLowAttendanceFlags({
      tenantId: A,
      from,
      to,
      classId: c1,
      thresholdPercent: 75,
      page: 1,
      limit: 100,
    });
    const r = await students(AudienceTab.LOW_ATTENDANCE, { belowPercent: 75 });
    const c1Students = [s1, s2, s3, s4];
    expect(
      ids(r)
        .filter((i) => c1Students.includes(i!))
        .sort(),
    ).toEqual(report.data.map((d) => d.student_id).sort());
    expect(ids(r)).toContain(s2); // the always-absent child
    expect(ids(r)).not.toContain(s1); // the always-present child
  });

  it('LOW_ATTENDANCE with nobody flagged, or no current year, is empty and not everyone', async () => {
    await markGoodAndBad();
    // every student PRESENT on every day: nobody is under 1%
    const { dates } = await calendar.getWorkingDays({
      tenantId: A,
      ...range(),
      classId: c1,
    });
    await ds.query(`DELETE FROM attendance_records WHERE tenant_id = $1`, [A]);
    for (const d of dates)
      for (const [section, kids] of [
        [c1s1, [s1, s2, s3]],
        [c1s2, [s4]],
        [c2s1, [s5]],
      ] as [string, string[]][])
        for (const k of kids) await markDay(section, k, d, AttendanceStatus.PRESENT);
    expect(await students(AudienceTab.LOW_ATTENDANCE, { belowPercent: 1 })).toMatchObject({
      items: [],
      total: 0,
    });
    // no current academic year: empty
    await ds.query(`UPDATE academic_years SET is_current = false WHERE id = $1`, [yearA]);
    try {
      expect(await students(AudienceTab.LOW_ATTENDANCE, { belowPercent: 100 })).toMatchObject({
        items: [],
        total: 0,
      });
    } finally {
      await ds.query(`UPDATE academic_years SET is_current = true WHERE id = $1`, [yearA]);
    }
  });

  it('ORG_GROUP matches shift, version and group, ANDed', async () => {
    const morning = await students(AudienceTab.ORG_GROUP, { shift: 'Morning' });
    expect(ids(morning).sort()).toEqual([s1, s2, s3, s4].sort());
    const science = await students(AudienceTab.ORG_GROUP, { shift: 'Morning', group: 'Science' });
    expect(ids(science).sort()).toEqual([s1, s2, s3].sort());
    const bangla = await students(AudienceTab.ORG_GROUP, { version: 'Bangla' });
    expect(ids(bangla).sort()).toEqual([s1, s2, s3, s4].sort());
    // c2 has no shift text; only its shift_id points at the 'Day' row
    const day = await students(AudienceTab.ORG_GROUP, { shift: 'Day' });
    expect(ids(day)).toEqual([s5]);
    // the other school's matching class never shows
    expect(ids(morning)).not.toContain(sB);
  });

  it('a teacher gets only their own section on every advanced tab, and 404 for another class exam', async () => {
    const exam = await mkExam(A, yearA, c1, 'PUBLISHED');
    await mkResult(A, exam, s1, c1s1, scaleA, true, 1);
    await mkResult(A, exam, s4, c1s2, scaleA, true, 2); // another section of the same class
    const examC2 = await mkExam(A, yearA, c2, 'PUBLISHED');
    const past = addDays(today, -3);
    await mkBill(A, c1, yearA, [
      { student: s1, total: '1000.00', paid: '0', status: 'PENDING', due: past },
      { student: s4, total: '1000.00', paid: '0', status: 'PENDING', due: past },
      { student: s5, total: '1000.00', paid: '0', status: 'PENDING', due: past },
    ]);
    await markGoodAndBad();
    const t = teacher();
    expect(ids(await students(AudienceTab.EXAM_FAILED, { examId: exam }, t))).toEqual([s1]);
    expect(ids(await students(AudienceTab.FEE_DUE, {}, t))).toEqual([s1]);
    const low = ids(await students(AudienceTab.LOW_ATTENDANCE, { belowPercent: 75 }, t));
    expect(low).toContain(s2);
    expect(low.every((i) => [s1, s2, s3].includes(i!))).toBe(true);
    expect(ids(await students(AudienceTab.ORG_GROUP, { shift: 'Morning' }, t)).sort()).toEqual(
      [s1, s2, s3].sort(),
    );
    // an exam of a class the teacher does not teach is the same 404
    await expect(students(AudienceTab.EXAM_FAILED, { examId: examC2 }, t)).rejects.toThrow(
      NotFoundException,
    );
  });

  // #3430 finding 6: `classes.shift` is deprecated text that a shift rename never rewrites.
  it('ORG_GROUP shift reads the shift row first; stale class text is ignored once shift_id is set', async () => {
    await ds.query(`UPDATE classes SET shift_id = $1 WHERE id = $2`, [shiftId, c1]);
    await ds.query(`UPDATE shifts SET name = 'Evening' WHERE id = $1`, [shiftId]);
    try {
      // c1 still carries the old text 'Morning', but its shift row is now 'Evening'.
      expect(ids(await students(AudienceTab.ORG_GROUP, { shift: 'Evening' })).sort()).toEqual(
        [s1, s2, s3, s4, s5].sort(),
      );
      expect(ids(await students(AudienceTab.ORG_GROUP, { shift: 'Morning' }))).toEqual([]);
      expect(ids(await students(AudienceTab.ORG_GROUP, { shift: 'Day' }))).toEqual([]);
    } finally {
      await ds.query(`UPDATE shifts SET name = 'Day' WHERE id = $1`, [shiftId]);
      await ds.query(`UPDATE classes SET shift_id = NULL WHERE id = $1`, [c1]);
    }
  });

  it('tenant A never returns a tenant B student on any advanced tab', async () => {
    const past = addDays(today, -3);
    await mkBill(B, cB, yearB, [
      { student: sB, total: '1000.00', paid: '0', status: 'PENDING', due: past },
    ]);
    const examB = await mkExam(B, yearB, cB, 'PUBLISHED');
    await mkResult(B, examB, sB, sB1, scaleB, true, 1);
    await expect(students(AudienceTab.EXAM_FAILED, { examId: examB })).rejects.toThrow(
      NotFoundException,
    );
    expect(ids(await students(AudienceTab.FEE_DUE))).not.toContain(sB);
    expect(ids(await students(AudienceTab.LOW_ATTENDANCE, { belowPercent: 100 }))).not.toContain(
      sB,
    );
    expect(ids(await students(AudienceTab.ORG_GROUP, { group: 'Science' }))).not.toContain(sB);
    // and the guardian side
    const g = await service.list(
      A,
      admin,
      q({ target: AudienceTarget.GUARDIANS, tab: AudienceTab.FEE_DUE }),
    );
    expect(g.items.map((i) => i.guardianId)).not.toContain(gB);
  });

  it('the number of queries does not grow with the number of students', async () => {
    const past = addDays(today, -3);
    await mkBill(A, c1, yearA, [
      { student: s1, total: '1000.00', paid: '0', status: 'PENDING', due: past },
    ]);
    await markGoodAndBad();
    const count = async () => {
      const spy = vi.spyOn(PostgresQueryRunner.prototype, 'query');
      try {
        await students(AudienceTab.LOW_ATTENDANCE, { belowPercent: 75 });
        await students(AudienceTab.FEE_DUE);
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    };
    await count(); // warm the settings cache so both counts measure the same path
    const before = await count();
    expect(before).toBeGreaterThan(0);
    await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
       SELECT 'Adv More ' || i, 'ADV-' || $3::text || '-more-' || i, 100 + i, $1, $2, 'ACTIVE'
         FROM generate_series(1, 10) i`,
      [c1s1, A, stamp],
    );
    expect(await count()).toBe(before);
  });
});
