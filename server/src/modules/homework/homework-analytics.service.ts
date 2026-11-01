import { Injectable } from '@nestjs/common';
import { StudyPlanDashboardService } from '../study-plans/study-plan-dashboard.service';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  HomeworkSubmissionStatus,
  SyllabusTopicStatus,
  TeacherAssignmentType,
} from '@biddaloy/shared';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { addDays, localToday } from '../attendance/attendance-policy.util';
import { teacherAssignments } from '../classes/teacher-scope.service';
import { HomeworkSubmissionRateDto, MySyllabusProgressDto } from './dto/homework-dashboard.dto';

/**
 * A "complete" submission — anything past NOT_SUBMITTED (D13). A defaulter
 * is a submission still NOT_SUBMITTED whose assignment's `due_date` has
 * passed, mirroring `HomeworkDefaulterScheduler`'s own definition.
 */
const COMPLETE_STATUSES: readonly HomeworkSubmissionStatus[] = [
  HomeworkSubmissionStatus.SUBMITTED,
  HomeworkSubmissionStatus.PARTIAL,
  HomeworkSubmissionStatus.DONE,
];

export interface CompletionRollup {
  totalAssignments: number;
  completed: number;
  defaulters: number;
  completionPercent: number;
}

export interface SyllabusRollup {
  totalTopics: number;
  done: number;
  completionPercent: number;
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  // Floor, not round — a completion rate should never read as higher than
  // reality (2/3 done reads as 66%, not a rounded-up 67%).
  return Math.floor((numerator / denominator) * 100);
}

/**
 * [22.3.6] Read-only rollups over homework completion/defaulters (D13) and
 * class-level syllabus completion (D29). No mutation, no tenant-write path —
 * every query is scoped by `tenant_id` on the submission/assignment rows
 * themselves, the same isolation boundary every other service in this
 * module uses.
 */
@Injectable()
export class HomeworkAnalyticsService {
  constructor(
    @InjectRepository(HomeworkAssignment)
    private readonly assignmentRepo: Repository<HomeworkAssignment>,
    @InjectRepository(HomeworkSubmission)
    private readonly submissionRepo: Repository<HomeworkSubmission>,
    @InjectRepository(SyllabusTopic)
    private readonly syllabusRepo: Repository<SyllabusTopic>,
    private readonly planDashboard: StudyPlanDashboardService,
  ) {}

  /**
   * Per assignment: how many students are on it (`total`) and how many of them are complete
   * (`completed`, COMPLETE_STATUSES). A completion rate counts the roster, not the submission
   * rows (#3171): rows appear only once a student uploads or a teacher grades, so counting them
   * made the rate move as teachers graded. Every existing row counts; on top of that an ACTIVE
   * assignment adds a NOT_SUBMITTED entry for each live ACTIVE student of its section / its one
   * student who has no row yet (the D5 roster of `HomeworkSubmissionService.roster`; a
   * DEACTIVATED assignment is withdrawn, so it adds nobody). Counted in SQL, so only one row per
   * assignment reaches Node. `studentId` narrows to one student. `dueBy` pads only homework due
   * on or before that day: work not yet due counts its early rows but nobody missing yet.
   */
  private async rosterCounts(
    tenantId: string,
    filter: { assignmentIds?: string[]; studentId?: string; dueBy?: string },
  ): Promise<Map<string, { total: number; completed: number }>> {
    // Section and single-student targets are two branches (not one OR join), so each join can
    // use its index.
    const rows: { assignment_id: string; total: number; completed: number }[] =
      await this.submissionRepo.manager.query(
        `WITH target AS (
           SELECT ha.id AS assignment_id, ha.section_id, ha.student_id
             FROM homework_assignments ha
            WHERE ha.tenant_id = $1 AND ha.status = 'ACTIVE'
              AND ($2::uuid[] IS NULL OR ha.id = ANY($2))
              AND ($4::date IS NULL OR ha.due_date <= $4::date)
         ), missing AS (
           SELECT t.assignment_id, st.id AS student_id
             FROM target t
             JOIN students st ON st.tenant_id = $1 AND st.class_section_id = t.section_id
            WHERE t.section_id IS NOT NULL
              AND st.deleted_at IS NULL AND st.enrollment_status = 'ACTIVE'
              AND ($3::uuid IS NULL OR st.id = $3)
           UNION ALL
           SELECT t.assignment_id, st.id
             FROM target t
             JOIN students st ON st.tenant_id = $1 AND st.id = t.student_id
            WHERE t.student_id IS NOT NULL
              AND st.deleted_at IS NULL AND st.enrollment_status = 'ACTIVE'
              AND ($3::uuid IS NULL OR st.id = $3)
         ), roster AS (
           SELECT hs.assignment_id, hs.status::text AS status
             FROM homework_submissions hs
            WHERE hs.tenant_id = $1
              AND ($2::uuid[] IS NULL OR hs.assignment_id = ANY($2))
              AND ($3::uuid IS NULL OR hs.student_id = $3)
           UNION ALL
           SELECT m.assignment_id, 'NOT_SUBMITTED'
             FROM missing m
            WHERE NOT EXISTS (SELECT 1 FROM homework_submissions x
                               WHERE x.assignment_id = m.assignment_id
                                 AND x.student_id = m.student_id)
         )
         SELECT assignment_id,
                count(*)::int AS total,
                count(*) FILTER (WHERE status = ANY($5::text[]))::int AS completed
           FROM roster
          GROUP BY assignment_id`,
        [
          tenantId,
          filter.assignmentIds ?? null,
          filter.studentId ?? null,
          filter.dueBy ?? null,
          COMPLETE_STATUSES,
        ],
      );
    return new Map(rows.map((r) => [r.assignment_id, { total: r.total, completed: r.completed }]));
  }

  private rollupFromCounts(
    counts: Map<string, { total: number; completed: number }>,
    dueDateByAssignmentId: Map<string, string>,
    today: string,
  ): CompletionRollup {
    let total = 0;
    let completed = 0;
    let defaulters = 0;
    for (const [assignmentId, c] of counts) {
      total += c.total;
      completed += c.completed;
      if ((dueDateByAssignmentId.get(assignmentId) ?? '') < today) {
        defaulters += c.total - c.completed;
      }
    }
    return {
      totalAssignments: total,
      completed,
      defaulters,
      completionPercent: percent(completed, total),
    };
  }

  /** All of one student's submissions, across every homework assigned to
   * them directly or through a section they belong to. */
  async getStudentRollup(
    studentId: string,
    tenantId: string,
    timezone = 'UTC',
  ): Promise<CompletionRollup> {
    const today = localToday(timezone);
    const counts = await this.rosterCounts(tenantId, { studentId, dueBy: today });
    const ids = [...counts.keys()];
    const assignments = ids.length
      ? await this.assignmentRepo.find({ where: { tenant_id: tenantId, id: In(ids) } })
      : [];
    const dueDateByAssignmentId = new Map(assignments.map((a) => [a.id, a.due_date]));
    return this.rollupFromCounts(counts, dueDateByAssignmentId, today);
  }

  /** All submissions against assignments targeting one section directly
   * (D24 — a section-wide assignment, not a per-student one). */
  async getSectionRollup(
    sectionId: string,
    tenantId: string,
    timezone = 'UTC',
  ): Promise<CompletionRollup> {
    const assignments = await this.assignmentRepo.find({
      where: { tenant_id: tenantId, section_id: sectionId },
    });
    if (assignments.length === 0) {
      return { totalAssignments: 0, completed: 0, defaulters: 0, completionPercent: 0 };
    }
    const dueDateByAssignmentId = new Map(assignments.map((a) => [a.id, a.due_date]));
    const today = localToday(timezone);
    const counts = await this.rosterCounts(tenantId, {
      assignmentIds: assignments.map((a) => a.id),
      dueBy: today,
    });
    return this.rollupFromCounts(counts, dueDateByAssignmentId, today);
  }

  /** Completion + defaulter rollup across every assignment for a class
   * (via that class's homework), plus a syllabus-completion % (D29).
   * `sectionIds` (a teacher's sections, Epic 75 D35) keeps only assignments to those sections
   * or to a student who sits in one. */
  async getClassRollup(
    classId: string,
    tenantId: string,
    timezone = 'UTC',
    sectionIds?: string[],
  ): Promise<CompletionRollup & { syllabus: SyllabusRollup }> {
    const base = { tenant_id: tenantId, homework: { class_id: classId } };
    const assignments = await this.assignmentRepo.find({
      where: sectionIds
        ? [
            { ...base, section_id: In(sectionIds) },
            { ...base, student: { class_section_id: In(sectionIds) } },
          ]
        : base,
      relations: ['homework'],
    });
    const dueDateByAssignmentId = new Map(assignments.map((a) => [a.id, a.due_date]));
    const today = localToday(timezone);
    const counts =
      assignments.length === 0
        ? new Map<string, { total: number; completed: number }>()
        : await this.rosterCounts(tenantId, {
            assignmentIds: assignments.map((a) => a.id),
            dueBy: today,
          });
    const rollup = this.rollupFromCounts(counts, dueDateByAssignmentId, today);

    const topics = await this.syllabusRepo.find({
      where: { tenant_id: tenantId, class_id: classId },
    });
    const done = topics.filter((t) => t.status === SyllabusTopicStatus.DONE).length;
    return {
      ...rollup,
      syllabus: {
        totalTopics: topics.length,
        done,
        completionPercent: percent(done, topics.length),
      },
    };
  }

  /**
   * [8.10.7.3.19] ADMIN card: submitted vs assigned for homework due in the last 7 days
   * (today and the 6 days before), per class of the current year. "Submitted" = COMPLETE_STATUSES,
   * so it agrees with `getClassRollup`.
   */
  async getSubmissionRateByClass(tenantId: string): Promise<HomeworkSubmissionRateDto> {
    const to = localToday();
    const from = addDays(to, -6);
    const dueAssignments: { assignment_id: string; class_id: string; class_name: string }[] =
      await this.assignmentRepo.manager.query(
        `SELECT ha.id AS assignment_id, c.id AS class_id, c.name AS class_name
           FROM homework_assignments ha
           JOIN homework h ON h.id = ha.homework_id AND h.tenant_id = $1
           JOIN classes c ON c.id = h.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
           JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.tenant_id = $1
             AND ay.is_current = true AND ay.deleted_at IS NULL
          WHERE ha.tenant_id = $1 AND ha.status = 'ACTIVE' AND ha.due_date BETWEEN $2 AND $3
          ORDER BY c.numeric_grade ASC NULLS LAST, c.name ASC, c.id ASC, ha.id ASC`,
        [tenantId, from, to],
      );
    // Every assignment in the window is due by today, so no `dueBy` is needed.
    const perAssignment = dueAssignments.length
      ? await this.rosterCounts(tenantId, {
          assignmentIds: dueAssignments.map((a) => a.assignment_id),
        })
      : new Map<string, { total: number; completed: number }>();
    // Rows arrive class-ordered (numeric grade, name, id), so a Map keeps that order.
    const byClass = new Map<
      string,
      { class_id: string; class_name: string; assigned: number; submitted: number }
    >();
    for (const a of dueAssignments) {
      const t = perAssignment.get(a.assignment_id);
      if (!t) continue;
      const c = byClass.get(a.class_id) ?? {
        class_id: a.class_id,
        class_name: a.class_name,
        assigned: 0,
        submitted: 0,
      };
      c.assigned += t.total;
      c.submitted += t.completed;
      byClass.set(a.class_id, c);
    }
    const classes = [...byClass.values()].map((c) => ({
      ...c,
      percentage: percent(c.submitted, c.assigned),
    }));
    const assigned = classes.reduce((n, c) => n + c.assigned, 0);
    const submitted = classes.reduce((n, c) => n + c.submitted, 0);
    return {
      window: { from, to },
      overall: { assigned, submitted, percentage: percent(submitted, assigned) },
      classes,
    };
  }

  /**
   * [8.10.7.3.19] Teacher card: done % per (class, subject) the caller teaches as SUBJECT_TEACHER
   * in the current year. Topics are per class + subject, so every section shares one %.
   * Lowest % first.
   */
  async getTeacherSyllabusProgress(
    tenantId: string,
    userId: string,
  ): Promise<MySyllabusProgressDto> {
    const manager = this.syllabusRepo.manager;
    const mine = (await teacherAssignments(manager, { userId, tenantId })).filter(
      (r) => r.assignment_type === TeacherAssignmentType.SUBJECT_TEACHER && r.subject_id,
    );
    if (mine.length === 0) return { items: [], behind_count: 0 };
    const pairs = [...new Set(mine.map((r) => `${r.class_id}:${r.subject_id}`))].map((k) =>
      k.split(':'),
    );
    const rows: {
      class_id: string;
      class_name: string;
      subject_id: string;
      subject_name_en: string;
      subject_name_bn: string | null;
      done: string;
      total: string;
    }[] = await manager.query(
      `SELECT c.id AS class_id, c.name AS class_name, sub.id AS subject_id,
              sub.name_en AS subject_name_en, sub.name_bn AS subject_name_bn,
              COUNT(st.id) AS total, COUNT(st.id) FILTER (WHERE st.status = 'DONE') AS done
         FROM unnest($2::uuid[], $3::uuid[]) AS p(class_id, subject_id)
         JOIN classes c ON c.id = p.class_id AND c.tenant_id = $1
         JOIN subjects sub ON sub.id = p.subject_id AND sub.tenant_id = $1
         LEFT JOIN syllabus_topics st ON st.class_id = p.class_id AND st.subject_id = p.subject_id
           AND st.tenant_id = $1
        GROUP BY c.id, c.name, sub.id, sub.name_en, sub.name_bn`,
      [tenantId, pairs.map((p) => p[0]), pairs.map((p) => p[1])],
    );
    const sectionRows: { id: string; section_name: string }[] = await manager.query(
      `SELECT id, section_name FROM class_sections WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, mine.map((r) => r.section_id)],
    );
    const nameOf = new Map(sectionRows.map((s) => [s.id, s.section_name]));
    const pace = await this.planDashboard.expectedForTeacher(
      tenantId,
      mine.map((r) => ({ section_id: r.section_id, subject_id: r.subject_id! })),
    );
    const items = rows.map((r) => {
      const done = Number(r.done);
      const total = Number(r.total);
      const sectionIds = [
        ...new Set(
          mine
            .filter((m) => m.class_id === r.class_id && m.subject_id === r.subject_id)
            .map((m) => m.section_id),
        ),
      ].sort((a, b) => (nameOf.get(a) ?? '').localeCompare(nameOf.get(b) ?? ''));
      let expected = 0;
      let planTotal = 0;
      for (const id of sectionIds) {
        const p = pace.get(`${id}|${r.subject_id}`);
        if (p) {
          expected += p.expected;
          planTotal += p.total;
        }
      }
      return {
        class_id: r.class_id,
        class_name: r.class_name,
        sections: sectionIds.map((id) => ({ section_id: id, section_name: nameOf.get(id) ?? '' })),
        subject_id: r.subject_id,
        subject_name_en: r.subject_name_en,
        subject_name_bn: r.subject_name_bn,
        done,
        total,
        percentage: percent(done, total),
        expected_percentage: planTotal ? Math.round((expected / planTotal) * 100) : null,
      };
    });
    return {
      behind_count: items.filter(
        (i) => i.expected_percentage !== null && i.percentage < i.expected_percentage,
      ).length,
      items: items.sort(
        (a, b) =>
          a.percentage - b.percentage ||
          a.class_name.localeCompare(b.class_name) ||
          a.subject_name_en.localeCompare(b.subject_name_en),
      ),
    };
  }
}
