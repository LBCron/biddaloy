import type { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';

/** One coordinator of one class: `subjectId` null = class coordinator, set = that subject only. */
export interface CoordinatorRecipient {
  userId: string;
  role: UserRole.TEACHER;
  classId: string;
  subjectId: string | null;
}

/**
 * [83.2.4] Coordinators of `classIds` (Epic 83 D6), one row per (user, class, subject):
 * active users with a live TEACHER membership of the tenant (they are sent as TEACHER), a live
 * teacher row, and a
 * `coordinator_assignments` row on a live class of the **current** academic year — the same
 * slice `TeacherScopeService` lets them read (D3/D14). A subject row whose subject is
 * soft-deleted is skipped, as in the scope SQL.
 *
 * Callers pick the rows that fit the finding with `coordinates()`: attendance takes class
 * coordinators only; marks-overdue also takes the subject coordinator of the grid's subject.
 * Recipients beyond roles are added by the rule, never by the alert writer (23-attention.md).
 */
export async function coordinatorRecipients(
  dataSource: DataSource,
  tenantId: string,
  classIds: string[],
): Promise<CoordinatorRecipient[]> {
  if (classIds.length === 0) return [];
  const rows: { userId: string; classId: string; subjectId: string | null }[] =
    await dataSource.query(
      `SELECT DISTINCT ON (t.user_id, ca.class_id, ca.subject_id)
              t.user_id AS "userId", ca.class_id AS "classId", ca.subject_id AS "subjectId"
         FROM coordinator_assignments ca
         JOIN teachers t ON t.id = ca.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
         JOIN users u ON u.id = t.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
         JOIN classes c ON c.id = ca.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
         JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.tenant_id = $1
           AND ay.is_current = true AND ay.deleted_at IS NULL
         LEFT JOIN subjects s ON s.id = ca.subject_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
        WHERE ca.tenant_id = $1 AND ca.class_id = ANY($2::uuid[])
          AND (ca.subject_id IS NULL OR s.id IS NOT NULL)
          AND EXISTS (SELECT 1 FROM user_tenants ut
                       WHERE ut.user_id = t.user_id AND ut.tenant_id = $1
                         AND ut.role = 'TEACHER' AND ut.deleted_at IS NULL)
        ORDER BY t.user_id, ca.class_id, ca.subject_id`,
      [tenantId, classIds],
    );
  return rows.map((r) => ({ ...r, role: UserRole.TEACHER }));
}

/**
 * True when `row` covers `classId` for `subjectId`. `subjectId` null asks "class coordinator?"
 * (subject rows never count); a subject asks "class coordinator, or coordinator of it?".
 */
export function coordinates(
  row: CoordinatorRecipient,
  classId: string,
  subjectId: string | null,
): boolean {
  if (row.classId !== classId) return false;
  return row.subjectId === null || (subjectId !== null && row.subjectId === subjectId);
}
