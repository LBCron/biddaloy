import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';
import { HomeworkAccessService } from './homework-access.service';
import {
  teacherAssignments,
  teacherCoordinatedClassIds,
  teacherSectionIds,
} from '../classes/teacher-scope.service';

// The current-year scope query is covered by teacher-scope.service.integration.spec.ts;
// here it is just the rows the gate reasons over.
// [83.3.1] The coordinator lookups default to "no coordinator rows" (today's answer).
vi.mock('../classes/teacher-scope.service', () => ({
  teacherAssignments: vi.fn(),
  teacherSectionIds: vi.fn(async () => []),
  teacherCoordinatedClassIds: vi.fn(async () => []),
}));

/**
 * Unit tests for `HomeworkAccessService` with mocked repositories — the
 * "may this caller manage homework for this section/student?" gate cloned
 * from `AttendanceAccessService`.
 */
describe('HomeworkAccessService', () => {
  const TENANT_ID = 'tenant-1';
  const SECTION_ID = 'section-1';
  const SUBJECT_ID = 'subject-1';
  const USER_ID = 'user-1';

  let sectionRepo: { findOne: ReturnType<typeof vi.fn>; exist: ReturnType<typeof vi.fn> };
  let studentRepo: { findOne: ReturnType<typeof vi.fn> };
  let classRepo: { exist: ReturnType<typeof vi.fn> };
  let subjectRepo: { exist: ReturnType<typeof vi.fn> };
  let tcsRepo: { manager: object };
  let service: HomeworkAccessService;

  type Row = {
    userId: string;
    section_id: string;
    class_id: string;
    subject_id: string | null;
  };
  /** The (current-year) assignment rows, filtered by the caller's userId like the real query. */
  let rows: Row[];
  const CLASS_ID = 'class-1';
  const homeroom = (userId = USER_ID): Row => ({
    userId,
    section_id: SECTION_ID,
    class_id: CLASS_ID,
    subject_id: null,
  });
  const subjectRow = (subjectId: string, userId = USER_ID): Row => ({
    userId,
    section_id: SECTION_ID,
    class_id: CLASS_ID,
    subject_id: subjectId,
  });

  beforeEach(() => {
    sectionRepo = { findOne: vi.fn(), exist: vi.fn() };
    studentRepo = { findOne: vi.fn() };
    classRepo = { exist: vi.fn() };
    subjectRepo = { exist: vi.fn() };
    rows = [];
    vi.mocked(teacherAssignments).mockImplementation((async (
      _m: unknown,
      { userId }: { userId: string },
    ) => rows.filter((r) => r.userId === userId)) as never);
    tcsRepo = { manager: {} };

    service = new HomeworkAccessService(
      tcsRepo as never,
      sectionRepo as never,
      studentRepo as never,
      classRepo as never,
      subjectRepo as never,
    );
  });

  describe('assertCanManageSection', () => {
    it('allows ADMIN for any section in the tenant', async () => {
      sectionRepo.findOne.mockResolvedValue({ id: SECTION_ID, tenant_id: TENANT_ID });
      await expect(
        service.assertCanManageSection(UserRole.ADMIN, USER_ID, SECTION_ID, SUBJECT_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws for ADMIN when the section does not exist in this tenant', async () => {
      sectionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertCanManageSection(UserRole.ADMIN, USER_ID, SECTION_ID, SUBJECT_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a TEACHER mapped to the section (class teacher, subject_id null)', async () => {
      rows = [homeroom()];
      await expect(
        service.assertCanManageSection(
          UserRole.TEACHER,
          USER_ID,
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).resolves.toBeUndefined();
    });

    it('404s a TEACHER not mapped to the section (no current-year rows)', async () => {
      rows = [];
      await expect(
        service.assertCanManageSection(
          UserRole.TEACHER,
          'unrelated-teacher',
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // Substitute-teacher access (D17): a second `TeacherClassSection` row for
    // the same section grants a *different* teacher access too. Two rows are
    // seeded here (not one canned `getOne` result), and each teacher's own
    // (userId, sectionId, subjectId) params are asserted to resolve
    // independently — a real substitution, not a single mock echoing back.
    it('allows a substitute teacher via a second TeacherClassSection row for the same section', async () => {
      rows = [homeroom('original-teacher'), homeroom('substitute-teacher')];

      await expect(
        service.assertCanManageSection(
          UserRole.TEACHER,
          'original-teacher',
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).resolves.toBeUndefined();

      await expect(
        service.assertCanManageSection(
          UserRole.TEACHER,
          'substitute-teacher',
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).resolves.toBeUndefined();

      // A third teacher with no row for this section is still denied, even
      // though two other rows exist for it.
      await expect(
        service.assertCanManageSection(
          UserRole.TEACHER,
          'unrelated-teacher',
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a subject row manages only its own subject; a homeroom row manages any', async () => {
      rows = [subjectRow(SUBJECT_ID)];
      const manage = (subjectId: string) =>
        service.assertCanManageSection(UserRole.TEACHER, USER_ID, SECTION_ID, subjectId, TENANT_ID);
      await expect(manage(SUBJECT_ID)).resolves.toBeUndefined();
      await expect(manage('other-subject')).rejects.toBeInstanceOf(NotFoundException);
      rows = [homeroom()];
      await expect(manage('other-subject')).resolves.toBeUndefined();
    });

    it('denies a role that is neither tenant-wide nor TEACHER', async () => {
      await expect(
        service.assertCanManageSection(
          UserRole.STUDENT,
          USER_ID,
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertCanManageStudent', () => {
    it('resolves the student section and delegates to assertCanManageSection', async () => {
      studentRepo.findOne.mockResolvedValue({
        id: 'student-1',
        class_section_id: SECTION_ID,
        tenant_id: TENANT_ID,
      });
      rows = [homeroom()];
      await expect(
        service.assertCanManageStudent(
          UserRole.TEACHER,
          USER_ID,
          'student-1',
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).resolves.toBeUndefined();
    });

    it('404s a TEACHER (403s others) when the student does not exist in this tenant', async () => {
      studentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertCanManageStudent(
          UserRole.TEACHER,
          USER_ID,
          'student-1',
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.assertCanManageStudent(UserRole.ADMIN, USER_ID, 'student-1', SUBJECT_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // Analytics rollups (D13) are subject-agnostic — a TEACHER may view a
  // section/class rollup off *any* teacher_class_sections row for it, not
  // just one matching a specific subject. Regression coverage for the
  // security gap found during wave-4 integration: the analytics routes
  // originally had no object-level scoping at all, so any TEACHER in the
  // tenant could read any other section's/class's rollup.
  describe('assertCanViewSection', () => {
    it('allows ADMIN for any section in the tenant', async () => {
      sectionRepo.findOne.mockResolvedValue({ id: SECTION_ID, tenant_id: TENANT_ID });
      await expect(
        service.assertCanViewSection(UserRole.ADMIN, USER_ID, SECTION_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws for ADMIN when the section does not exist in this tenant', async () => {
      sectionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertCanViewSection(UserRole.ADMIN, USER_ID, SECTION_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a TEACHER with any teacher_class_sections row for the section, subject-agnostic', async () => {
      rows = [homeroom()];
      await expect(
        service.assertCanViewSection(UserRole.TEACHER, USER_ID, SECTION_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('denies a TEACHER with no teacher_class_sections row for the section', async () => {
      rows = [];
      await expect(
        service.assertCanViewSection(UserRole.TEACHER, 'unrelated-teacher', SECTION_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // [83.3.1] D4 read: a coordinator of the section's class views the rollup.
    it('lets a coordinator of the section view it, and of the class view the class', async () => {
      rows = [];
      vi.mocked(teacherSectionIds).mockResolvedValueOnce([SECTION_ID]);
      await expect(
        service.assertCanViewSection(UserRole.TEACHER, USER_ID, SECTION_ID, TENANT_ID),
      ).resolves.toBeUndefined();
      vi.mocked(teacherCoordinatedClassIds).mockResolvedValueOnce([CLASS_ID]);
      await expect(
        service.assertCanViewClass(UserRole.TEACHER, USER_ID, CLASS_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('lets a subject-row TEACHER view the section', async () => {
      rows = [subjectRow(SUBJECT_ID)];
      await expect(
        service.assertCanViewSection(UserRole.TEACHER, USER_ID, SECTION_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('denies any other role', async () => {
      await expect(
        service.assertCanViewSection(UserRole.PARENT, USER_ID, SECTION_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertCanManageClass', () => {
    const manage = (subjectId: string) =>
      service.assertCanManageClass(UserRole.TEACHER, USER_ID, CLASS_ID, subjectId, TENANT_ID);

    it('homeroom row manages any subject; subject row only its own', async () => {
      rows = [homeroom()];
      await expect(manage('any')).resolves.toBeUndefined();
      rows = [subjectRow(SUBJECT_ID)];
      await expect(manage(SUBJECT_ID)).resolves.toBeUndefined();
      await expect(manage('other-subject')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s a TEACHER with no row in the class', async () => {
      rows = [];
      await expect(manage(SUBJECT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('denies STUDENT with 403', async () => {
      await expect(
        service.assertCanManageClass(UserRole.STUDENT, USER_ID, CLASS_ID, SUBJECT_ID, TENANT_ID),
      ).rejects.toThrow('This role cannot manage homework');
    });
  });

  describe('assertCanViewClass', () => {
    it('allows ADMIN unconditionally', async () => {
      await expect(
        service.assertCanViewClass(UserRole.ADMIN, USER_ID, 'class-1', TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('allows a TEACHER with any teacher_class_sections row in a section of the class', async () => {
      rows = [homeroom()];
      await expect(
        service.assertCanViewClass(UserRole.TEACHER, USER_ID, CLASS_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('denies a TEACHER with no section in the class', async () => {
      rows = [];
      await expect(
        service.assertCanViewClass(UserRole.TEACHER, 'unrelated-teacher', 'class-1', TENANT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertCanViewStudent', () => {
    it('resolves the student section and delegates to assertCanViewSection', async () => {
      studentRepo.findOne.mockResolvedValue({
        id: 'student-1',
        class_section_id: SECTION_ID,
        tenant_id: TENANT_ID,
      });
      rows = [homeroom()];
      await expect(
        service.assertCanViewStudent(UserRole.TEACHER, USER_ID, 'student-1', TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws when the student does not exist in this tenant', async () => {
      studentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertCanViewStudent(UserRole.TEACHER, USER_ID, 'student-1', TENANT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.assertCanViewStudent(UserRole.ADMIN, USER_ID, 'student-1', TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertClassAndSubjectInTenant', () => {
    it('resolves when both class and subject belong to this tenant', async () => {
      classRepo.exist.mockResolvedValue(true);
      subjectRepo.exist.mockResolvedValue(true);
      await expect(
        service.assertClassAndSubjectInTenant('class-1', SUBJECT_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws when the class does not belong to this tenant', async () => {
      classRepo.exist.mockResolvedValue(false);
      subjectRepo.exist.mockResolvedValue(true);
      await expect(
        service.assertClassAndSubjectInTenant('class-1', SUBJECT_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws when the subject does not belong to this tenant', async () => {
      classRepo.exist.mockResolvedValue(true);
      subjectRepo.exist.mockResolvedValue(false);
      await expect(
        service.assertClassAndSubjectInTenant('class-1', SUBJECT_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertTargetInClass', () => {
    it('resolves when the section belongs to the homework class', async () => {
      sectionRepo.exist.mockResolvedValue(true);
      await expect(
        service.assertTargetInClass(SECTION_ID, null, 'class-1', TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws when the section belongs to another class', async () => {
      sectionRepo.exist.mockResolvedValue(false);
      await expect(
        service.assertTargetInClass(SECTION_ID, null, 'class-1', TENANT_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resolves a student target via the student own section', async () => {
      studentRepo.findOne.mockResolvedValue({ id: 'student-1', class_section_id: SECTION_ID });
      sectionRepo.exist.mockResolvedValue(true);
      await expect(
        service.assertTargetInClass(null, 'student-1', 'class-1', TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws when neither section nor student resolves to a section', async () => {
      studentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertTargetInClass(null, 'student-1', 'class-1', TENANT_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // [#1362] Per-role table: tenant data scope + the homework permission manages/views an
  // unmapped section; others are denied. Only ADMIN holds HOMEWORK_* among tenant-scoped
  // roles; EXECUTIVE/ACCOUNTANT/the new roles never pass a homework route's permission gate
  // anyway, so the service now agrees with the routes instead of granting them.
  describe('per-role access table', () => {
    // [role, manage, view]
    const TABLE: Array<[UserRole, boolean, boolean]> = [
      [UserRole.ADMIN, true, true],
      [UserRole.EXECUTIVE, false, false],
      [UserRole.ACCOUNTANT, false, false],
      // #1362 D-N: SUPER_ADMIN is out of tenant data scope until product decides.
      [UserRole.SUPER_ADMIN, false, false],
      [UserRole.OFFICE_STAFF, false, false],
      [UserRole.EXAM_CONTROLLER, false, false],
      [UserRole.COMMITTEE, false, false], // no HOMEWORK_* (D9)
      [UserRole.TEACHER, false, false], // section-scoped: 404 when unmapped
      [UserRole.PARENT, false, false],
      [UserRole.STUDENT, false, false],
    ];
    it.each(TABLE)('%s: manage=%s view=%s', async (role, canManage, wide) => {
      sectionRepo.findOne.mockResolvedValue({ id: SECTION_ID, tenant_id: TENANT_ID });
      rows = [];
      expect(service.canManageTenantWide(role)).toBe(canManage);
      const manage = service.assertCanManageSection(
        role,
        USER_ID,
        SECTION_ID,
        SUBJECT_ID,
        TENANT_ID,
      );
      const view = service.assertCanViewSection(role, USER_ID, SECTION_ID, TENANT_ID);
      const denied = role === UserRole.TEACHER ? NotFoundException : ForbiddenException;
      if (canManage) await expect(manage).resolves.toBeUndefined();
      else await expect(manage).rejects.toBeInstanceOf(denied);
      if (wide) await expect(view).resolves.toBeUndefined();
      else await expect(view).rejects.toBeInstanceOf(denied);
    });
  });
});
