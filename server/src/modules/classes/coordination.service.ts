import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AlertSeverity, MarkGridState } from '@biddaloy/shared';
import { localToday } from '../../common/time';
import { SchoolsService } from '../schools/schools.service';
import { MarkGridService } from '../exams/mark-grid.service';
import { ManualAlertsService } from '../attention/manual/manual-alerts.service';
import { addDaysIso } from '../attention/rules/rule-context.service';
import { TeacherScopeService, type CoordinatedClassRow } from './teacher-scope.service';
import type {
  CoordinationClassDto,
  CoordinationOverviewDto,
  CoordinationPendingGridDto,
  CoordinationSectionDto,
  CoordinationTeacherDto,
  NotifyCoordinatedTeachersDto,
  NotifyCoordinatedTeachersResultDto,
} from './dto/coordination.dto';

/** D24/Rule 23: one fixed sentence, never the ids that were sent. */
export const NOTIFY_NOBODY = 'None of the chosen teachers teach the classes you coordinate.';
/** How long a coordinator's reminder stays in the teachers' bar (well inside the 30-day cap). */
export const NOTIFY_DAYS = 7;
const TITLE_MAX = 140;

interface TeachingRow {
  section_id: string;
  section_name: string;
  subject_id: string | null;
  subject_name: string | null;
  assignment_type: string;
  teacher_id: string;
  user_id: string;
  full_name: string;
}

/**
 * [83.3.2] Academics › My coordination (Epic 83 D22–D28): a DB-only read of what is still not
 * done in the classes the caller coordinates, and one in-app reminder to those classes' teachers.
 * Kept out of `TeacherScopeService` on purpose (D28): the scope service is the one scope gate and
 * must not compose attendance or exams.
 *
 * ```mermaid
 * flowchart LR
 *   A[coordinatedClasses] --> B[sections: whole-day session for the date]
 *   A --> C[DRAFT exams, last sitting <= today: MarkGridService.progress]
 *   A --> D[teacher_class_sections of those sections]
 * ```
 */
@Injectable()
export class CoordinationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly teacherScope: TeacherScopeService,
    private readonly schools: SchoolsService,
    private readonly markGrids: MarkGridService,
    private readonly manualAlerts: ManualAlertsService,
  ) {}

  /** D25: a TEACHER with no coordinator rows gets `{ date, classes: [] }`, never an error. */
  async overview(
    userId: string,
    tenantId: string,
    date?: string,
  ): Promise<CoordinationOverviewDto> {
    const day = date ?? (await this.schoolToday(tenantId));
    const rows = await this.teacherScope.coordinatedClasses({ userId, tenantId });
    if (rows.length === 0) return { date: day, classes: [] };

    const sectionIds = [...new Set(rows.flatMap((r) => r.section_ids))];
    const [sections, sessions, teaching] = await Promise.all([
      this.sectionNames(tenantId, sectionIds),
      this.dayRegisters(tenantId, sectionIds, day),
      this.teachingRows(tenantId, sectionIds),
    ]);
    const pendingByClass = await this.pendingGrids(
      tenantId,
      [...new Set(rows.map((r) => r.class_id))],
      day,
      teaching,
    );

    const classes: CoordinationClassDto[] = rows.map((row) => {
      const mine = (t: TeachingRow) => row.subject_id === null || t.subject_id === row.subject_id;
      const sectionList: CoordinationSectionDto[] = row.section_ids
        .map((id) => {
          const session = sessions.get(id);
          const classTeacher = teaching.find(
            (t) => t.section_id === id && t.assignment_type === 'CLASS_TEACHER',
          );
          return {
            section_id: id,
            section_name: sections.get(id) ?? '',
            attendance_taken: session?.state === 'FINALIZED',
            taken_by_name: session?.state === 'FINALIZED' ? (session.taken_by_name ?? null) : null,
            class_teacher_name: classTeacher?.full_name ?? null,
          };
        })
        .sort((a, b) => a.section_name.localeCompare(b.section_name));
      return {
        class_id: row.class_id,
        class_name: row.class_name,
        subject_id: row.subject_id,
        subject_name: row.subject_name,
        sections: sectionList,
        // D22: a subject coordinator sees only their subject's grids.
        pending_grids: (pendingByClass.get(row.class_id) ?? []).filter(
          (g) => row.subject_id === null || g.subject_id === row.subject_id,
        ),
        // The coordinator is left out: they never remind themself (`notify` drops them too).
        teachers: groupTeachers(
          teaching.filter(
            (t) => row.section_ids.includes(t.section_id) && mine(t) && t.user_id !== userId,
          ),
        ),
      };
    });
    return { date: day, classes };
  }

  /**
   * D8/D24: a REMINDER to the chosen teachers who teach a coordinated class; anyone else in
   * `userIds` is dropped silently. Rides `ManualAlertsService.send` (its lock, daily cap and
   * delivery), with no `ALERT_SEND` for the coordinator.
   */
  async notify(
    userId: string,
    tenantId: string,
    dto: NotifyCoordinatedTeachersDto,
  ): Promise<NotifyCoordinatedTeachersResultDto> {
    const rows = await this.teacherScope.coordinatedClasses({ userId, tenantId });
    const teaching = rows.length
      ? await this.teachingRows(tenantId, [...new Set(rows.flatMap((r) => r.section_ids))])
      : [];
    const reachable = new Set(
      rows.flatMap((row) =>
        teaching
          .filter(
            (t) =>
              row.section_ids.includes(t.section_id) &&
              (row.subject_id === null || t.subject_id === row.subject_id),
          )
          .map((t) => t.user_id),
      ),
    );
    // The coordinator never reminds themself, even when they also teach the class.
    const allowed = dto.userIds.filter((id) => reachable.has(id) && id !== userId);
    if (allowed.length === 0) throw new UnprocessableEntityException(NOTIFY_NOBODY);

    const today = await this.schoolToday(tenantId);
    const alert = await this.manualAlerts.send(tenantId, userId, {
      audience: { userIds: allowed },
      severity: AlertSeverity.REMINDER,
      title: await this.title(userId, rows),
      body: dto.message,
      expiresOn: addDaysIso(today, NOTIFY_DAYS),
    });
    return { alert_id: alert.id, recipient_count: allowed.length };
  }

  // ------------------------------------------------------------------ helpers

  private async schoolToday(tenantId: string): Promise<string> {
    const settings = await this.schools.getResolvedSettings(tenantId);
    return localToday(settings.region?.timezone ?? 'UTC');
  }

  /** "<coordinator name> · Class 6, Class 7 Mathematics" (D24), cut to the alert title limit. */
  private async title(userId: string, rows: CoordinatedClassRow[]): Promise<string> {
    const [user] = await this.dataSource.query(`SELECT full_name FROM users WHERE id = $1`, [
      userId,
    ]);
    const what = [
      ...new Set(
        rows.map((r) => (r.subject_name ? `${r.class_name} ${r.subject_name}` : r.class_name)),
      ),
    ].join(', ');
    const full = `${(user?.full_name as string | undefined) ?? ''} · ${what}`.trim();
    return full.length <= TITLE_MAX ? full : `${full.slice(0, TITLE_MAX - 1)}…`;
  }

  private async sectionNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
    const rows: { id: string; section_name: string }[] = await this.dataSource.query(
      `SELECT id, section_name FROM class_sections WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    return new Map(rows.map((r) => [r.id, r.section_name]));
  }

  /** D23: the whole-day register (period_no NULL) of each section on `date`, one query. */
  private async dayRegisters(
    tenantId: string,
    ids: string[],
    date: string,
  ): Promise<Map<string, { state: string; taken_by_name: string | null }>> {
    const rows: { section_id: string; state: string; taken_by_name: string | null }[] =
      await this.dataSource.query(
        `SELECT s.section_id, s.state::text AS state, u.full_name AS taken_by_name
           FROM attendance_sessions s
           LEFT JOIN users u ON u.id = s.marked_by_user_id
          WHERE s.tenant_id = $1 AND s.section_id = ANY($2::uuid[]) AND s.date = $3
            AND s.period_no IS NULL`,
        [tenantId, ids, date],
      );
    return new Map(rows.map((r) => [r.section_id, r]));
  }

  /** Live teacher rows of the sections (class, assistant and subject), with names. */
  private teachingRows(tenantId: string, ids: string[]): Promise<TeachingRow[]> {
    return this.dataSource.query(
      `SELECT tcs.section_id, cs.section_name, s.id AS subject_id, s.name_en AS subject_name,
              tcs.assignment_type::text AS assignment_type, t.id AS teacher_id, t.user_id,
              u.full_name
         FROM teacher_class_sections tcs
         JOIN teachers t ON t.id = tcs.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
         JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL
         JOIN class_sections cs ON cs.id = tcs.section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
         LEFT JOIN subjects s ON s.id = tcs.subject_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
        WHERE tcs.tenant_id = $1 AND tcs.section_id = ANY($2::uuid[])
          AND (tcs.assignment_type <> 'SUBJECT_TEACHER' OR s.id IS NOT NULL)
        ORDER BY u.full_name ASC`,
      [tenantId, ids],
    );
  }

  /**
   * D22: DRAFT exams of the classes, current academic year, whose last sitting is on/before
   * `date` (the marks-overdue window without its grace days), and their grids not yet SUBMITTED.
   * ponytail: one `progress` per exam (a handful per class); batch it if it ever grows.
   */
  private async pendingGrids(
    tenantId: string,
    classIds: string[],
    date: string,
    teaching: TeachingRow[],
  ): Promise<Map<string, CoordinationPendingGridDto[]>> {
    const exams: { id: string; name: string; class_id: string }[] = await this.dataSource.query(
      `SELECT e.id, e.name, e.class_id
         FROM exams e
         JOIN academic_years y ON y.id = e.academic_year_id AND y.tenant_id = $1
           AND y.is_current = true AND y.deleted_at IS NULL
         JOIN exam_schedules es ON es.exam_id = e.id AND es.tenant_id = $1 AND es.deleted_at IS NULL
        WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND e.status = 'DRAFT'
          AND e.class_id = ANY($2::uuid[])
        GROUP BY e.id, e.name, e.class_id
       HAVING MAX(es.date) <= $3
        ORDER BY e.name ASC`,
      [tenantId, classIds, date],
    );
    const byClass = new Map<string, CoordinationPendingGridDto[]>();
    for (const exam of exams) {
      const progress = await this.markGrids.progress(exam.id, tenantId, undefined, null);
      const open = progress.outstanding.filter((g) => g.state !== MarkGridState.SUBMITTED);
      const list = byClass.get(exam.class_id) ?? [];
      for (const g of open) {
        const teacher = teaching.find(
          (t) =>
            t.section_id === g.section_id &&
            t.assignment_type === 'SUBJECT_TEACHER' &&
            t.subject_id === g.subject_id,
        );
        list.push({
          exam_id: exam.id,
          exam_name: exam.name,
          section_id: g.section_id,
          section_name: g.section_name,
          subject_id: g.subject_id,
          subject_name: g.subject_name,
          teacher_name: teacher?.full_name ?? null,
          state: g.state,
        });
      }
      byClass.set(exam.class_id, list);
    }
    return byClass;
  }
}

/** One entry per teacher, with the sections and subjects they hold in the slice. */
function groupTeachers(rows: TeachingRow[]): CoordinationTeacherDto[] {
  const byUser = new Map<string, CoordinationTeacherDto>();
  for (const r of rows) {
    const entry = byUser.get(r.user_id) ?? {
      user_id: r.user_id,
      teacher_id: r.teacher_id,
      full_name: r.full_name,
      section_names: [],
      subject_names: [],
    };
    if (!entry.section_names.includes(r.section_name)) entry.section_names.push(r.section_name);
    if (r.subject_name && !entry.subject_names.includes(r.subject_name)) {
      entry.subject_names.push(r.subject_name);
    }
    byUser.set(r.user_id, entry);
  }
  return [...byUser.values()].map((t) => ({
    ...t,
    section_names: t.section_names.sort(),
    subject_names: t.subject_names.sort(),
  }));
}
