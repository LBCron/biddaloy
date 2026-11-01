import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Permission, UserRole, hasTenantDataScope, roleHasPermission } from '@biddaloy/shared';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import {
  teacherAssignments,
  teacherCoordinatedClassIds,
  teacherSectionIds,
} from '../classes/teacher-scope.service';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';

/** Tenant data scope + HOMEWORK_ASSIGN manages homework for every class/section
 * (and lists it — `HomeworkService.findAll` uses this too, so every listed row opens).
 * Pairing scope with the permission keeps COMMITTEE (no HOMEWORK_*, D9) out even if a
 * looser route reaches this service. SUPER_ADMIN: see `hasTenantDataScope` (#1362 D-N). */
const canManageTenantWide = (role: string) =>
  hasTenantDataScope(role) && roleHasPermission(role, Permission.HOMEWORK_ASSIGN);

/** Read-side counterpart for the analytics rollups: the permission those routes require. */
const canViewTenantWide = (role: string) =>
  hasTenantDataScope(role) && roleHasPermission(role, Permission.HOMEWORK_READ);

/**
 * The object-level "may this caller touch homework for this
 * class/section/subject?" gate — clones `AttendanceAccessService`'s shape
 * (`server/src/modules/attendance/attendance-access.service.ts`).
 *
 * `subject_id = null` means "class teacher" (D17): a class teacher may
 * manage homework for any subject taught in their section, a subject
 * teacher only for their own subject.
 */
@Injectable()
export class HomeworkAccessService {
  constructor(
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
  ) {}

  /** True for roles that manage homework tenant-wide without a
   * `teacher_class_sections` link (used by callers building their own query —
   * `HomeworkService.findAll`'s row-level scoping — and by bulk upload to skip
   * its per-row check). */
  canManageTenantWide(role: string): boolean {
    return canManageTenantWide(role);
  }

  /**
   * Throws when the caller may not manage homework for this `(section, subject)` pair,
   * otherwise resolves silently: 404 for a TEACHER miss (current-year assignments only, D13),
   * 403 for tenant-wide roles on an unknown section and for roles that cannot manage homework.
   */
  async assertCanManageSection(
    role: string,
    userId: string,
    sectionId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<void> {
    if (canManageTenantWide(role)) {
      const section = await this.sectionRepo.findOne({
        where: { id: sectionId, tenant_id: tenantId },
      });
      if (!section) {
        throw new ForbiddenException('You do not have access to this section');
      }
      return;
    }

    if (role === UserRole.TEACHER) {
      const rows = await teacherAssignments(this.tcsRepo.manager, { userId, tenantId });
      if (
        !rows.some(
          (r) =>
            r.section_id === sectionId && (r.subject_id === null || r.subject_id === subjectId),
        )
      ) {
        throw new NotFoundException('You do not have access to this section');
      }
      return;
    }

    throw new ForbiddenException('This role cannot manage homework');
  }

  /**
   * Class-level gate for `Homework` itself (no section yet — that's chosen
   * at assign time). A `TEACHER` needs at least one `TeacherClassSection`
   * row for this `class_id`/`subject_id` pair, in any section of that class.
   */
  async assertCanManageClass(
    role: string,
    userId: string,
    classId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<void> {
    if (canManageTenantWide(role)) {
      return;
    }

    if (role === UserRole.TEACHER) {
      const rows = await teacherAssignments(this.tcsRepo.manager, { userId, tenantId });
      if (
        !rows.some(
          (r) => r.class_id === classId && (r.subject_id === null || r.subject_id === subjectId),
        )
      ) {
        throw new NotFoundException('You do not have access to this class');
      }
      return;
    }

    throw new ForbiddenException('This role cannot manage homework');
  }

  /** An unknown student looks exactly like an out-of-scope one to a TEACHER (404, D13). */
  private studentMiss(role: string) {
    const msg = 'You do not have access to this student';
    return role === UserRole.TEACHER ? new NotFoundException(msg) : new ForbiddenException(msg);
  }

  /** Resolves a student's `section_id` so a single-student assignment can
   * reuse `assertCanManageSection` against the student's actual section. */
  async assertCanManageStudent(
    role: string,
    userId: string,
    studentId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<void> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId },
    });
    if (!student) throw this.studentMiss(role);
    await this.assertCanManageSection(role, userId, student.class_section_id, subjectId, tenantId);
  }

  /**
   * Read-only counterpart of `assertCanManageSection` for the analytics
   * rollups (D13) — subject-agnostic, since a section rollup aggregates
   * every subject's homework, not just one teacher's own subject. A
   * `TEACHER` may view a section's rollup if they hold *any*
   * `teacher_class_sections` row for it (class teacher or any subject
   * teacher), not just the one matching a specific `subjectId`.
   */
  async assertCanViewSection(
    role: string,
    userId: string,
    sectionId: string,
    tenantId: string,
  ): Promise<void> {
    if (canViewTenantWide(role)) {
      const section = await this.sectionRepo.findOne({
        where: { id: sectionId, tenant_id: tenantId },
      });
      if (!section) {
        throw new ForbiddenException('You do not have access to this section');
      }
      return;
    }

    if (role === UserRole.TEACHER) {
      const rows = await teacherAssignments(this.tcsRepo.manager, { userId, tenantId });
      // [83.3.1] D4 read: a coordinator of the section's class may view its rollup too.
      const coordinated =
        !rows.some((r) => r.section_id === sectionId) &&
        (
          await teacherSectionIds(this.tcsRepo.manager, {
            userId,
            tenantId,
            includeCoordinated: true,
          })
        ).includes(sectionId);
      if (!rows.some((r) => r.section_id === sectionId) && !coordinated) {
        throw new NotFoundException('You do not have access to this section');
      }
      return;
    }

    throw new ForbiddenException('This role cannot view homework analytics');
  }

  /** Read-only, subject-agnostic counterpart of `assertCanManageClass`. */
  async assertCanViewClass(
    role: string,
    userId: string,
    classId: string,
    tenantId: string,
  ): Promise<void> {
    if (canViewTenantWide(role)) {
      return;
    }

    if (role === UserRole.TEACHER) {
      const rows = await teacherAssignments(this.tcsRepo.manager, { userId, tenantId });
      if (
        !rows.some((r) => r.class_id === classId) &&
        // [83.3.1] D4 read: a coordinator of the class may view its rollup too.
        !(await teacherCoordinatedClassIds(this.tcsRepo.manager, { userId, tenantId })).includes(
          classId,
        )
      ) {
        throw new NotFoundException('You do not have access to this class');
      }
      return;
    }

    throw new ForbiddenException('This role cannot view homework analytics');
  }

  /** Resolves a student's section, then defers to `assertCanViewSection`. */
  async assertCanViewStudent(
    role: string,
    userId: string,
    studentId: string,
    tenantId: string,
  ): Promise<void> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId },
    });
    if (!student) throw this.studentMiss(role);
    await this.assertCanViewSection(role, userId, student.class_section_id, tenantId);
  }

  /** `Homework.create` takes class_id/subject_id straight from the DTO —
   * confirm both actually belong to this tenant before any teacher-scoping
   * check runs against them, since `assertCanManageClass` short-circuits
   * without a lookup for tenant-wide roles (`canManageTenantWide`) and would otherwise let an ADMIN
   * create homework pointing at another tenant's class/subject id. */
  async assertClassAndSubjectInTenant(
    classId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<void> {
    const [classOk, subjectOk] = await Promise.all([
      this.classRepo.exist({ where: { id: classId, tenant_id: tenantId, deleted_at: IsNull() } }),
      this.subjectRepo.exist({
        where: { id: subjectId, tenant_id: tenantId, deleted_at: IsNull() },
      }),
    ]);
    if (!classOk) {
      throw new ForbiddenException('You do not have access to this class');
    }
    if (!subjectOk) {
      throw new ForbiddenException('You do not have access to this subject');
    }
  }

  /** 400 when the assign target (a section, or a student's own section)
   * isn't actually in the given homework's class — the analytics rollups
   * key on `homework.class_id`, so a target from a different class would
   * silently corrupt them rather than fail loudly. */
  async assertTargetInClass(
    sectionId: string | null | undefined,
    studentId: string | null | undefined,
    classId: string,
    tenantId: string,
  ): Promise<void> {
    let targetSectionId = sectionId ?? null;
    if (!targetSectionId && studentId) {
      const student = await this.studentRepo.findOne({
        where: { id: studentId, tenant_id: tenantId },
      });
      targetSectionId = student?.class_section_id ?? null;
    }
    const inClass =
      !!targetSectionId &&
      (await this.sectionRepo.exist({
        where: { id: targetSectionId, class_id: classId, tenant_id: tenantId },
      }));
    if (!inClass) {
      throw new BadRequestException("The assignment target is not in this homework's class");
    }
  }
}
