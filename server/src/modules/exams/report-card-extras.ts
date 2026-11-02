import { IsNull, type EntityManager } from 'typeorm';
import {
  DEFAULT_CONDUCT_ITEMS,
  type ConductGrade,
  type FinalResultStudentCard,
} from '@biddaloy/shared';
import { ReportCardNote } from '../report-card-notes/entities/report-card-note.entity';
import { resolveTenantSettings } from '../schools/settings/tenant-settings-resolver';
import type { AttendanceSummary } from '../attendance/attendance-summary.service';

export type CardConduct = FinalResultStudentCard['conduct'];
export type CardAttendance = { working_days: number; present_days: number };

/**
 * Remark + conduct of one student on one exam or final result [70.4.1, D16]. Read straight from
 * `report_card_notes` (tenant-scoped); the item list is the school's `exams.conductItems`.
 * No note row at all -> `remark: null` and `conduct: []`, so a card without notes hides the block.
 */
export async function loadCardNotes(
  manager: EntityManager,
  tenantId: string,
  studentId: string,
  target: { exam_id: string } | { final_result_id: string },
  schoolSettings: Record<string, unknown> | null,
): Promise<{ remark: string | null; conduct: CardConduct }> {
  const note = await manager.findOne(ReportCardNote, {
    where: {
      tenant_id: tenantId,
      student_id: studentId,
      ...('exam_id' in target
        ? { exam_id: target.exam_id, final_result_id: IsNull() }
        : { final_result_id: target.final_result_id, exam_id: IsNull() }),
    },
  });
  if (!note) return { remark: null, conduct: [] };
  const items = resolveTenantSettings(schoolSettings).exams?.conductItems ?? DEFAULT_CONDUCT_ITEMS;
  return {
    remark: note.remark,
    conduct: items.map((i) => ({
      key: i.key,
      name_bn: i.name_bn,
      name_en: i.name_en,
      grade: (note.conduct?.[i.key] as ConductGrade | undefined) ?? null,
    })),
  };
}

/**
 * The "present / days" pair a report card prints, for both the per-exam card and the final
 * publish snapshot (D27). It is the same fraction `computeAttendancePercentage` divides, so
 * present/days * 100 equals the summary's `attendance_percentage`:
 *
 * - days = marked days under the school's MARKED_DAYS policy, else working days; minus leave
 *   days when leave does not count as a working day.
 * - present = present days, plus late days when late counts as present.
 *
 * Example: 100 working, 90 marked, 80 present, MARKED_DAYS -> 80 / 90 (88.89%), not 80 / 100.
 * Nothing to divide by (days <= 0) -> null, as the summary's percentage is null.
 */
export function attendanceFrom(s: AttendanceSummary | undefined): CardAttendance | null {
  if (!s) return null;
  let days = s.policy.denominator === 'MARKED_DAYS' ? s.marked_days : s.working_days;
  if (!s.policy.leave_counts_as_working_day) days -= s.leave_days;
  if (days <= 0) return null;
  const present = s.present_days + (s.policy.late_counts_as_present ? s.late_days : 0);
  return { working_days: days, present_days: Math.min(days, present) };
}
