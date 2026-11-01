import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import {
  HomeworkAssignmentStatus,
  HomeworkGradingMode,
  HomeworkSubmissionStatus,
  SyllabusTopicStatus,
  TeacherAssignmentType,
} from '@biddaloy/shared';
import { HomeworkService } from './homework.service';
import { HomeworkAccessService } from './homework-access.service';
import { HomeworkNoticeService } from './homework-notice.service';
import { HomeworkAnalyticsService } from './homework-analytics.service';
import { SyllabusService } from './syllabus.service';
import { PlanScheduleService } from '../study-plans/plan-schedule.service';
import { StudyPlanDashboardService } from '../study-plans/study-plan-dashboard.service';
import { SchoolsService } from '../schools/schools.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { addDays, localToday } from '../attendance/attendance-policy.util';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { User } from '../users/entities/user.entity';
import { Student } from '../students/entities/student.entity';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';

/**
 * [8.10.7.3.04] `submissionsToCheck`, [8.10.7.3.19] `getSubmissionRateByClass` and
 * `getTeacherSyllabusProgress`, against a real database.
 */
describe('homework dashboard widgets (integration)', () => {
  let homework: HomeworkService;
  let analytics: HomeworkAnalyticsService;
  let syllabus: SyllabusService;
  let dataSource: DataSource;

  const TENANT = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000097';
  const S = HomeworkSubmissionStatus;
  const A = HomeworkAssignmentStatus;
  const T = TeacherAssignmentType;
  let seq = 0;
  let class7: string;
  let class8: string;
  let sec7A: string;
  let sec7B: string;
  let sec8A: string;
  let math: string;
  let science: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      HomeworkService,
      HomeworkAnalyticsService,
      SyllabusService,
      { provide: HomeworkAccessService, useValue: {} },
      { provide: HomeworkNoticeService, useValue: {} },
      { provide: PlanScheduleService, useValue: {} },
      {
        provide: StudyPlanDashboardService,
        useValue: {
          expectedByClass: async () => new Map(),
          expectedForTeacher: async () => new Map(),
        },
      },
      {
        provide: SchoolsService,
        useValue: { getResolvedSettings: async () => ({ region: { timezone: 'UTC' } }) },
      },
      TeacherScopeService,
      AuditService,
    ]);
    homework = module.get(HomeworkService);
    analytics = module.get(HomeworkAnalyticsService);
    syllabus = module.get(SyllabusService);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    vi.useRealTimers();
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    vi.useRealTimers();
    const schoolRepo = dataSource.getRepository(School);
    for (const id of [TENANT, TENANT_B]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    // Rows left by an earlier test would add to the counts.
    for (const t of [
      'homework_submissions',
      'homework_assignments',
      'syllabus_topics',
      'homework',
      'teacher_class_sections',
    ]) {
      await dataSource.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [TENANT, TENANT_B]);
    }
    // Completion rates count the section roster, so students left by an earlier test would
    // add to every denominator too.
    await dataSource.query(
      `DELETE FROM students WHERE tenant_id IN ($1, $2) AND registration_number LIKE 'WID-%'`,
      [TENANT, TENANT_B],
    );
    const yearRepo = dataSource.getRepository(AcademicYear);
    await yearRepo.update({ tenant_id: TENANT }, { is_current: false });
    const year =
      (await yearRepo.findOne({ where: { name: 'Widgets Cur', tenant_id: TENANT } })) ??
      (await yearRepo.save({
        name: 'Widgets Cur',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        tenant_id: TENANT,
      }));
    await yearRepo.update({ id: year.id }, { is_current: true });

    const classRepo = dataSource.getRepository(Class);
    const mkClass = async (name: string, numeric_grade: number) =>
      (
        (await classRepo.findOne({
          where: { name, academic_year_id: year.id, tenant_id: TENANT },
        })) ??
        (await classRepo.save({
          name,
          academic_year_id: year.id,
          tenant_id: TENANT,
          numeric_grade,
        }))
      ).id;
    class7 = await mkClass('Wid 7', 7);
    class8 = await mkClass('Wid 8', 8);
    const secRepo = dataSource.getRepository(ClassSection);
    const mkSec = async (class_id: string, section_name: string) =>
      (
        (await secRepo.findOne({ where: { class_id, section_name, tenant_id: TENANT } })) ??
        (await secRepo.save({ class_id, section_name, tenant_id: TENANT }))
      ).id;
    sec7A = await mkSec(class7, 'A');
    sec7B = await mkSec(class7, 'B');
    sec8A = await mkSec(class8, 'A');
    const subjectRepo = dataSource.getRepository(Subject);
    const mkSubj = async (code: string, name_en: string, name_bn: string) =>
      (
        (await subjectRepo.findOne({ where: { tenant_id: TENANT, code } })) ??
        (await subjectRepo.save({ tenant_id: TENANT, code, name_en, name_bn }))
      ).id;
    math = await mkSubj('WIDMATH', 'Mathematics', 'গণিত');
    science = await mkSubj('WIDSCI', 'Science', 'বিজ্ঞান');
  });

  const mkTeacher = async () => {
    seq += 1;
    const user = await dataSource
      .getRepository(User)
      .save({ email: `wid-${Date.now()}-${seq}@test.com`, full_name: 'Wid Teacher' });
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `WID-${Date.now()}-${seq}`,
      tenant_id: TENANT,
      designations: [],
    });
    return { userId: user.id, teacherId: teacher.id };
  };

  const assignTeacher = (
    teacher_id: string,
    section_id: string,
    assignment_type: TeacherAssignmentType,
    subject_id: string | null,
  ) =>
    dataSource
      .getRepository(TeacherClassSection)
      .save({ teacher_id, section_id, assignment_type, subject_id, tenant_id: TENANT });

  const mkStudent = async (class_section_id: string) => {
    seq += 1;
    return dataSource.getRepository(Student).save({
      full_name: `Wid Student ${seq}`,
      registration_number: `WID-${Date.now()}-${seq}`,
      roll_number: 5000 + seq,
      class_section_id,
      tenant_id: TENANT,
    });
  };

  const mkHomework = (class_id: string, subject_id: string, title = 'HW') =>
    dataSource.getRepository(Homework).save({
      title,
      class_id,
      subject_id,
      grading_mode: HomeworkGradingMode.TICK,
      tenant_id: TENANT,
    });

  /** One homework plus one assignment of it. */
  const mkAssignment = async (
    class_id: string,
    subject_id: string,
    target: { section_id?: string; student_id?: string },
    opts: { title?: string; due_date?: string; status?: HomeworkAssignmentStatus } = {},
  ) => {
    const hw = await mkHomework(class_id, subject_id, opts.title);
    return dataSource.getRepository(HomeworkAssignment).save({
      homework_id: hw.id,
      section_id: null,
      student_id: null,
      assigned_date: '2026-01-01',
      due_date: opts.due_date ?? '2026-10-06',
      status: opts.status ?? A.ACTIVE,
      tenant_id: TENANT,
      ...target,
    });
  };

  /** `n` fresh students in `sectionId`, each with one submission of `status`. */
  const submissions = async (
    assignment_id: string,
    sectionId: string,
    status: HomeworkSubmissionStatus,
    n: number,
  ) => {
    for (let i = 0; i < n; i += 1) {
      const st = await mkStudent(sectionId);
      await dataSource
        .getRepository(HomeworkSubmission)
        .save({ assignment_id, student_id: st.id, status, tenant_id: TENANT });
    }
  };

  describe('submissionsToCheck [8.10.7.3.04]', () => {
    const empty = { total_submitted: 0, assignment_count: 0, items: [] };
    const ask = (userId: string, tenantId = TENANT) =>
      homework.submissionsToCheck({ role: 'TEACHER', userId, tenantId });

    it('Math teacher of 7-B: 11 + 7 SUBMITTED counted, DONE / NOT_SUBMITTED ignored, biggest first', async () => {
      const t = await mkTeacher();
      await assignTeacher(t.teacherId, sec7B, T.SUBJECT_TEACHER, math);
      const small = await mkAssignment(class7, math, { section_id: sec7B }, { title: 'Small' });
      const big = await mkAssignment(class7, math, { section_id: sec7B }, { title: 'Big' });
      await submissions(big.id, sec7B, S.SUBMITTED, 11);
      await submissions(small.id, sec7B, S.SUBMITTED, 7);
      await submissions(small.id, sec7B, S.DONE, 3);
      await submissions(small.id, sec7B, S.NOT_SUBMITTED, 2);

      const res = await ask(t.userId);
      expect(res.total_submitted).toBe(18);
      expect(res.assignment_count).toBe(2);
      expect(res.items.map((i) => [i.title, i.submitted_count])).toEqual([
        ['Big', 11],
        ['Small', 7],
      ]);
      expect(res.items[0]).toMatchObject({
        class_name: 'Wid 7',
        section_name: 'B',
        subject_name_en: 'Mathematics',
        subject_name_bn: 'গণিত',
        due_date: '2026-10-06',
      });
    });

    it('a Science assignment is hidden from the Math teacher but shown to the class teacher', async () => {
      const mathT = await mkTeacher();
      await assignTeacher(mathT.teacherId, sec7B, T.SUBJECT_TEACHER, math);
      const classT = await mkTeacher();
      await assignTeacher(classT.teacherId, sec7B, T.CLASS_TEACHER, null);
      const sci = await mkAssignment(class7, science, { section_id: sec7B });
      await submissions(sci.id, sec7B, S.SUBMITTED, 2);

      expect((await ask(mathT.userId)).total_submitted).toBe(0);
      expect((await ask(classT.userId)).total_submitted).toBe(2);
    });

    it('ignores DEACTIVATED and SUPERSEDED assignments', async () => {
      const t = await mkTeacher();
      await assignTeacher(t.teacherId, sec7B, T.CLASS_TEACHER, null);
      for (const status of [A.DEACTIVATED, A.SUPERSEDED]) {
        const a = await mkAssignment(class7, math, { section_id: sec7B }, { status });
        await submissions(a.id, sec7B, S.SUBMITTED, 1);
      }
      expect(await ask(t.userId)).toEqual(empty);
    });

    it('a single-student assignment counts under the student section', async () => {
      const t = await mkTeacher();
      await assignTeacher(t.teacherId, sec7B, T.SUBJECT_TEACHER, math);
      const st = await mkStudent(sec7B);
      const a = await mkAssignment(class7, math, { student_id: st.id });
      await dataSource
        .getRepository(HomeworkSubmission)
        .save({ assignment_id: a.id, student_id: st.id, status: S.SUBMITTED, tenant_id: TENANT });

      const res = await ask(t.userId);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({ section_name: 'B', submitted_count: 1 });
    });

    it('ignores a previous-year section mapping', async () => {
      const old = await dataSource.getRepository(AcademicYear).save({
        name: `Widgets Old ${Date.now()}`,
        start_date: '2025-01-01',
        end_date: '2025-12-31',
        tenant_id: TENANT,
      });
      const oldClass = await dataSource
        .getRepository(Class)
        .save({ name: 'Wid Old', academic_year_id: old.id, tenant_id: TENANT });
      const oldSec = await dataSource
        .getRepository(ClassSection)
        .save({ class_id: oldClass.id, section_name: 'Z', tenant_id: TENANT });
      const t = await mkTeacher();
      await assignTeacher(t.teacherId, oldSec.id, T.CLASS_TEACHER, null);
      const a = await mkAssignment(oldClass.id, math, { section_id: oldSec.id });
      await submissions(a.id, oldSec.id, S.SUBMITTED, 2);

      expect((await ask(t.userId)).total_submitted).toBe(0);
    });

    it('keeps the top 5 items but totals every assignment', async () => {
      const t = await mkTeacher();
      await assignTeacher(t.teacherId, sec7B, T.CLASS_TEACHER, null);
      for (let i = 0; i < 6; i += 1) {
        const a = await mkAssignment(class7, math, { section_id: sec7B }, { title: `HW${i}` });
        await submissions(a.id, sec7B, S.SUBMITTED, 1);
      }
      const res = await ask(t.userId);
      expect([res.items.length, res.assignment_count, res.total_submitted]).toEqual([5, 6, 6]);
    });

    it('reconciles: an item count equals the SUBMITTED rows of that assignment', async () => {
      const t = await mkTeacher();
      await assignTeacher(t.teacherId, sec7B, T.SUBJECT_TEACHER, math);
      const a = await mkAssignment(class7, math, { section_id: sec7B });
      await submissions(a.id, sec7B, S.SUBMITTED, 4);
      await submissions(a.id, sec7B, S.DONE, 2);
      // The same read `HomeworkSubmissionService.findAllForAssignment` ends with.
      const rows = await dataSource
        .getRepository(HomeworkSubmission)
        .find({ where: { assignment_id: a.id, tenant_id: TENANT } });

      const res = await ask(t.userId);
      expect(res.items[0].submitted_count).toBe(
        rows.filter((r) => r.status === S.SUBMITTED).length,
      );
    });

    it('never counts another tenant', async () => {
      const t = await mkTeacher();
      await assignTeacher(t.teacherId, sec7B, T.CLASS_TEACHER, null);
      const a = await mkAssignment(class7, math, { section_id: sec7B });
      await submissions(a.id, sec7B, S.SUBMITTED, 1);

      // The same user asking in school B has no teacher row there.
      expect(await ask(t.userId, TENANT_B)).toEqual(empty);
    });
  });

  describe('getSubmissionRateByClass [8.10.7.3.19]', () => {
    const today = () => localToday();

    it('counts assignments due in the last 7 days; SUBMITTED / PARTIAL / DONE are submitted', async () => {
      const in2 = await mkAssignment(
        class7,
        math,
        { section_id: sec7A },
        { due_date: addDays(today(), -2) },
      );
      await submissions(in2.id, sec7A, S.SUBMITTED, 1);
      await submissions(in2.id, sec7A, S.PARTIAL, 1);
      await submissions(in2.id, sec7A, S.NOT_SUBMITTED, 1);
      // One section per assignment: the card counts the section roster, so the students of one
      // assignment must not also sit on the others.
      const in5 = await mkAssignment(
        class7,
        math,
        { section_id: sec7B },
        { due_date: addDays(today(), -5) },
      );
      await submissions(in5.id, sec7B, S.DONE, 1);
      const out9 = await mkAssignment(
        class7,
        math,
        { section_id: sec8A },
        { due_date: addDays(today(), -9) },
      );
      await submissions(out9.id, sec8A, S.DONE, 5);

      const res = await analytics.getSubmissionRateByClass(TENANT);
      expect(res.window).toEqual({ from: addDays(today(), -6), to: today() });
      // 4 rows in the window, 3 complete (75%); the 9-day-old one is out.
      expect(res.classes).toEqual([
        { class_id: class7, class_name: 'Wid 7', assigned: 4, submitted: 3, percentage: 75 },
      ]);
      expect(res.overall).toEqual({ assigned: 4, submitted: 3, percentage: 75 });
    });

    it('floors the percentage (2 of 3 is 66)', async () => {
      const a = await mkAssignment(class7, math, { section_id: sec7A }, { due_date: today() });
      await submissions(a.id, sec7A, S.DONE, 2);
      await submissions(a.id, sec7A, S.NOT_SUBMITTED, 1);
      expect((await analytics.getSubmissionRateByClass(TENANT)).overall.percentage).toBe(66);
    });

    it('orders classes by numeric grade and skips DEACTIVATED assignments', async () => {
      const a8 = await mkAssignment(class8, math, { section_id: sec8A }, { due_date: today() });
      await submissions(a8.id, sec8A, S.DONE, 1);
      const a7 = await mkAssignment(class7, math, { section_id: sec7A }, { due_date: today() });
      await submissions(a7.id, sec7A, S.DONE, 1);
      const dead = await mkAssignment(
        class7,
        math,
        { section_id: sec7B },
        { due_date: today(), status: A.DEACTIVATED },
      );
      await submissions(dead.id, sec7B, S.DONE, 9);

      const res = await analytics.getSubmissionRateByClass(TENANT);
      expect(res.classes.map((c) => [c.class_name, c.assigned])).toEqual([
        ['Wid 7', 1],
        ['Wid 8', 1],
      ]);
    });

    it('reconciles with getClassRollup when every assignment is in the window', async () => {
      const a = await mkAssignment(class7, math, { section_id: sec7A }, { due_date: today() });
      await submissions(a.id, sec7A, S.SUBMITTED, 3);
      await submissions(a.id, sec7A, S.NOT_SUBMITTED, 2);

      const rate = (await analytics.getSubmissionRateByClass(TENANT)).classes[0];
      const rollup = await analytics.getClassRollup(class7, TENANT);
      expect([rate.assigned, rate.submitted]).toEqual([rollup.totalAssignments, rollup.completed]);
    });

    it('Dhaka midnight: 18:30Z on the 7th is already the 8th', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-07T18:30:00Z'));
      const res = await analytics.getSubmissionRateByClass(TENANT);
      expect(res.window).toEqual({ from: '2026-10-02', to: '2026-10-08' });
    });

    it('never mixes in another tenant', async () => {
      const a = await mkAssignment(class7, math, { section_id: sec7A }, { due_date: today() });
      await submissions(a.id, sec7A, S.DONE, 1);

      const b = await analytics.getSubmissionRateByClass(TENANT_B);
      expect(b.classes).toEqual([]);
      expect(b.overall).toEqual({ assigned: 0, submitted: 0, percentage: 0 });
    });
  });

  // #3171: the denominator is the roster (students on the target), not the rows that exist.
  describe('completion denominators come from the roster (#3171)', () => {
    const today = () => localToday();

    it('3 students on the section, 1 graded DONE: 33%, not 100%, in every rollup and the card', async () => {
      const a = await mkAssignment(class7, math, { section_id: sec7A }, { due_date: today() });
      const [done] = [await mkStudent(sec7A), await mkStudent(sec7A), await mkStudent(sec7A)];
      await dataSource
        .getRepository(HomeworkSubmission)
        .save({ assignment_id: a.id, student_id: done.id, status: S.DONE, tenant_id: TENANT });

      const section = await analytics.getSectionRollup(sec7A, TENANT);
      expect([section.totalAssignments, section.completed, section.completionPercent]).toEqual([
        3, 1, 33,
      ]);
      const cls = await analytics.getClassRollup(class7, TENANT);
      expect([cls.totalAssignments, cls.completed, cls.completionPercent]).toEqual([3, 1, 33]);
      const student = await analytics.getStudentRollup(done.id, TENANT);
      expect([student.totalAssignments, student.completionPercent]).toEqual([1, 100]);
      const card = (await analytics.getSubmissionRateByClass(TENANT)).classes[0];
      expect([card.assigned, card.submitted, card.percentage]).toEqual([3, 1, 33]);
    });

    it('grading another student does not move the rate', async () => {
      const a = await mkAssignment(class7, math, { section_id: sec7A }, { due_date: today() });
      const s1 = await mkStudent(sec7A);
      const s2 = await mkStudent(sec7A);
      const save = (student_id: string, status: HomeworkSubmissionStatus) =>
        dataSource
          .getRepository(HomeworkSubmission)
          .save({ assignment_id: a.id, student_id, status, tenant_id: TENANT });
      await save(s1.id, S.DONE);
      const before = (await analytics.getSectionRollup(sec7A, TENANT)).completionPercent;
      // The teacher marks the second student "not submitted": a row appears, the rate stays.
      await save(s2.id, S.NOT_SUBMITTED);
      expect((await analytics.getSectionRollup(sec7A, TENANT)).completionPercent).toBe(before);
    });

    it('a student with no row is a defaulter once the assignment is past due', async () => {
      const s = await mkStudent(sec7A);
      await mkAssignment(class7, math, { section_id: sec7A }, { due_date: '2020-01-01' });
      const r = await analytics.getStudentRollup(s.id, TENANT);
      expect([r.totalAssignments, r.completed, r.defaulters]).toEqual([1, 0, 1]);
    });

    it('a DEACTIVATED assignment adds nobody; a single-student target adds that student', async () => {
      const s = await mkStudent(sec7A);
      await mkAssignment(
        class7,
        math,
        { section_id: sec7A },
        { due_date: '2020-01-01', status: A.DEACTIVATED },
      );
      await mkAssignment(class7, math, { student_id: s.id }, { due_date: '2020-01-01' });
      const r = await analytics.getStudentRollup(s.id, TENANT);
      expect(r.totalAssignments).toBe(1);
    });

    it('homework not yet due adds nobody missing; an early hand-in still counts', async () => {
      // Without this, assigning new homework would drop every completion rate at once.
      const [early] = [await mkStudent(sec7A), await mkStudent(sec7A)];
      const a = await mkAssignment(class7, math, { section_id: sec7A }, { due_date: '2999-01-01' });
      await dataSource
        .getRepository(HomeworkSubmission)
        .save({ assignment_id: a.id, student_id: early.id, status: S.DONE, tenant_id: TENANT });
      const section = await analytics.getSectionRollup(sec7A, TENANT);
      expect([section.totalAssignments, section.completed, section.defaulters]).toEqual([1, 1, 0]);
      const cls = await analytics.getClassRollup(class7, TENANT);
      expect([cls.totalAssignments, cls.completionPercent]).toEqual([1, 100]);
    });

    it('never counts a withdrawn student or one in another section', async () => {
      await mkAssignment(class7, math, { section_id: sec7A }, { due_date: today() });
      await mkStudent(sec7A);
      await mkStudent(sec7B);
      const gone = await mkStudent(sec7A);
      await dataSource.getRepository(Student).update({ id: gone.id }, { deleted_at: new Date() });
      expect((await analytics.getSectionRollup(sec7A, TENANT)).totalAssignments).toBe(1);
    });
  });

  describe('getTeacherSyllabusProgress [8.10.7.3.19]', () => {
    const topics = async (class_id: string, subject_id: string, done: number, total: number) => {
      for (let i = 0; i < total; i += 1) {
        await dataSource.getRepository(SyllabusTopic).save({
          class_id,
          subject_id,
          tenant_id: TENANT,
          sequence: i + 1,
          name: `T${i + 1}`,
          status: i < done ? SyllabusTopicStatus.DONE : SyllabusTopicStatus.PLANNED,
        });
      }
    };

    it('Math of 7-A + 7-B and Science of 8-A give two items; 14 of 37 is 37; lowest first', async () => {
      const t = await mkTeacher();
      await assignTeacher(t.teacherId, sec7A, T.SUBJECT_TEACHER, math);
      await assignTeacher(t.teacherId, sec7B, T.SUBJECT_TEACHER, math);
      await assignTeacher(t.teacherId, sec8A, T.SUBJECT_TEACHER, science);
      // A class-teacher row has no subject, so it adds nothing.
      await assignTeacher(t.teacherId, sec8A, T.CLASS_TEACHER, null);
      await topics(class7, math, 14, 37);

      const { items } = await analytics.getTeacherSyllabusProgress(TENANT, t.userId);
      // Science has no topics (total 0, percentage 0), so it sorts first.
      expect(
        items.map((i) => [i.class_name, i.subject_name_en, i.done, i.total, i.percentage]),
      ).toEqual([
        ['Wid 8', 'Science', 0, 0, 0],
        ['Wid 7', 'Mathematics', 14, 37, 37],
      ]);
      expect(items[1].sections.map((s) => s.section_name)).toEqual(['A', 'B']);
    });

    it('a teacher with no rows gets an empty list', async () => {
      const t = await mkTeacher();
      expect(await analytics.getTeacherSyllabusProgress(TENANT, t.userId)).toEqual({
        items: [],
        behind_count: 0,
      });
    });

    it('reconciles with the syllabus list for the same class and subject', async () => {
      const t = await mkTeacher();
      await assignTeacher(t.teacherId, sec7A, T.SUBJECT_TEACHER, math);
      await topics(class7, math, 3, 5);

      const rows = await syllabus.findAll(TENANT, class7, math);
      const item = (await analytics.getTeacherSyllabusProgress(TENANT, t.userId)).items[0];
      expect([item.done, item.total]).toEqual([
        rows.filter((r) => r.status === SyllabusTopicStatus.DONE).length,
        rows.length,
      ]);
    });

    it('never mixes in another tenant', async () => {
      const t = await mkTeacher();
      await assignTeacher(t.teacherId, sec7A, T.SUBJECT_TEACHER, math);
      expect(await analytics.getTeacherSyllabusProgress(TENANT_B, t.userId)).toEqual({
        items: [],
        behind_count: 0,
      });
    });
  });
});
