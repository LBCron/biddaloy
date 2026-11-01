import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { RoleScope, UserRole, isGuardianRole, roleScope } from '@biddaloy/shared';
import { Student } from './entities/student.entity';
import { teacherCanSeeStudent } from '../classes/teacher-scope.service';

/**
 * The single home of SchoolManager's object-level "is this family caller allowed
 * to see this student?" check [5.1].
 *
 * Role alone is never enough for a PARENT or STUDENT. `@Roles(PARENT, STUDENT)`
 * on a route only says "a family caller may attempt this"; *which* student's
 * data comes back is decided here, by the linkage rows:
 *
 * ```
 * PARENT   → students.guardians[].user_id === caller  (via student_guardians)
 * STUDENT  → students.user_id            === caller
 * ```
 *
 * Every query below is explicitly scoped to `tenant_id` and skips
 * soft-deleted students, per `.claude/skills/multi-tenancy/SKILL.md` — there
 * is no ambient tenant filter in this codebase. A parent who is genuinely
 * linked to a student in tenant B, but calls with `X-Tenant-ID: A`, matches
 * nothing here: the linkage lookup is scoped to A.
 *
 * Tenant-scope staff roles pass straight through (`assertLinked` is a no-op) —
 * their access is already decided by the route's `@Roles` list plus the service
 * layer's own tenant scoping. A TEACHER (assigned-sections scope) is limited to
 * students in their current-year sections, and an unknown role sees nothing;
 * both get 404 (Epic 75 D2/D13).
 *
 * Do not re-implement this check in a controller. Before [5.1] it lived
 * inline in `students.controller.ts`; every widened family route now calls
 * this service instead so there is exactly one definition of "linked".
 */
@Injectable()
export class FamilyAccessService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  /**
   * Base query for "students this family caller is linked to", already
   * tenant-scoped and soft-delete filtered.
   *
   * Returns `null` for a non-family role — callers treat that as "this role
   * has no linkage concept", not as "no students".
   */
  private linkedStudentsQuery(
    role: string,
    userId: string,
    tenantId: string,
  ): SelectQueryBuilder<Student> | null {
    if (!isGuardianRole(role)) {
      return null;
    }

    const qb = this.studentRepo
      .createQueryBuilder('student')
      .where('student.tenant_id = :tenantId', { tenantId })
      .andWhere('student.deleted_at IS NULL');

    if (role === UserRole.PARENT) {
      // INNER JOIN, so a parent with no linkage rows matches nothing rather
      // than matching every student in the tenant.
      qb.innerJoin('student.guardians', 'guardian').andWhere('guardian.user_id = :userId', {
        userId,
      });
    } else {
      qb.andWhere('student.user_id = :userId', { userId });
    }

    return qb;
  }

  /**
   * The students a PARENT/STUDENT caller may see, for `GET /students/mine`.
   *
   * Deliberately minimal relations — class/section for display, and *not*
   * `guardians`: the guardian rows carry every co-guardian's phone and email,
   * which the discovery list has no need for. `GET /students/:id` remains the
   * place that returns the fuller record.
   *
   * A non-family role gets an empty list. `GET /students/mine` is
   * `@Roles(PARENT, STUDENT)` so this is unreachable in practice, but it
   * fails closed rather than leaking the roster if the route is ever widened.
   */
  async getLinkedStudents(role: string, userId: string, tenantId: string): Promise<Student[]> {
    const qb = this.linkedStudentsQuery(role, userId, tenantId);
    if (!qb) return [];

    return qb
      .leftJoinAndSelect('student.class_section', 'class_section')
      .leftJoinAndSelect('class_section.class', 'class')
      .orderBy('student.full_name', 'ASC')
      .addOrderBy('student.id', 'ASC')
      .getMany();
  }

  /**
   * ID-only variant, for routes that restrict a list query to the caller's
   * students (`GET /invoices`, `GET /fees/dues`) rather than fetching them.
   */
  async getLinkedStudentIds(role: string, userId: string, tenantId: string): Promise<string[]> {
    const qb = this.linkedStudentsQuery(role, userId, tenantId);
    if (!qb) return [];

    // DISTINCT because the PARENT join can match the same student through
    // more than one guardian row (e.g. the caller is recorded twice with
    // different relationships).
    const rows = await qb.select('DISTINCT student.id', 'id').getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  /**
   * Throws unless the caller may read this specific student.
   *
   * No-op for staff roles except TEACHER (404 outside their current-year sections). For PARENT/STUDENT it throws
   * `UnauthorizedException` with the exact message the inline check in
   * `students.controller.ts` threw before [5.1] — the contract that route
   * already had is unchanged, including the (unconventional but deliberate)
   * 401-rather-than-403 status.
   */
  async assertLinked(
    role: string,
    userId: string,
    studentId: string,
    tenantId: string,
    /** [83.3.1] D18 — read call sites only (`GET /students/:id`). Fees, payments, invoices and
     * communications callers never pass it (D5). */
    opts: { includeCoordinated?: boolean } = {},
  ): Promise<void> {
    const qb = this.linkedStudentsQuery(role, userId, tenantId);
    if (!qb) {
      // Epic 75 D2/D13: a TEACHER sees only students in their current-year sections; a miss is 404.
      const scope = roleScope(role);
      if (scope === RoleScope.TENANT) return;
      if (
        scope !== RoleScope.ASSIGNED_SECTIONS ||
        !(await teacherCanSeeStudent(this.studentRepo.manager, {
          userId,
          tenantId,
          studentId,
          includeCoordinated: opts.includeCoordinated,
        }))
      ) {
        throw new NotFoundException('Student not found');
      }
      return;
    }

    const count = await qb.andWhere('student.id = :studentId', { studentId }).getCount();
    if (count === 0) {
      throw new UnauthorizedException("You do not have access to this student's information");
    }
  }

  /**
   * Multi-student variant of `assertLinked`, for a document that can cover
   * more than one student in one shot — a [16.5.1] sibling/multi-student
   * checkout invoice being the motivating case. Throws unless the caller is
   * linked to *at least one* of `studentIds` (siblings grouped onto one
   * invoice is the point of that grouping — a guardian linked to any covered
   * child should see it), then returns the *subset* the caller is actually
   * linked to so the response can be filtered down to just those students'
   * data rather than handing back an unlinked sibling's name/registration
   * number/fee lines alongside it.
   *
   * No-op (returns all ids unfiltered) for staff roles, matching
   * `assertLinked`.
   */
  async assertLinkedToAny(
    role: string,
    userId: string,
    studentIds: string[],
    tenantId: string,
  ): Promise<string[]> {
    const qb = this.linkedStudentsQuery(role, userId, tenantId);
    if (!qb) return studentIds;

    const ids = [...new Set(studentIds)];
    if (ids.length === 0) {
      throw new UnauthorizedException("You do not have access to this student's information");
    }

    const rows = await qb
      .andWhere('student.id IN (:...ids)', { ids })
      .select('DISTINCT student.id', 'id')
      .getRawMany<{ id: string }>();
    const linkedIds = rows.map((r) => r.id);
    if (linkedIds.length === 0) {
      throw new UnauthorizedException("You do not have access to this student's information");
    }
    return linkedIds;
  }

  /**
   * Recipients for background jobs (Epic 67). Same definition of linked as
   * `linkedStudentsQuery`; never widen it. Set-based: one query for any
   * number of students, tenant-scoped, soft-deletes and inactive users out.
   */
  async familyUsersForStudents(
    tenantId: string,
    studentIds: string[],
  ): Promise<{ studentId: string; userId: string; role: UserRole.PARENT | UserRole.STUDENT }[]> {
    if (studentIds.length === 0) return [];
    return this.studentRepo.query(
      `SELECT sg.student_id AS "studentId", g.user_id AS "userId", 'PARENT' AS role
       FROM student_guardians sg
       JOIN students s ON s.id = sg.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
       JOIN guardians g ON g.id = sg.guardian_id AND g.tenant_id = $1 AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       JOIN users u ON u.id = g.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       JOIN user_tenants ut ON ut.user_id = g.user_id AND ut.tenant_id = $1 AND ut.role = 'PARENT' AND ut.deleted_at IS NULL
       WHERE sg.student_id = ANY($2::uuid[])
       UNION
       SELECT s.id, s.user_id, 'STUDENT'
       FROM students s
       JOIN users u ON u.id = s.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       JOIN user_tenants ut ON ut.user_id = s.user_id AND ut.tenant_id = $1 AND ut.role = 'STUDENT' AND ut.deleted_at IS NULL
       WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.id = ANY($2::uuid[])`,
      [tenantId, studentIds],
    );
  }
}
