import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { Subject } from '../academics/entities/subject.entity';
import { RoutineSlotTeacher } from '../routines/entities/routine-slot-teacher.entity';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID } from '@test/constants';
import { AttendanceAccessService } from './attendance-access.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { User } from '../users/entities/user.entity';
import {
  Permission,
  RoutineState,
  TeacherAssignmentType,
  UserRole,
  roleHasPermission,
} from '@biddaloy/shared';
import { ConfigModule } from '@nestjs/config';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { seedPeriodRoutine } from './attendance-periods.fixture';

/**
 * Integration tests for `AttendanceAccessService` — the object-level "may
 * this caller touch this section?" gate. Runs against a real, migrated test
 * database (see `attendance-entities.integration.spec.ts`'s docstring for
 * why `dropSchema` specs are avoided in this module).
 *
 * `teachers`/`teacher_class_sections` are "transactional" tables — the
 * global `beforeEach` in `test/setup.ts` truncates them before *every*
 * test, unlike `schools`/`users`/`academic_years`/`classes`/`class_sections`
 * (reset once per *file*, per `test/reset-order.ts`). So the section/class
 * fixtures are created once in `beforeAll`, but every teacher and mapping
 * row is re-created in `beforeEach`, matching
 * `attendance-entities.integration.spec.ts`'s own pattern.
 */
describe('AttendanceAccessService (integration)', () => {
  let service: AttendanceAccessService;
  let dataSource: DataSource;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000099';

  let sectionA1Id: string;
  let sectionA2Id: string; // exists in tenant A; teacher A is never mapped to it
  let sectionOldId: string; // tenant A, past (non-current) academic year
  let sectionB1Id: string; // same section_name as A1, in tenant B

  let teacherAUserId: string;
  let teacherAId: string;
  let teacherBUserId: string;
  let teacherBId: string;

  beforeAll(async () => {
    // The whole module, not just this provider: the period gate needs the
    // routine resolver, which AttendanceModule imports from RoutinesModule.
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get<AttendanceAccessService>(AttendanceAccessService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    async function seedSections(tenantId: string, sectionName: string) {
      if (!(await schoolRepo.findOne({ where: { id: tenantId } }))) {
        await schoolRepo.save({
          id: tenantId,
          name: tenantId,
          slug: `school-${tenantId.slice(-4)}`,
        });
      }
      // A distinct name from the file-level baseline seed's own
      // `SEED_ACADEMIC_YEAR_ID` ('2026-2027') — both exist for `TENANT_A`,
      // and `(name, tenant_id)` is unique.
      // Only one current year per tenant (D2: teacher scope is current-year only).
      // Its dates must not overlap the baseline year: the routine resolver
      // picks *a* year covering the period tests' DATE (2026) with no
      // ordering, and the fixture routine lives under the baseline year.
      await yearRepo.update({ tenant_id: tenantId }, { is_current: false });
      const year = await yearRepo.save({
        name: 'Attendance Access Test Year',
        start_date: '2027-01-01',
        end_date: '2027-12-31',
        is_current: true,
        tenant_id: tenantId,
      });
      const klass = await classRepo.save({
        name: 'Class 6',
        academic_year_id: year.id,
        tenant_id: tenantId,
      });
      const section1 = await sectionRepo.save({
        section_name: sectionName,
        class_id: klass.id,
        tenant_id: tenantId,
      });
      const section2 = await sectionRepo.save({
        section_name: `${sectionName}2`,
        class_id: klass.id,
        tenant_id: tenantId,
      });
      const oldYear = await yearRepo.save({
        name: `Attendance Past Year ${tenantId.slice(-4)}`,
        start_date: '2025-01-01',
        end_date: '2025-12-31',
        is_current: false,
        tenant_id: tenantId,
      });
      const oldClass = await classRepo.save({
        name: 'Class 6 (past)',
        academic_year_id: oldYear.id,
        tenant_id: tenantId,
      });
      const sectionOld = await sectionRepo.save({
        section_name: `${sectionName}-old`,
        class_id: oldClass.id,
        tenant_id: tenantId,
      });
      return { section1Id: section1.id, section2Id: section2.id, sectionOldId: sectionOld.id };
    }

    const a = await seedSections(TENANT_A, 'A');
    sectionA1Id = a.section1Id;
    sectionA2Id = a.section2Id;
    sectionOldId = a.sectionOldId;

    const b = await seedSections(TENANT_B, 'A'); // deliberately the same name as tenant A's section 1
    sectionB1Id = b.section1Id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    const userRepo = dataSource.getRepository(User);
    const teacherRepo = dataSource.getRepository(Teacher);
    const tcsRepo = dataSource.getRepository(TeacherClassSection);

    async function seedTeacher(tenantId: string, sectionId: string) {
      const user = await userRepo.save({
        email: `teacher-${tenantId.slice(-4)}-${Date.now()}-${Math.random()}@test.com`,
        full_name: `Teacher ${tenantId.slice(-4)}`,
      });
      const teacher = await teacherRepo.save({
        user_id: user.id,
        employee_id: `EMP-${tenantId.slice(-4)}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        tenant_id: tenantId,
        designations: [],
      });
      await tcsRepo.save({
        teacher_id: teacher.id,
        section_id: sectionId,
        tenant_id: tenantId,
        subject_id: null,
      });
      return { userId: user.id, teacherId: teacher.id };
    }

    // Teacher A is mapped only to section A1, not A2.
    const a = await seedTeacher(TENANT_A, sectionA1Id);
    teacherAUserId = a.userId;
    teacherAId = a.teacherId;

    // Teacher B is mapped to the same-named section in tenant B.
    const b = await seedTeacher(TENANT_B, sectionB1Id);
    teacherBUserId = b.userId;
    teacherBId = b.teacherId;
  });

  describe('listMarkableSections', () => {
    it('gives a TEACHER only the sections they are mapped to', async () => {
      const sections = await service.listMarkableSections(
        UserRole.TEACHER,
        teacherAUserId,
        TENANT_A,
      );
      expect(sections.map((s) => s.id)).toEqual([sectionA1Id]);
    });

    it("does not leak tenant A's section to a same-named section's teacher in tenant B", async () => {
      const sections = await service.listMarkableSections(
        UserRole.TEACHER,
        teacherBUserId,
        TENANT_B,
      );
      expect(sections.map((s) => s.id)).toEqual([sectionB1Id]);
      expect(sections.map((s) => s.id)).not.toContain(sectionA1Id);
    });

    it('gives a TEACHER with no assignment no sections', async () => {
      await dataSource.getRepository(TeacherClassSection).delete({ teacher_id: teacherAId });
      expect(
        await service.listMarkableSections(UserRole.TEACHER, teacherAUserId, TENANT_A),
      ).toEqual([]);
    });

    it('gives a TEACHER only the current-year section when also mapped to a past-year one', async () => {
      await dataSource.getRepository(TeacherClassSection).save({
        teacher_id: teacherAId,
        section_id: sectionOldId,
        tenant_id: TENANT_A,
        subject_id: null,
      });
      const sections = await service.listMarkableSections(
        UserRole.TEACHER,
        teacherAUserId,
        TENANT_A,
      );
      expect(sections.map((s) => s.id)).toEqual([sectionA1Id]);
    });

    it('gives a soft-deleted teacher no sections', async () => {
      await dataSource.getRepository(Teacher).softDelete({ id: teacherAId });
      expect(
        await service.listMarkableSections(UserRole.TEACHER, teacherAUserId, TENANT_A),
      ).toEqual([]);
    });

    it('gives ADMIN every section in the tenant', async () => {
      const sections = await service.listMarkableSections(UserRole.ADMIN, teacherAUserId, TENANT_A);
      const ids = sections.map((s) => s.id);
      expect(ids).toContain(sectionA1Id);
      expect(ids).toContain(sectionA2Id);
      expect(ids).not.toContain(sectionB1Id);
    });

    it('does not list a previous-year section for ADMIN, but it stays reachable by direct link', async () => {
      const ids = (
        await service.listMarkableSections(UserRole.ADMIN, teacherAUserId, TENANT_A)
      ).map((s) => s.id);
      expect(ids).not.toContain(sectionOldId);
      // Old registers stay readable/correctable by direct URL.
      const opened = await service.assertCanAccessSection(
        UserRole.ADMIN,
        teacherAUserId,
        sectionOldId,
        TENANT_A,
      );
      expect(opened.id).toBe(sectionOldId);
    });

    it('gives ADMIN no sections when the tenant has no current year', async () => {
      await dataSource
        .getRepository(AcademicYear)
        .update({ tenant_id: TENANT_A }, { is_current: false });
      try {
        expect(
          await service.listMarkableSections(UserRole.ADMIN, teacherAUserId, TENANT_A),
        ).toEqual([]);
      } finally {
        await dataSource
          .getRepository(AcademicYear)
          .update(
            { tenant_id: TENANT_A, name: 'Attendance Access Test Year' },
            { is_current: true },
          );
      }
    });

    it('gives an unrecognized role no sections at all', async () => {
      const sections = await service.listMarkableSections(
        'SOME_OTHER_ROLE',
        teacherAUserId,
        TENANT_A,
      );
      expect(sections).toEqual([]);
    });
  });

  describe('assertCanAccessSection', () => {
    it('allows a TEACHER to access their own mapped section', async () => {
      const section = await service.assertCanAccessSection(
        UserRole.TEACHER,
        teacherAUserId,
        sectionA1Id,
        TENANT_A,
      );
      expect(section.id).toBe(sectionA1Id);
    });

    it('404s a TEACHER attempting a section they are not mapped to', async () => {
      await expect(
        service.assertCanAccessSection(UserRole.TEACHER, teacherAUserId, sectionA2Id, TENANT_A),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s a TEACHER mapped only to a past-year section', async () => {
      await dataSource.getRepository(TeacherClassSection).save({
        teacher_id: teacherAId,
        section_id: sectionOldId,
        tenant_id: TENANT_A,
        subject_id: null,
      });
      await expect(
        service.assertCanAccessSection(UserRole.TEACHER, teacherAUserId, sectionOldId, TENANT_A),
      ).rejects.toThrow(NotFoundException);
    });

    it("404s tenant B's teacher attempting to use tenant A's X-Tenant-ID header against their own section id", async () => {
      // Cross-tenant probe: teacher B is genuinely mapped to sectionB1Id,
      // but calling with tenant A's id must find nothing.
      await expect(
        service.assertCanAccessSection(UserRole.TEACHER, teacherBUserId, sectionB1Id, TENANT_A),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows ADMIN to access any section in the tenant', async () => {
      const section = await service.assertCanAccessSection(
        UserRole.ADMIN,
        teacherAUserId,
        sectionA2Id,
        TENANT_A,
      );
      expect(section.id).toBe(sectionA2Id);
    });

    it('403s ADMIN attempting a section outside their tenant', async () => {
      await expect(
        service.assertCanAccessSection(UserRole.ADMIN, teacherAUserId, sectionB1Id, TENANT_A),
      ).rejects.toThrow(ForbiddenException);
    });

    it('403s a role with no attendance access at all (e.g. STUDENT)', async () => {
      await expect(
        service.assertCanAccessSection(UserRole.STUDENT, teacherAUserId, sectionA1Id, TENANT_A),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // [#1362] Per-role table: tenant-wide roles reach an unmapped section, others do not.
  describe('per-role access table', () => {
    const TENANT_WIDE: Array<[UserRole, boolean]> = [
      [UserRole.ADMIN, true],
      [UserRole.EXECUTIVE, true],
      [UserRole.ACCOUNTANT, true],
      // #1362 D-N: SUPER_ADMIN is out of tenant data scope until product decides.
      [UserRole.SUPER_ADMIN, false],
      // New in #1362 (read ROLE_SCOPE): the three new tenant-scoped roles.
      [UserRole.OFFICE_STAFF, true],
      [UserRole.EXAM_CONTROLLER, true],
      [UserRole.COMMITTEE, false], // tenant scope but no ATTENDANCE_READ (D9)
      [UserRole.PARENT, false],
      [UserRole.STUDENT, false],
    ];
    it.each(TENANT_WIDE)('%s: tenant-wide=%s', async (role, wide) => {
      const listed = (await service.listMarkableSections(role, teacherAUserId, TENANT_A)).map(
        (s) => s.id,
      );
      const call = service.assertCanAccessSection(role, teacherAUserId, sectionA2Id, TENANT_A);
      if (wide) {
        expect(listed).toContain(sectionA2Id);
        expect((await call).id).toBe(sectionA2Id);
      } else {
        expect(listed).toEqual([]);
        await expect(call).rejects.toThrow(ForbiddenException);
      }
    });

    it('TEACHER is section-scoped: sees only the mapped section', async () => {
      const listed = (
        await service.listMarkableSections(UserRole.TEACHER, teacherAUserId, TENANT_A)
      ).map((s) => s.id);
      expect(listed).toContain(sectionA1Id);
      expect(listed).not.toContain(sectionA2Id);
    });
  });

  // ---- #1588: period gate (D7, D23) ------------------------------------

  describe('assertCanAccessPeriod', () => {
    // A fixed past Wednesday inside the fixture year; the same weekday a week
    // later has the routine slot but no substitution.
    const DATE = '2026-03-04';
    const OTHER_DATE = '2026-03-11';
    let subTeacherUserId: string;
    let subTeacherId: string;

    async function setup() {
      const user = await dataSource.getRepository(User).save({
        email: `sub-${Date.now()}-${Math.random()}@test.com`,
        full_name: 'Substitute Teacher',
      });
      const teacher = await dataSource.getRepository(Teacher).save({
        user_id: user.id,
        employee_id: `SUB-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        tenant_id: TENANT_A,
        designations: [],
      });
      subTeacherUserId = user.id;
      subTeacherId = teacher.id;
      const routine = await seedPeriodRoutine(dataSource, {
        tenantId: TENANT_A,
        // The baseline year is the only one covering DATE (the test year above
        // is 2027); a second overlapping year would make the resolver's year
        // lookup ambiguous.
        academicYearId: SEED_ACADEMIC_YEAR_ID,
        sectionId: sectionA1Id,
        date: DATE,
        periods: 2,
        teacherId: teacherAId,
        createdBy: teacherAUserId,
      });
      await routine.substitute(0, subTeacherId); // covers period 1 on DATE only
    }

    const check = (userId: string, date: string, periodNo: number | null) =>
      service.assertCanAccessPeriod(
        UserRole.TEACHER,
        userId,
        sectionA1Id,
        TENANT_A,
        date,
        periodNo,
      );

    it('lets a teacher of the section into any period and the day register', async () => {
      await setup();
      await expect(check(teacherAUserId, DATE, 2)).resolves.toBeUndefined();
      await expect(check(teacherAUserId, DATE, null)).resolves.toBeUndefined();
    });

    it('404s an unrelated teacher who is not a substitute', async () => {
      await setup();
      await expect(check(teacherBUserId, DATE, 1)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("lets that date's substitute into the covered period only", async () => {
      await setup();
      await expect(check(subTeacherUserId, DATE, 1)).resolves.toBeUndefined();
      // Another period of the same date.
      await expect(check(subTeacherUserId, DATE, 2)).rejects.toBeInstanceOf(NotFoundException);
      // Another date.
      await expect(check(subTeacherUserId, OTHER_DATE, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // The whole-day register is never reachable by substitution.
      await expect(check(subTeacherUserId, DATE, null)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('listAccessiblePeriods shows a substitute only the period they cover', async () => {
      await setup();
      const mine = await service.listAccessiblePeriods(
        UserRole.TEACHER,
        subTeacherUserId,
        sectionA1Id,
        TENANT_A,
        DATE,
      );
      expect(mine.map((p) => p.period_no)).toEqual([1]);
      const all = await service.listAccessiblePeriods(
        UserRole.TEACHER,
        teacherAUserId,
        sectionA1Id,
        TENANT_A,
        DATE,
      );
      expect(all.map((p) => p.period_no)).toEqual([1, 2]);
    });
  });

  // Pins the fake STUDENT caller resolvePeriods hands the routine resolver: it
  // must only ever see PUBLISHED routines, never a DRAFT or REVIEW one.
  describe('resolvePeriods', () => {
    const DATE = '2026-03-04';
    const seed = (state: RoutineState) =>
      seedPeriodRoutine(dataSource, {
        tenantId: TENANT_A,
        academicYearId: SEED_ACADEMIC_YEAR_ID,
        sectionId: sectionA1Id,
        date: DATE,
        periods: 2,
        createdBy: teacherAUserId,
        state,
      });

    it.each([RoutineState.DRAFT, RoutineState.REVIEW])('a %s routine resolves to []', async (s) => {
      await seed(s);
      expect(await service.resolvePeriods(TENANT_A, sectionA1Id, DATE)).toEqual([]);
    });

    it('a PUBLISHED routine resolves to its slots', async () => {
      await seed(RoutineState.PUBLISHED);
      const periods = await service.resolvePeriods(TENANT_A, sectionA1Id, DATE);
      expect(periods.map((p) => p.period_no)).toEqual([1, 2]);
    });
  });

  // [76.2.1] D2 / D31 / D32: the whole-day write gate under each `dailySource`.
  describe('assertCanWriteDayRegister', () => {
    const DATE = '2026-03-04'; // a Wednesday inside the baseline year
    let assistantUserId: string;
    let subjectUserId: string; // teaches period 1 (the "first-period teacher")
    let subjectTeacherId: string;
    let lateSubjectUserId: string; // teaches period 2 only

    async function addTeacher(type: TeacherAssignmentType, subjectId: string | null) {
      const user = await dataSource.getRepository(User).save({
        email: `w-${Date.now()}-${Math.random()}@test.com`,
        full_name: 'Writer',
      });
      const teacher = await dataSource.getRepository(Teacher).save({
        user_id: user.id,
        employee_id: `W-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        tenant_id: TENANT_A,
        designations: [],
      });
      await dataSource.getRepository(TeacherClassSection).save({
        teacher_id: teacher.id,
        section_id: sectionA1Id,
        tenant_id: TENANT_A,
        assignment_type: type,
        subject_id: subjectId,
      });
      return { userId: user.id, teacherId: teacher.id };
    }

    async function setup(opts: { routine: boolean } = { routine: true }) {
      const assistant = await addTeacher(TeacherAssignmentType.ASSISTANT_CLASS_TEACHER, null);
      assistantUserId = assistant.userId;
      const routine = opts.routine
        ? await seedPeriodRoutine(dataSource, {
            tenantId: TENANT_A,
            academicYearId: SEED_ACADEMIC_YEAR_ID,
            sectionId: sectionA1Id,
            date: DATE,
            periods: 2,
            createdBy: teacherAUserId,
          })
        : null;
      const subjectId = routine ? routine.slots[0].subject.id : null;
      // Subject teacher rows need a live subject; with no routine, make one.
      const sid =
        subjectId ??
        (
          await dataSource.getRepository(Subject).save({
            tenant_id: TENANT_A,
            name_en: 'Gate subject',
            code: `G${Math.floor(Math.random() * 100000)}`,
          })
        ).id;
      const first = await addTeacher(TeacherAssignmentType.SUBJECT_TEACHER, sid);
      subjectUserId = first.userId;
      subjectTeacherId = first.teacherId;
      const late = await addTeacher(TeacherAssignmentType.SUBJECT_TEACHER, sid);
      lateSubjectUserId = late.userId;
      if (routine) {
        const slotRepo = dataSource.getRepository(RoutineSlotTeacher);
        await slotRepo.save({
          tenant_id: TENANT_A,
          routine_slot_id: routine.slots[0].routineSlot.id,
          teacher_id: first.teacherId,
        });
        await slotRepo.save({
          tenant_id: TENANT_A,
          routine_slot_id: routine.slots[1].routineSlot.id,
          teacher_id: late.teacherId,
        });
      }
      return routine;
    }

    async function setSource(source: string) {
      await dataSource.query(
        `UPDATE schools SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{attendance}', COALESCE(settings->'attendance','{}'::jsonb) || $2::jsonb) WHERE id = $1`,
        [TENANT_A, JSON.stringify({ dailySource: source })],
      );
    }
    afterEach(() => setSource('ANY'));

    /** 'PASS', or the refusal's `details.reason`; a 404 stays '404'. */
    async function outcome(
      role: UserRole,
      userId: string,
      opts: { monthGrid?: boolean } = {},
    ): Promise<string> {
      try {
        await service.assertCanWriteDayRegister(role, userId, sectionA1Id, DATE, TENANT_A, opts);
        return 'PASS';
      } catch (e) {
        if (e instanceof ForbiddenException) {
          return (e.getResponse() as { details: { reason: string } }).details.reason;
        }
        if (e instanceof NotFoundException) return '404';
        throw e;
      }
    }

    it('ANY: every section writer passes (unchanged behaviour)', async () => {
      await setup();
      await setSource('ANY');
      expect(await outcome(UserRole.TEACHER, teacherAUserId)).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, assistantUserId)).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, subjectUserId)).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, lateSubjectUserId)).toBe('PASS');
      expect(await outcome(UserRole.ADMIN, 'not-a-teacher')).toBe('PASS');
    });

    it('CLASS_TEACHER: class + assistant + ADMIN pass; subject teachers get CLASS_TEACHER_ONLY', async () => {
      await setup();
      await setSource('CLASS_TEACHER');
      expect(await outcome(UserRole.TEACHER, teacherAUserId)).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, assistantUserId)).toBe('PASS');
      expect(await outcome(UserRole.ADMIN, 'not-a-teacher')).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, subjectUserId)).toBe('CLASS_TEACHER_ONLY');
      expect(await outcome(UserRole.TEACHER, lateSubjectUserId)).toBe('CLASS_TEACHER_ONLY');
    });

    it('DEVICE: only class teachers and admins write, others get DEVICE_SCHOOL', async () => {
      await setup();
      await setSource('DEVICE');
      expect(await outcome(UserRole.TEACHER, teacherAUserId)).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, assistantUserId)).toBe('PASS');
      expect(await outcome(UserRole.ADMIN, 'not-a-teacher')).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, subjectUserId)).toBe('DEVICE_SCHOOL');
    });

    it('FIRST_PERIOD: the period-1 teacher passes, a period-2 teacher does not', async () => {
      await setup();
      await setSource('FIRST_PERIOD');
      expect(await outcome(UserRole.TEACHER, teacherAUserId)).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, assistantUserId)).toBe('PASS');
      expect(await outcome(UserRole.ADMIN, 'not-a-teacher')).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, subjectUserId)).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, lateSubjectUserId)).toBe('FIRST_PERIOD_ONLY');
    });

    it('FIRST_PERIOD: a substitution wins over the planned teacher', async () => {
      const routine = await setup();
      await setSource('FIRST_PERIOD');
      // The late teacher covers period 1 today; the planned teacher no longer does.
      const late = await dataSource
        .getRepository(Teacher)
        .findOneByOrFail({ user_id: lateSubjectUserId, tenant_id: TENANT_A });
      await routine!.substitute(0, late.id);
      expect(await outcome(UserRole.TEACHER, lateSubjectUserId)).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, subjectUserId)).toBe('FIRST_PERIOD_ONLY');
      expect(subjectTeacherId).toBeTruthy();
    });

    it('FIRST_PERIOD with no routine that day: class teacher passes, subject teacher is refused (D2)', async () => {
      await setup({ routine: false });
      await setSource('FIRST_PERIOD');
      expect(await outcome(UserRole.TEACHER, teacherAUserId)).toBe('PASS');
      expect(await outcome(UserRole.TEACHER, subjectUserId)).toBe('FIRST_PERIOD_ONLY');
    });

    it('month grid refuses the first-period teacher (D31) but not the class teacher', async () => {
      await setup();
      await setSource('FIRST_PERIOD');
      expect(await outcome(UserRole.TEACHER, subjectUserId, { monthGrid: true })).toBe(
        'CLASS_TEACHER_ONLY',
      );
      expect(await outcome(UserRole.TEACHER, teacherAUserId, { monthGrid: true })).toBe('PASS');
    });

    it('a teacher holding ATTENDANCE_CORRECT is still gated by assignment (D32)', async () => {
      await setup();
      await setSource('CLASS_TEACHER');
      // The gate reads the assignment, never the permission list.
      expect(roleHasPermission(UserRole.TEACHER, Permission.ATTENDANCE_CORRECT)).toBe(false);
      expect(await outcome(UserRole.TEACHER, subjectUserId)).toBe('CLASS_TEACHER_ONLY');
    });

    it("404s a tenant B teacher on tenant A's section and names nobody in a refusal", async () => {
      await setup();
      await setSource('CLASS_TEACHER');
      expect(await outcome(UserRole.TEACHER, teacherBUserId)).toBe('404');
      await expect(
        service.assertCanWriteDayRegister(
          UserRole.TEACHER,
          subjectUserId,
          sectionA1Id,
          DATE,
          TENANT_A,
        ),
      ).rejects.toMatchObject({
        response: {
          message: 'You cannot change this day register under the school attendance setting',
        },
      });
    });

    it('dayRegisterWriteState mirrors the assert without throwing', async () => {
      await setup();
      await setSource('FIRST_PERIOD');
      expect(
        await service.dayRegisterWriteState(
          UserRole.TEACHER,
          subjectUserId,
          sectionA1Id,
          DATE,
          TENANT_A,
        ),
      ).toEqual({ can_write: true, write_reason: null, first_period_today: true });
      expect(
        await service.dayRegisterWriteState(
          UserRole.TEACHER,
          lateSubjectUserId,
          sectionA1Id,
          DATE,
          TENANT_A,
        ),
      ).toEqual({ can_write: false, write_reason: 'FIRST_PERIOD_ONLY', first_period_today: false });
      // A teacher with no access to the section: no write, no reason, no throw.
      expect(
        await service.dayRegisterWriteState(
          UserRole.TEACHER,
          teacherBUserId,
          sectionA1Id,
          DATE,
          TENANT_A,
        ),
      ).toEqual({ can_write: false, write_reason: null, first_period_today: false });
    });
  });
});
