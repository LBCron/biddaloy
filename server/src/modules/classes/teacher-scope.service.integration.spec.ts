import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { TeacherAssignmentType } from '@biddaloy/shared';
import { TeacherScopeService } from './teacher-scope.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { CoordinatorAssignment } from '../academics/entities/coordinator-assignment.entity';
import { User } from '../users/entities/user.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { NotFoundException } from '@nestjs/common';
import {
  teacherAssignments,
  teacherCanSeeStudent,
  teacherSectionIds,
} from './teacher-scope.service';

/**
 * Integration tests for `TeacherScopeService` against a real, migrated DB.
 * Years/classes/sections are created once per file; teachers, subjects and
 * assignment rows are "transactional" (truncated before every test by
 * `test/setup.ts`) so they are re-created in `beforeEach`.
 */
describe('TeacherScopeService (integration)', () => {
  // [83.2.1] No coordinator rows: the D19 field is always present, empty.
  const NO_COORD = { allSubjects: false, subjectIds: [] };
  let service: TeacherScopeService;
  let dataSource: DataSource;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000098';

  let sec6A: string; // Class 6 / A, current year
  let sec6B: string; // Class 6 / B, current year
  let sec7A: string; // Class 7 / A, current year
  let sec10A: string; // Class 10 / A, current year (numeric_grade ordering)
  let secDeleted: string; // soft-deleted section, current year
  let secClassDeleted: string; // section of a soft-deleted class, current year
  let secOld: string; // section of a past (non-current) year
  let secB: string; // tenant B section

  let userId: string;
  let teacherId: string;
  let liveSubjectId: string;
  let deletedSubjectId: string;
  let otherSubjectId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [TeacherScopeService]);
    service = module.get(TeacherScopeService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    for (const id of [TENANT_A, TENANT_B]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    // Only one current year per tenant; make ours the one.
    await yearRepo.update({ tenant_id: TENANT_A }, { is_current: false });

    const makeYear = (tenantId: string, name: string, isCurrent: boolean, year = 2026) =>
      yearRepo.save({
        name,
        start_date: `${year}-01-01`,
        end_date: `${year}-12-31`,
        is_current: isCurrent,
        tenant_id: tenantId,
      });
    const makeClass = (
      tenantId: string,
      yearId: string,
      name: string,
      numericGrade: number | null = null,
    ) =>
      classRepo.save({
        name,
        academic_year_id: yearId,
        tenant_id: tenantId,
        numeric_grade: numericGrade,
      });
    const makeSection = (tenantId: string, classId: string, name: string) =>
      sectionRepo.save({ section_name: name, class_id: classId, tenant_id: tenantId });

    const currentA = await makeYear(TENANT_A, 'Scope Current', true);
    const pastA = await makeYear(TENANT_A, 'Scope Past', false, 2025);
    // [X-07] bounds: only the year right before the current one keeps the grant.
    await makeYear(TENANT_A, 'Scope Older', false, 2024);
    await makeYear(TENANT_A, 'Scope Future', false, 2027);
    const class6 = await makeClass(TENANT_A, currentA.id, 'Class 6', 6);
    const class7 = await makeClass(TENANT_A, currentA.id, 'Class 7', 7);
    const class10 = await makeClass(TENANT_A, currentA.id, 'Class 10', 10);
    const classOld = await makeClass(TENANT_A, pastA.id, 'Class Old');
    sec6A = (await makeSection(TENANT_A, class6.id, 'A')).id;
    sec6B = (await makeSection(TENANT_A, class6.id, 'B')).id;
    sec7A = (await makeSection(TENANT_A, class7.id, 'A')).id;
    sec10A = (await makeSection(TENANT_A, class10.id, 'A')).id;
    const deleted = await makeSection(TENANT_A, class6.id, 'Z');
    secDeleted = deleted.id;
    await sectionRepo.softDelete({ id: deleted.id });
    const classGone = await makeClass(TENANT_A, currentA.id, 'Class Gone');
    secClassDeleted = (await makeSection(TENANT_A, classGone.id, 'A')).id;
    await classRepo.softDelete({ id: classGone.id });
    secOld = (await makeSection(TENANT_A, classOld.id, 'A')).id;

    const currentB = await makeYear(TENANT_B, 'Scope Current B', true);
    const classB = await makeClass(TENANT_B, currentB.id, 'Class 6');
    secB = (await makeSection(TENANT_B, classB.id, 'A')).id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    const user = await dataSource.getRepository(User).save({
      email: `scope-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'Scope Teacher',
    });
    userId = user.id;
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: userId,
      employee_id: `EMP-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      tenant_id: TENANT_A,
      designations: [],
    });
    teacherId = teacher.id;

    const subjectRepo = dataSource.getRepository(Subject);
    const makeSubject = (code: string) =>
      subjectRepo.save({ tenant_id: TENANT_A, name_en: code, code }).then((s) => s.id);
    liveSubjectId = await makeSubject('LIVE');
    deletedSubjectId = await makeSubject('GONE');
    otherSubjectId = await makeSubject('OTHER');
    await subjectRepo.softDelete({ id: deletedSubjectId });
  });

  const assign = (
    type: TeacherAssignmentType,
    sectionId: string,
    subjectId: string | null = null,
    over: { teacher_id?: string; tenant_id?: string } = {},
  ) =>
    dataSource.getRepository(TeacherClassSection).save({
      teacher_id: over.teacher_id ?? teacherId,
      section_id: sectionId,
      tenant_id: over.tenant_id ?? TENANT_A,
      subject_id: subjectId,
      assignment_type: type,
    });

  describe('rolesInSection', () => {
    const ask = (sectionId: string, tenantId = TENANT_A, user = userId) =>
      service.rolesInSection({ userId: user, tenantId, sectionId });

    it('reports CLASS_TEACHER', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      expect(await ask(sec6A)).toEqual({
        homeroom: TeacherAssignmentType.CLASS_TEACHER,
        subjectIds: [],
        inYearWindow: true,
        coordinated: NO_COORD,
      });
    });

    it('reports ASSISTANT_CLASS_TEACHER', async () => {
      await assign(TeacherAssignmentType.ASSISTANT_CLASS_TEACHER, sec6A);
      expect(await ask(sec6A)).toEqual({
        homeroom: TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
        subjectIds: [],
        inYearWindow: true,
        coordinated: NO_COORD,
      });
    });

    it('reports SUBJECT_TEACHER subjects, and homeroom + subjects together', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, otherSubjectId);
      const result = await ask(sec6A);
      expect(result.homeroom).toBe(TeacherAssignmentType.CLASS_TEACHER);
      expect(result.subjectIds.sort()).toEqual([liveSubjectId, otherSubjectId].sort());
    });

    it('reports nothing for a section the teacher is not mapped to', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      expect(await ask(sec6B)).toEqual({
        homeroom: null,
        subjectIds: [],
        inYearWindow: false,
        coordinated: NO_COORD,
      });
    });

    it('gives a soft-deleted teacher no roles', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      await dataSource.getRepository(Teacher).softDelete({ id: teacherId });
      expect(await ask(sec6A)).toEqual({
        homeroom: null,
        subjectIds: [],
        inYearWindow: false,
        coordinated: NO_COORD,
      });
    });

    it('excludes a soft-deleted subject (D16)', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, deletedSubjectId);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      expect((await ask(sec6A)).subjectIds).toEqual([liveSubjectId]);
    });

    it('gives no homeroom role in a past-year section (it would read every subject)', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, secOld);
      expect(await ask(secOld)).toEqual({
        homeroom: null,
        subjectIds: [],
        inYearWindow: false,
        coordinated: NO_COORD,
      });
    });

    describe('year switch with an unpublished exam [X-07]', () => {
      // A past-year class with its own section and exam, so the other tests keep `secOld` untouched.
      const mkOldClassWithExam = async (status: string, yearName = 'Scope Past') => {
        const old = await dataSource.getRepository(AcademicYear).findOneByOrFail({
          tenant_id: TENANT_A,
          name: yearName,
        });
        const cls = await dataSource.getRepository(Class).save({
          name: `Old exam ${Math.random()}`,
          academic_year_id: old.id,
          tenant_id: TENANT_A,
        });
        const sec = await dataSource
          .getRepository(ClassSection)
          .save({ section_name: 'X', class_id: cls.id, tenant_id: TENANT_A });
        const [{ id: examId }] = await dataSource.query(
          `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status)
           VALUES ($1, $2, $3, 'Annual', 'TERM', $4) RETURNING id`,
          [TENANT_A, old.id, cls.id, status],
        );
        return { sectionId: sec.id, examId: examId as string };
      };

      it('keeps homeroom in last year section while the class has an unpublished exam', async () => {
        const { sectionId } = await mkOldClassWithExam('DRAFT');
        await assign(TeacherAssignmentType.CLASS_TEACHER, sectionId);
        expect((await ask(sectionId)).homeroom).toBe(TeacherAssignmentType.CLASS_TEACHER);
      });

      it('reports a SUBJECT row of that section as in the year window (Epic 75 D31)', async () => {
        const { sectionId, examId } = await mkOldClassWithExam('DRAFT');
        await assign(TeacherAssignmentType.SUBJECT_TEACHER, sectionId, liveSubjectId);
        expect(await ask(sectionId)).toEqual({
          homeroom: null,
          subjectIds: [liveSubjectId],
          inYearWindow: true,
          coordinated: NO_COORD,
        });
        await dataSource.query(`UPDATE exams SET status = 'PUBLISHED' WHERE id = $1`, [examId]);
        expect((await ask(sectionId)).inYearWindow).toBe(false);
      });

      it('loses it once every exam of that class is PUBLISHED', async () => {
        const { sectionId, examId } = await mkOldClassWithExam('DRAFT');
        await assign(TeacherAssignmentType.CLASS_TEACHER, sectionId);
        await dataSource.query(`UPDATE exams SET status = 'PUBLISHED' WHERE id = $1`, [examId]);
        expect((await ask(sectionId)).homeroom).toBeNull();
      });

      // Same "open" test as the marks-overdue alert: only DRAFT. A PROCESSED
      // exam has cleared the alert, so it must not keep the grant either.
      it('a PROCESSED exam does not extend the grant', async () => {
        const { sectionId } = await mkOldClassWithExam('PROCESSED');
        await assign(TeacherAssignmentType.CLASS_TEACHER, sectionId);
        expect((await ask(sectionId)).homeroom).toBeNull();
      });

      it('an abandoned DRAFT exam two years back does not extend the grant', async () => {
        const { sectionId } = await mkOldClassWithExam('DRAFT', 'Scope Older');
        await assign(TeacherAssignmentType.CLASS_TEACHER, sectionId);
        expect((await ask(sectionId)).homeroom).toBeNull();
      });

      it('a DRAFT exam in a future year does not extend the grant', async () => {
        const { sectionId } = await mkOldClassWithExam('DRAFT', 'Scope Future');
        await assign(TeacherAssignmentType.CLASS_TEACHER, sectionId);
        expect((await ask(sectionId)).homeroom).toBeNull();
      });

      it('a class with only PUBLISHED exams does not extend the grant', async () => {
        const { sectionId } = await mkOldClassWithExam('PUBLISHED');
        await assign(TeacherAssignmentType.CLASS_TEACHER, sectionId);
        expect((await ask(sectionId)).homeroom).toBeNull();
      });
    });

    it('gives no homeroom role in a soft-deleted section or class', async () => {
      await assign(TeacherAssignmentType.ASSISTANT_CLASS_TEACHER, secDeleted);
      await assign(TeacherAssignmentType.CLASS_TEACHER, secClassDeleted);
      expect((await ask(secDeleted)).homeroom).toBeNull();
      expect((await ask(secClassDeleted)).homeroom).toBeNull();
    });

    it('still reports SUBJECT_TEACHER subjects in a past-year section (unchanged)', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, secOld, liveSubjectId);
      expect(await ask(secOld)).toEqual({
        homeroom: null,
        subjectIds: [liveSubjectId],
        inYearWindow: false,
        coordinated: NO_COORD,
      });
    });

    it("never shows another teacher's rows", async () => {
      const otherUser = await dataSource
        .getRepository(User)
        .save({ email: `scope-other-${Date.now()}@test.com`, full_name: 'Other' });
      const otherTeacher = await dataSource.getRepository(Teacher).save({
        user_id: otherUser.id,
        employee_id: `EMP-O-${Date.now()}`,
        tenant_id: TENANT_A,
        designations: [],
      });
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A, null, {
        teacher_id: otherTeacher.id,
      });
      expect(await ask(sec6A)).toEqual({
        homeroom: null,
        subjectIds: [],
        inYearWindow: false,
        coordinated: NO_COORD,
      });
    });

    it("tenant isolation: tenant A's rows are invisible when asking as tenant B", async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      expect(await ask(sec6A, TENANT_B)).toEqual({
        homeroom: null,
        subjectIds: [],
        inYearWindow: false,
        coordinated: NO_COORD,
      });
    });
  });

  describe('homeroomSections', () => {
    const list = (tenantId = TENANT_A, user = userId) =>
      service.homeroomSections({ userId: user, tenantId });

    it('returns CLASS and ASSISTANT sections ordered class then section, with names', async () => {
      await assign(TeacherAssignmentType.ASSISTANT_CLASS_TEACHER, sec7A);
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6B);
      await assign(TeacherAssignmentType.ASSISTANT_CLASS_TEACHER, sec6A);
      const rows = await list();
      expect(rows).toEqual([
        {
          section_id: sec6A,
          section_name: 'A',
          class_id: expect.any(String),
          class_name: 'Class 6',
          assignment_type: TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
        },
        expect.objectContaining({
          section_id: sec6B,
          assignment_type: TeacherAssignmentType.CLASS_TEACHER,
        }),
        expect.objectContaining({ section_id: sec7A, class_name: 'Class 7' }),
      ]);
    });

    it('orders by numeric_grade, so Class 10 comes after Class 7', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec10A);
      await assign(TeacherAssignmentType.ASSISTANT_CLASS_TEACHER, sec7A);
      const rows = await list();
      expect(rows.map((r) => r.class_name)).toEqual(['Class 7', 'Class 10']);
    });

    it('returns [] for a subject-only teacher', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      expect(await list()).toEqual([]);
    });

    it('excludes a past-year section', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, secOld);
      expect(await list()).toEqual([]);
    });

    it('excludes a section whose class is soft-deleted', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, secClassDeleted);
      expect(await list()).toEqual([]);
    });

    it('gives a soft-deleted teacher no sections', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      await dataSource.getRepository(Teacher).softDelete({ id: teacherId });
      expect(await list()).toEqual([]);
    });

    it('excludes a soft-deleted section', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, secDeleted);
      expect(await list()).toEqual([]);
    });

    it("tenant isolation: another tenant's rows are invisible", async () => {
      // A different user (a user has one teacher row per school) teaching in
      // tenant B, mapped to tenant B's section.
      const userB = await dataSource
        .getRepository(User)
        .save({ email: `scope-b-${Date.now()}@test.com`, full_name: 'Teacher B' });
      const teacherB = await dataSource.getRepository(Teacher).save({
        user_id: userB.id,
        employee_id: `EMP-B-${Date.now()}`,
        tenant_id: TENANT_B,
        designations: [],
      });
      await assign(TeacherAssignmentType.CLASS_TEACHER, secB, null, {
        teacher_id: teacherB.id,
        tenant_id: TENANT_B,
      });
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);

      expect((await list(TENANT_A)).map((r) => r.section_id)).toEqual([sec6A]);
      // Teacher A asking as tenant B, and teacher B asking as tenant A: nothing.
      expect(await list(TENANT_B)).toEqual([]);
      expect(await list(TENANT_A, userB.id)).toEqual([]);
      expect((await list(TENANT_B, userB.id)).map((r) => r.section_id)).toEqual([secB]);
    });
  });

  describe('arrivalRequestCounts', () => {
    it('counts linked REQUESTED rows per section, not ACTIVE, and is tenant-scoped', async () => {
      const mkStudent = async (sectionId: string, n: number, linked = true) => {
        const [st] = await dataSource.query(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
           VALUES ('Arr S', $1, $2, $3, $4) RETURNING id`,
          [`ARR-${Date.now()}-${n}`, `${n}`, sectionId, TENANT_A],
        );
        const [g] = await dataSource.query(
          `INSERT INTO guardians (full_name, relationship, phone, tenant_id) VALUES ('Arr G', 'FATHER', '01700000000', $1) RETURNING id`,
          [TENANT_A],
        );
        if (linked) {
          await dataSource.query(
            `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
            [st.id, g.id],
          );
        }
        return { student: st.id as string, guardian: g.id as string };
      };
      const sub = (ids: { student: string; guardian: string }, status: string) =>
        dataSource.query(
          `INSERT INTO arrival_notice_subscriptions (tenant_id, student_id, guardian_id, status)
           VALUES ($1, $2, $3, $4)`,
          [TENANT_A, ids.student, ids.guardian, status],
        );
      for (let i = 0; i < 3; i++) await sub(await mkStudent(sec6A, i), 'REQUESTED');
      await sub(await mkStudent(sec6A, 9), 'ACTIVE');
      // A guardian unlinked from the child: the row survives the unlink but is not a request.
      await sub(await mkStudent(sec6A, 8, false), 'REQUESTED');
      // A soft-deleted guardian: the staff list hides the row, so the badge must too.
      const gone = await mkStudent(sec6A, 7);
      await sub(gone, 'REQUESTED');
      await dataSource.query(`UPDATE guardians SET deleted_at = now() WHERE id = $1`, [
        gone.guardian,
      ]);
      const input = { tenantId: TENANT_A, sectionIds: [sec6A, sec6B] };
      const counts = await service.arrivalRequestCounts(input);
      expect([counts.get(sec6A) ?? 0, counts.get(sec6B) ?? 0]).toEqual([3, 0]);
      expect((await service.arrivalRequestCounts({ ...input, tenantId: TENANT_B })).size).toBe(0);
      expect((await service.arrivalRequestCounts({ ...input, sectionIds: [] })).size).toBe(0);
    });
  });

  describe('teachesSubjectInClass', () => {
    const ask = (classId: string, subjectId: string, tenantId = TENANT_A, user = userId) =>
      service.teachesSubjectInClass({ userId: user, tenantId, classId, subjectId });
    const classOf = async (sectionId: string) =>
      (
        await dataSource
          .getRepository(ClassSection)
          .findOneOrFail({ where: { id: sectionId }, withDeleted: true })
      ).class_id;

    it('true for the mapped class and subject, false for other subject or class', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      expect(await ask(await classOf(sec6A), liveSubjectId)).toBe(true);
      // any section of the same class counts
      expect(await ask(await classOf(sec6B), liveSubjectId)).toBe(true);
      expect(await ask(await classOf(sec6A), otherSubjectId)).toBe(false);
      expect(await ask(await classOf(sec7A), liveSubjectId)).toBe(false);
    });

    it('false for a homeroom-only teacher', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      expect(await ask(await classOf(sec6A), liveSubjectId)).toBe(false);
    });

    it('false for a soft-deleted section, subject or teacher', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, secDeleted, liveSubjectId);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec7A, deletedSubjectId);
      expect(await ask(await classOf(secDeleted), liveSubjectId)).toBe(false);
      expect(await ask(await classOf(sec7A), deletedSubjectId)).toBe(false);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec10A, liveSubjectId);
      await dataSource.getRepository(Teacher).softDelete({ id: teacherId });
      expect(await ask(await classOf(sec10A), liveSubjectId)).toBe(false);
    });

    it("false for another tenant's identical row", async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      const classId = await classOf(sec6A);
      expect(await ask(classId, liveSubjectId, TENANT_B)).toBe(false);
    });
  });

  describe('sectionIds / sectionScope (68.3.01)', () => {
    const ids = (tenantId = TENANT_A, user = userId) =>
      service.sectionIds({ userId: user, tenantId });

    it('returns the homeroom section and the subject sections, with no duplicates', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, otherSubjectId);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec10A, liveSubjectId);
      expect((await ids()).sort()).toEqual([sec6A, sec10A].sort());
    });

    it("a soft-deleted subject's section drops out", async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec7A, deletedSubjectId);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6B, liveSubjectId);
      expect(await ids()).toEqual([sec6B]);
    });

    it("last year's homeroom does not count", async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, secOld);
      await assign(TeacherAssignmentType.CLASS_TEACHER, secDeleted);
      expect(await ids()).toEqual([]);
    });

    it('sectionScope is null for ADMIN and EXECUTIVE, an array for TEACHER', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      const base = { userId, tenantId: TENANT_A };
      expect(await service.sectionScope({ ...base, role: 'ADMIN' })).toBeNull();
      expect(await service.sectionScope({ ...base, role: 'EXECUTIVE' })).toBeNull();
      expect(await service.sectionScope({ ...base, role: 'TEACHER' })).toEqual([sec6A]);
    });

    it('sectionScope fails closed: an unknown role sees nothing ([])', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      expect(
        await service.sectionScope({ userId, tenantId: TENANT_A, role: 'NOT_A_ROLE' }),
      ).toEqual([]);
    });

    it("tenant isolation: a teacher row in tenant B never widens tenant A's scope", async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      await assign(TeacherAssignmentType.CLASS_TEACHER, secB, null, { tenant_id: TENANT_B });
      expect(await ids()).toEqual([sec6A]);
      expect(await ids(TENANT_B)).toEqual([]);
    });
  });

  describe('shared current-year queries (Epic 75, 75.6)', () => {
    const base = () => ({ userId, tenantId: TENANT_A });
    const manager = () => dataSource.manager;
    const makeStudentIn = (sectionId: string, tenantId = TENANT_A) =>
      dataSource.getRepository(Student).save({
        full_name: 'Scope Child',
        registration_number: `SC-${Math.random().toString(36).slice(2, 10)}`,
        roll_number: Math.floor(Math.random() * 100000),
        class_section_id: sectionId,
        tenant_id: tenantId,
      } as Partial<Student> as Student);

    it('teacherAssignments returns the current-year rows with their subject', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      const rows = await teacherAssignments(manager(), base());
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        section_id: sec6A,
        assignment_type: TeacherAssignmentType.SUBJECT_TEACHER,
        subject_id: liveSubjectId,
      });
      expect(rows[0].class_id).toBeTruthy();
    });

    it('excludes a past-year section (even for a SUBJECT row), deleted section, deleted subject, other tenant', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, secOld);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, secOld, liveSubjectId);
      await assign(TeacherAssignmentType.CLASS_TEACHER, secDeleted);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec7A, deletedSubjectId);
      await assign(TeacherAssignmentType.CLASS_TEACHER, secB, null, { tenant_id: TENANT_B });
      expect(await teacherAssignments(manager(), base())).toEqual([]);
      expect(await teacherAssignments(manager(), { userId, tenantId: TENANT_B })).toEqual([]);
    });

    it('teacherSectionIds dedupes a CLASS row plus a SUBJECT row in one section', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      expect(await teacherSectionIds(manager(), base())).toEqual([sec6A]);
    });

    it('teacherCanSeeStudent: true in A; false in B, past year, deleted, other tenant, non-UUID', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      await assign(TeacherAssignmentType.CLASS_TEACHER, secOld);
      const inA = await makeStudentIn(sec6A);
      const inB = await makeStudentIn(sec6B);
      const inOld = await makeStudentIn(secOld);
      const gone = await makeStudentIn(sec6A);
      await dataSource.getRepository(Student).softDelete({ id: gone.id });
      const see = (studentId: string, tenantId = TENANT_A) =>
        teacherCanSeeStudent(manager(), { userId, tenantId, studentId });
      expect(await see(inA.id)).toBe(true);
      expect(await see(inB.id)).toBe(false);
      expect(await see(inOld.id)).toBe(false);
      expect(await see(gone.id)).toBe(false);
      expect(await see(inA.id, TENANT_B)).toBe(false);
      expect(await see('not-a-uuid')).toBe(false);
    });

    it('scopedStudentIds: only live students of visible sections; null for ADMIN; [] with no rows', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      const inA = await makeStudentIn(sec6A);
      await makeStudentIn(sec6B);
      const gone = await makeStudentIn(sec6A);
      await dataSource.getRepository(Student).softDelete({ id: gone.id });
      const base = { userId, tenantId: TENANT_A };
      expect(await service.scopedStudentIds({ ...base, role: 'TEACHER' })).toEqual([inA.id]);
      expect(await service.scopedStudentIds({ ...base, role: 'ADMIN' })).toBeNull();
      expect(
        await service.scopedStudentIds({
          userId: '00000000-0000-4000-8000-0000000000aa',
          tenantId: TENANT_A,
          role: 'TEACHER',
        }),
      ).toEqual([]);
    });

    it('assertCanSeeGuardian: 404 outside scope, ok inside, no-op for ADMIN', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      const guardianRepo = dataSource.getRepository(Guardian);
      const link = async (student: Student) => {
        const g = await guardianRepo.save({
          full_name: 'Scope Guardian',
          relationship: 'FATHER',
          phone: '+8801700000001',
          tenant_id: TENANT_A,
        } as Partial<Guardian> as Guardian);
        await dataSource.query(
          `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
          [student.id, g.id],
        );
        return g.id;
      };
      const gA = await link(await makeStudentIn(sec6A));
      const gB = await link(await makeStudentIn(sec6B));
      const ask = (guardianId: string, role = 'TEACHER') =>
        service.assertCanSeeGuardian({ userId, tenantId: TENANT_A, role, guardianId });
      // Review n-new-7: it hands back the scope it computed, so callers need not compute it again.
      await expect(ask(gA)).resolves.toEqual([sec6A]);
      await expect(ask(gB)).rejects.toThrow(NotFoundException);
      await expect(ask('not-a-uuid')).rejects.toThrow(NotFoundException);
      await expect(ask(gB, 'ADMIN')).resolves.toBeNull();
    });
  });

  /**
   * [83.2.1] Coordinator rows widen reads only when the caller passes `includeCoordinated: true`
   * (D18). `homeroom` / `subjectIds` never change (D19), so write gates stay as on main.
   */
  describe('coordinator rows (83.2.1)', () => {
    const coordinate = async (
      sectionOfClass: string,
      subjectId: string | null = null,
      over: { tenant_id?: string; teacher_id?: string } = {},
    ) => {
      const classId = (
        await dataSource.query(`SELECT class_id FROM class_sections WHERE id = $1`, [
          sectionOfClass,
        ])
      )[0].class_id as string;
      await dataSource.getRepository(CoordinatorAssignment).save({
        tenant_id: over.tenant_id ?? TENANT_A,
        teacher_id: over.teacher_id ?? teacherId,
        class_id: classId,
        subject_id: subjectId,
      });
      return classId;
    };
    const ids = (includeCoordinated?: boolean, tenantId = TENANT_A) =>
      service.sectionIds({ userId, tenantId, includeCoordinated }).then((r) => r.sort());

    it('a class-level row lists every live section of the class, only with the flag', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec10A, liveSubjectId);
      await coordinate(sec6A);
      // Live sections of Class 6 are A and B; the soft-deleted Z never shows.
      expect(await ids(true)).toEqual([sec6A, sec6B, sec10A].sort());
      // Without the flag: today's answer, teaching rows only.
      expect(await ids()).toEqual([sec10A]);
      expect(await ids(false)).toEqual([sec10A]);
    });

    it('sectionScope passes the flag through; ADMIN stays null', async () => {
      await coordinate(sec7A);
      const base = { userId, tenantId: TENANT_A };
      expect(await service.sectionScope({ ...base, role: 'TEACHER' })).toEqual([]);
      expect(
        await service.sectionScope({ ...base, role: 'TEACHER', includeCoordinated: true }),
      ).toEqual([sec7A]);
      expect(
        await service.sectionScope({ ...base, role: 'ADMIN', includeCoordinated: true }),
      ).toBeNull();
    });

    it('rolesInSection: class-level row → allSubjects; homeroom / subjectIds unchanged', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, otherSubjectId);
      await coordinate(sec6A);
      expect(
        await service.rolesInSection({ userId, tenantId: TENANT_A, sectionId: sec6A }),
      ).toEqual({
        homeroom: null,
        subjectIds: [otherSubjectId],
        inYearWindow: true,
        coordinated: { allSubjects: true, subjectIds: [] },
      });
      // Section B of the same class: coordinated, but no teaching role at all.
      expect(
        await service.rolesInSection({ userId, tenantId: TENANT_A, sectionId: sec6B }),
      ).toEqual({
        homeroom: null,
        subjectIds: [],
        inYearWindow: false,
        coordinated: { allSubjects: true, subjectIds: [] },
      });
    });

    it('rolesInSection: subject-level row → only that subject', async () => {
      await coordinate(sec6A, liveSubjectId);
      const roles = await service.rolesInSection({ userId, tenantId: TENANT_A, sectionId: sec6B });
      expect(roles.coordinated).toEqual({ allSubjects: false, subjectIds: [liveSubjectId] });
      expect(roles.homeroom).toBeNull();
      expect(roles.subjectIds).toEqual([]);
    });

    it("'classLevel' widens for a class row but not for a subject row (results / analysis, D4)", async () => {
      await coordinate(sec6A);
      await coordinate(sec7A, liveSubjectId);
      const scoped = await service.sectionIds({
        userId,
        tenantId: TENANT_A,
        includeCoordinated: 'classLevel',
      });
      expect(scoped.sort()).toEqual([sec6A, sec6B].sort());
      // A student of the subject-coordinated class stays out of the all-subject reads.
      const st = await dataSource.getRepository(Student).save({
        full_name: 'Subject Coord Student',
        registration_number: `REG-SC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        roll_number: 2,
        class_section_id: sec7A,
        tenant_id: TENANT_A,
      } as Partial<Student> as Student);
      const base = { userId, tenantId: TENANT_A, studentId: st.id };
      expect(await service.canSeeStudent({ ...base, includeCoordinated: 'classLevel' })).toBe(
        false,
      );
      expect(await service.canSeeStudent({ ...base, includeCoordinated: true })).toBe(true);
    });

    it('a row on a past-year class is not listed (current year only, D14)', async () => {
      await coordinate(secOld);
      expect(await ids(true)).toEqual([]);
      const roles = await service.rolesInSection({ userId, tenantId: TENANT_A, sectionId: secOld });
      expect(roles.coordinated).toEqual(NO_COORD);
    });

    it('a subject-level row on a soft-deleted subject is not listed', async () => {
      await coordinate(sec7A, deletedSubjectId);
      expect(await ids(true)).toEqual([]);
    });

    it("tenant isolation: a tenant-B row never widens tenant A's scope", async () => {
      await coordinate(secB, null, { tenant_id: TENANT_B });
      expect(await ids(true)).toEqual([]);
      expect(await ids(true, TENANT_B)).toEqual([]);
    });

    it('canSeeStudent: a student of a coordinated section only with the flag', async () => {
      await coordinate(sec7A);
      const st = await dataSource.getRepository(Student).save({
        full_name: 'Coord Student',
        registration_number: `REG-CO-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        roll_number: 1,
        class_section_id: sec7A,
        tenant_id: TENANT_A,
      } as Partial<Student> as Student);
      const base = { userId, tenantId: TENANT_A, studentId: st.id };
      expect(await service.canSeeStudent(base)).toBe(false);
      expect(await service.canSeeStudent({ ...base, includeCoordinated: true })).toBe(true);
      expect(
        await service.scopedStudentIds({ userId, tenantId: TENANT_A, role: 'TEACHER' }),
      ).toEqual([]);
      expect(
        await service.scopedStudentIds({
          userId,
          tenantId: TENANT_A,
          role: 'TEACHER',
          includeCoordinated: true,
        }),
      ).toEqual([st.id]);
    });

    it('coordinatedClasses: one row per (class, subject) with the live section ids', async () => {
      const class6 = await coordinate(sec6A);
      const class7 = await coordinate(sec7A, liveSubjectId);
      await coordinate(secOld);
      expect(await service.coordinatedClasses({ userId, tenantId: TENANT_A })).toEqual([
        {
          class_id: class6,
          class_name: 'Class 6',
          subject_id: null,
          subject_name: null,
          section_ids: [sec6A, sec6B].sort(),
        },
        {
          class_id: class7,
          class_name: 'Class 7',
          subject_id: liveSubjectId,
          subject_name: 'LIVE',
          section_ids: [sec7A],
        },
      ]);
      expect(await service.coordinatedClasses({ userId, tenantId: TENANT_B })).toEqual([]);
    });

    it('currentAssignments and homeroomSections ignore coordinator rows', async () => {
      await coordinate(sec6A);
      expect(await service.currentAssignments({ userId, tenantId: TENANT_A })).toEqual([]);
      expect(await service.homeroomSections({ userId, tenantId: TENANT_A })).toEqual([]);
    });
  });
});
