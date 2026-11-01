import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, AlertSeverity } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { addDaysIso } from '../rule-context.service';
import { roleRecipients } from '../structure/role-recipients';
import { coordinatorRecipients, coordinates } from '../structure/coordinator-recipients';
import { priorYearStartSql } from '../../../classes/teacher-scope.service';

// ponytail: constants until #1859 gives a real mark-entry deadline
export const MARKS_GRACE_DAYS = 7;
export const MARKS_CRITICAL_DAYS = 14;

export interface OutstandingGrid {
  examId: string;
  examName: string;
  /** [83.2.4] The exam's class: coordinators are matched on it. */
  classId: string;
  className: string;
  lastDate: string;
  sectionId: string;
  sectionLabel: string;
  subjectId: string;
}

/** Whole days from `fromIso` to `toIso` (both YYYY-MM-DD). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/**
 * Set-based form of `MarkGridService.progress`: every section of the exam's class x every
 * subject with a live component; no grid row reads as open. DRAFT exams of the current year or
 * the one right before it (the year flag flipping does not hide open work; the same window as
 * the homeroom grant, X-07) whose last sitting is on/before `lastSittingOnOrBefore`.
 */
export async function loadOutstandingGrids(
  ds: DataSource,
  tenantId: string,
  lastSittingOnOrBefore: string,
): Promise<OutstandingGrid[]> {
  return ds.query(
    `WITH ex AS (
       SELECT e.id, e.name, e.class_id, c.name AS class_name, MAX(es.date) AS last_date
       FROM exams e
       JOIN classes c ON c.id = e.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
       JOIN academic_years y ON y.id = e.academic_year_id AND y.tenant_id = $1 AND y.deleted_at IS NULL
         AND (y.is_current = true OR y.start_date = ${priorYearStartSql('$1')})
       JOIN exam_schedules es ON es.exam_id = e.id AND es.tenant_id = $1 AND es.deleted_at IS NULL
       WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND e.status = 'DRAFT'
       GROUP BY e.id, e.name, e.class_id, c.name
       HAVING MAX(es.date) <= $2)
     SELECT ex.id AS "examId", ex.name AS "examName", ex.class_id AS "classId", ex.class_name AS "className",
            to_char(ex.last_date, 'YYYY-MM-DD') AS "lastDate",
            cs.id AS "sectionId", ex.class_name || '-' || cs.section_name AS "sectionLabel", comp.subject_id AS "subjectId"
     FROM ex
     JOIN class_sections cs ON cs.class_id = ex.class_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
     JOIN (SELECT DISTINCT exam_id, subject_id FROM exam_components WHERE tenant_id = $1 AND deleted_at IS NULL) comp ON comp.exam_id = ex.id
     LEFT JOIN mark_grids mg ON mg.tenant_id = $1 AND mg.exam_id = ex.id AND mg.section_id = cs.id AND mg.subject_id = comp.subject_id
     WHERE mg.state IS DISTINCT FROM 'SUBMITTED'`,
    [tenantId, lastSittingOnOrBefore],
  );
}

@AttentionRule()
export class ExamsMarksOverdueRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('exams.marks_overdue');
  readonly messages = {
    en: {
      title: '{exam} ({className}): {outstanding} mark sheets still open',
      why: "The last sitting was {days} days ago. Results can't be processed until every sheet is submitted.",
      steps: [
        'Open the exam.',
        'See which section and subject are still open.',
        'Ask those teachers to submit their marks.',
      ],
      action: 'Open exam',
    },
    bn: {
      title: '{exam} ({className}): {outstanding}টি নম্বরপত্র এখনো জমা হয়নি',
      why: 'শেষ পরীক্ষা হয়েছে {days} দিন আগে। সব নম্বরপত্র জমা না হলে ফলাফল তৈরি করা যাবে না।',
      steps: [
        'পরীক্ষাটি খুলুন।',
        'কোন সেকশন ও বিষয় বাকি তা দেখুন।',
        'সেই শিক্ষকদের নম্বর জমা দিতে বলুন।',
      ],
      action: 'পরীক্ষা খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows = await loadOutstandingGrids(
      this.dataSource,
      ctx.tenantId,
      addDaysIso(ctx.localDate, -MARKS_GRACE_DAYS),
    );
    if (!rows.length) return [];
    const roles = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    // [83.2.4] D6: coordinators of the exam's class — class coordinators always, a subject
    // coordinator only when one of the exam's open grids is their subject.
    const coordinators = await coordinatorRecipients(this.dataSource, ctx.tenantId, [
      ...new Set(rows.map((r) => r.classId)),
    ]);
    if (!roles.length && !coordinators.length) return [];
    const byExam = new Map<string, OutstandingGrid[]>();
    for (const r of rows) byExam.set(r.examId, [...(byExam.get(r.examId) ?? []), r]);
    return [...byExam.entries()].map(([examId, grids]) => {
      const days = daysBetween(grids[0].lastDate, ctx.localDate);
      const critical = days >= MARKS_CRITICAL_DAYS;
      const recipients: { userId: string; role: (typeof roles)[number]['role'] }[] = [...roles];
      for (const c of coordinators) {
        const fits = grids.some((g) => coordinates(c, g.classId, g.subjectId));
        if (fits && !recipients.some((r) => r.userId === c.userId)) {
          recipients.push({ userId: c.userId, role: c.role });
        }
      }
      return {
        dedupeKey: `exam:${examId}`,
        subject: { type: 'exam', id: examId },
        params: {
          exam: grids[0].examName,
          className: grids[0].className,
          outstanding: grids.length,
          days,
        },
        actionUrl: `/exams/${examId}`,
        severity: critical ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
        escalationLevel: critical ? 1 : 0,
        recipients,
      };
    });
  }
}
