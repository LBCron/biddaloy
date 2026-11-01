import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  Permission,
  RoleScope,
  hasTenantDataScope,
  roleHasPermission,
  roleScope,
} from '@biddaloy/shared';
import { TeacherScopeService } from '../classes/teacher-scope.service';

/** Tenant scope + MARK_ENTER may write marks for every section-subject
 * without going through `teacher_class_sections`. EXAM_CONTROLLER has no
 * MARK_ENTER (D16), so it stays out. SUPER_ADMIN: see `hasTenantDataScope` (#1362 D-N). */
const canWriteTenantWide = (role: string) =>
  hasTenantDataScope(role) && roleHasPermission(role, Permission.MARK_ENTER);

/** Tenant scope + MARK_VIEW may *read* every section-subject's grid.
 * Wider than the write side: EXECUTIVE and EXAM_CONTROLLER hold MARK_VIEW
 * but never MARK_ENTER. COMMITTEE has no MARK_VIEW, so never reaches marks (D9).
 * SUPER_ADMIN is out of reads too, so the grid never looks editable and then 403s on save. */
const canReadTenantWide = (role: string) =>
  hasTenantDataScope(role) && roleHasPermission(role, Permission.MARK_VIEW);

/** D33/D13: a teacher miss is the same 404 as a missing section (`MarkGridService.findSection`);
 * any other role keeps the 403. */
const deny = (role: string) =>
  roleScope(role) === RoleScope.ASSIGNED_SECTIONS
    ? new NotFoundException('Section not found')
    : new ForbiddenException('You are not the assigned subject teacher for this section-subject.');

/**
 * The single "may this caller write marks for this section-subject?"
 * gate (19.4.1 D20), a sibling of `AttendanceAccessService`. The route's
 * `@RequirePermissions(MARK_ENTER)` (held by ADMIN and TEACHER) is only the
 * coarse gate; this is the real, object-level one. Both
 * `MarksService.upsertBatch` and `MarkGridService.submit` call this
 * directly rather than re-deriving the same join.
 *
 * For a non-tenant-scope caller the answer comes from `TeacherScopeService`,
 * which only counts **live** subjects (D16), and only in a section of the
 * current academic year, or of the year right before it while its class still
 * has a DRAFT exam (X-07, kept by Epic 75 D31; the same window as the
 * marks-overdue alerts):
 * - write: only a SUBJECT_TEACHER row for the exact subject. A class or
 *   assistant teacher never gets write through their homeroom.
 * - read: that same subject row, **or** a CLASS_TEACHER / ASSISTANT row for
 *   the section, which reads every subject's marks (D3).
 */
@Injectable()
export class MarksAuthorizationService {
  constructor(private readonly teacherScope: TeacherScopeService) {}

  async assertCanWrite(input: {
    role: string;
    userId: string;
    tenantId: string;
    sectionId: string;
    subjectId: string;
  }): Promise<void> {
    const { role, userId, tenantId, sectionId, subjectId } = input;
    if (canWriteTenantWide(role)) {
      return;
    }

    const { subjectIds, inYearWindow } = await this.teacherScope.rolesInSection({
      userId,
      tenantId,
      sectionId,
    });
    if (!subjectIds.includes(subjectId) || !inYearWindow) {
      throw deny(role);
    }
  }

  /** D33/D44: per section of `sectionIds`, the subjects a teacher may *write* (same rule as
   * `assertCanWrite`), i.e. the grids they can open and save. Homeroom read is left out on
   * purpose: a class teacher offered a grid they can't save would 404 on every autosave.
   * `null` = no filter: every role that is not section-scoped. */
  async writableSubjects(
    input: { role: string; userId: string; tenantId: string },
    sectionIds: string[],
  ): Promise<Map<string, Set<string>> | null> {
    if (roleScope(input.role) !== RoleScope.ASSIGNED_SECTIONS) return null;
    const { userId, tenantId } = input;
    // ponytail: one rolesInSection per section of the class (a handful); batch it if classes grow.
    const roles = await Promise.all(
      sectionIds.map((sectionId) =>
        this.teacherScope.rolesInSection({ userId, tenantId, sectionId }),
      ),
    );
    return new Map(
      sectionIds.map((id, i) => [id, new Set(roles[i].inYearWindow ? roles[i].subjectIds : [])]),
    );
  }

  /** [pr-fix #945] `MarksController.getGrid` had no object-level check at
   * all — any MARK_VIEW holder (which TEACHER has, tenant-wide) could
   * read any section's marks by supplying an arbitrary section_id.
   * Tenant-wide readers (EXECUTIVE included) bypass it. */
  async assertCanRead(input: {
    role: string;
    userId: string;
    tenantId: string;
    sectionId: string;
    subjectId: string;
  }): Promise<void> {
    const { role, userId, tenantId, sectionId, subjectId } = input;
    if (canReadTenantWide(role)) {
      return;
    }

    const { homeroom, subjectIds, inYearWindow, coordinated } =
      await this.teacherScope.rolesInSection({
        userId,
        tenantId,
        sectionId,
      });
    // [83.3.1] D4/D19 — read only: a class coordinator reads every subject of the section, a
    // subject coordinator only theirs. Coordinator rows are current-year by construction.
    // `assertCanWrite` / `writableSubjects` never look at `coordinated`.
    if (coordinated.allSubjects || coordinated.subjectIds.includes(subjectId)) return;
    if ((!homeroom && !subjectIds.includes(subjectId)) || !inYearWindow) {
      throw deny(role);
    }
  }
}
