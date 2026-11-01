import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { isUUID } from 'class-validator';
import { RoleScope, TeacherAssignmentType, roleScope } from '@biddaloy/shared';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Student } from '../students/entities/student.entity';

/**
 * [X-07] SQL scalar: the start_date of the academic year right before the tenant's current one
 * (latest start before the current year's). The homeroom grant and the marks-overdue alerts both
 * use it, so they cover the same years: current, or this prior one. `tenant` is the SQL
 * parameter for the tenant id (`:tenantId` or `$1`).
 */
export function priorYearStartSql(tenant: string): string {
  return `(SELECT max(p.start_date) FROM academic_years p
    JOIN academic_years cur ON cur.tenant_id = ${tenant} AND cur.is_current = true AND cur.deleted_at IS NULL
    WHERE p.tenant_id = ${tenant} AND p.deleted_at IS NULL AND p.start_date < cur.start_date)`;
}

/**
 * The one definition of "which sections does this teacher see" (Epic 75, D2): every live
 * CLASS / ASSISTANT / SUBJECT row of the caller, in a live section of a live class of the
 * tenant's **current** academic year. A SUBJECT row counts only while its subject is live.
 * `$1` = tenant id, `$2` = user id (the JWT carries a user id, not a teacher id).
 */
const TEACHER_ROWS_FROM_SQL = `
  FROM teacher_class_sections tcs
  JOIN teachers t ON t.id = tcs.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
  JOIN class_sections cs ON cs.id = tcs.section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
  JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
  JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.tenant_id = $1
    AND ay.is_current = true AND ay.deleted_at IS NULL
  LEFT JOIN subjects s ON s.id = tcs.subject_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
  WHERE tcs.tenant_id = $1 AND t.user_id = $2
    AND (tcs.assignment_type <> 'SUBJECT_TEACHER' OR s.id IS NOT NULL)`;

/**
 * [83.2.1] D18 — the coordinator half of "which sections may this teacher read": every live
 * section of a live class of the **current** academic year (D3/D14) that the caller coordinates
 * (`coordinator_assignments`), whole-class or for one live subject. Read paths only: it joins the
 * teaching rows through a UNION when a caller passes `includeCoordinated: true`.
 * `$1` = tenant id, `$2` = user id, same convention as `TEACHER_ROWS_FROM_SQL`.
 */
const COORDINATOR_ROWS_FROM_SQL = `
  FROM coordinator_assignments ca
  JOIN teachers t ON t.id = ca.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
  JOIN classes c ON c.id = ca.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
  JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.tenant_id = $1
    AND ay.is_current = true AND ay.deleted_at IS NULL
  JOIN class_sections cs ON cs.class_id = c.id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
  LEFT JOIN subjects s ON s.id = ca.subject_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
  WHERE ca.tenant_id = $1 AND t.user_id = $2
    AND (ca.subject_id IS NULL OR s.id IS NOT NULL)`;

/**
 * [83.3.1] Which coordinator rows widen a read. `true`: class and subject coordinators (reads that
 * are not per subject: students, attendance…). `'classLevel'`: class coordinators only, for reads
 * that show every subject at once (results, analysis), so a subject coordinator never sees
 * another subject's marks there (D4). `false` / omitted: teaching rows only.
 */
export type CoordinatedScope = boolean | 'classLevel';

/**
 * The section-id subquery a scope check filters on: teaching rows, plus coordinator rows when
 * `includeCoordinated` (D18). Exported for the unit spec only.
 */
export function visibleSectionIdsSql(includeCoordinated: CoordinatedScope | undefined): string {
  const teaching = `SELECT tcs.section_id ${TEACHER_ROWS_FROM_SQL}`;
  if (!includeCoordinated) return teaching;
  const classLevelOnly = includeCoordinated === 'classLevel' ? ' AND ca.subject_id IS NULL' : '';
  return `${teaching} UNION SELECT cs.id AS section_id ${COORDINATOR_ROWS_FROM_SQL}${classLevelOnly}`;
}

export interface TeacherAssignmentRow {
  section_id: string;
  class_id: string;
  assignment_type: TeacherAssignmentType;
  subject_id: string | null;
}

interface TeacherScopeInput {
  userId: string;
  tenantId: string;
  /**
   * [83.2.1] D18 — also count the sections of classes the caller coordinates. Default false
   * keeps today's answer. Only **read** call sites pass true; write gates and the fees, fines,
   * checkout and communications routes never do (D5).
   */
  includeCoordinated?: CoordinatedScope;
}

/** One coordinated class (or class + subject) of the caller, current academic year (83.2.1). */
export interface CoordinatedClassRow {
  class_id: string;
  class_name: string;
  subject_id: string | null;
  subject_name: string | null;
  section_ids: string[];
}

/** [83.2.1] D19 — what the caller's coordinator rows grant in one section (reads only). */
export interface CoordinatedGrant {
  /** A class-level row: every subject of the section. */
  allSubjects: boolean;
  /** Live subjects of subject-level rows. */
  subjectIds: string[];
}

export function teacherAssignments(
  manager: EntityManager,
  { userId, tenantId }: TeacherScopeInput,
): Promise<TeacherAssignmentRow[]> {
  return manager.query(
    `SELECT tcs.section_id, cs.class_id, tcs.assignment_type, s.id AS subject_id ${TEACHER_ROWS_FROM_SQL}`,
    [tenantId, userId],
  );
}

/** Distinct section ids of `teacherAssignments`. */
export async function teacherSectionIds(
  manager: EntityManager,
  { userId, tenantId, includeCoordinated }: TeacherScopeInput,
): Promise<string[]> {
  // UNION de-duplicates; the teaching-only form keeps today's DISTINCT query unchanged.
  const sql = includeCoordinated
    ? visibleSectionIdsSql(includeCoordinated)
    : `SELECT DISTINCT tcs.section_id ${TEACHER_ROWS_FROM_SQL}`;
  const rows: { section_id: string }[] = await manager.query(sql, [tenantId, userId]);
  return rows.map((r) => r.section_id);
}

/** True when a live student of the tenant sits in one of the caller's visible sections.
 * A non-UUID id is `false`, not a 500 (some routes have no `ParseUUIDPipe`). */
export async function teacherCanSeeStudent(
  manager: EntityManager,
  { userId, tenantId, studentId, includeCoordinated }: TeacherScopeInput & { studentId: string },
): Promise<boolean> {
  if (!isUUID(studentId)) return false;
  const rows: unknown[] = await manager.query(
    `SELECT 1 FROM students st
      WHERE st.id = $3 AND st.tenant_id = $1 AND st.deleted_at IS NULL
        AND st.class_section_id IN (${visibleSectionIdsSql(includeCoordinated)})
      LIMIT 1`,
    [tenantId, userId, studentId],
  );
  return rows.length > 0;
}

/**
 * [83.3.1] Live classes of the current year the caller coordinates (class- or subject-level).
 * For read gates that work per class (homework analytics). Never for writes (D4).
 */
export async function teacherCoordinatedClassIds(
  manager: EntityManager,
  { userId, tenantId }: TeacherScopeInput,
): Promise<string[]> {
  const rows: { class_id: string }[] = await manager.query(
    `SELECT DISTINCT c.id AS class_id ${COORDINATOR_ROWS_FROM_SQL}`,
    [tenantId, userId],
  );
  return rows.map((r) => r.class_id);
}

export type HomeroomType =
  TeacherAssignmentType.CLASS_TEACHER | TeacherAssignmentType.ASSISTANT_CLASS_TEACHER;

export interface HomeroomSectionRow {
  section_id: string;
  section_name: string;
  class_id: string;
  class_name: string;
  assignment_type: HomeroomType;
}

const HOMEROOM_TYPES: HomeroomType[] = [
  TeacherAssignmentType.CLASS_TEACHER,
  TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
];

/**
 * "What is this user's role in this section?" — the one place for new call sites that joins
 * user -> `teachers.user_id` -> `teacher_class_sections` (the JWT carries a
 * **user** id, not a teacher id). Every table is filtered on `tenant_id`.
 *
 * It only answers for the teacher's own rows. Tenant-wide roles never reach
 * it: callers short-circuit with `hasTenantDataScope` first (D29), so no
 * role list lives here.
 */
@Injectable()
export class TeacherScopeService {
  constructor(
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  /** Distinct sections the user teaches, current academic year only (see `teacherSectionIds`). */
  sectionIds(input: TeacherScopeInput): Promise<string[]> {
    return teacherSectionIds(this.tcsRepo.manager, input);
  }

  currentAssignments(input: TeacherScopeInput): Promise<TeacherAssignmentRow[]> {
    return teacherAssignments(this.tcsRepo.manager, input);
  }

  canSeeStudent(input: TeacherScopeInput & { studentId: string }): Promise<boolean> {
    return teacherCanSeeStudent(this.tcsRepo.manager, input);
  }

  /** `null` = no extra filter (tenant-scope and guardian roles); array = ASSIGNED_SECTIONS.
   * An unknown role sees nothing (`[]`), per `roleScope`'s contract. */
  async sectionScope(input: {
    role: string;
    userId: string;
    tenantId: string;
    includeCoordinated?: CoordinatedScope;
  }): Promise<string[] | null> {
    const scope = roleScope(input.role);
    if (scope === null) return [];
    if (scope !== RoleScope.ASSIGNED_SECTIONS) return null;
    return this.sectionIds(input);
  }

  /** Ids of live students in the caller's visible sections; `null` = no extra filter (non-teacher roles).
   * Pass `scope` when the caller already holds `sectionScope` (e.g. from `assertCanSeeGuardian`). */
  async scopedStudentIds(input: {
    role: string;
    userId: string;
    tenantId: string;
    includeCoordinated?: CoordinatedScope;
    scope?: string[] | null;
  }): Promise<string[] | null> {
    const scope = input.scope !== undefined ? input.scope : await this.sectionScope(input);
    if (scope === null) return null;
    if (scope.length === 0) return [];
    const rows = await this.studentRepo
      .createQueryBuilder('st')
      .select('st.id', 'id')
      .where('st.tenant_id = :tenantId', { tenantId: input.tenantId })
      .andWhere('st.deleted_at IS NULL')
      .andWhere('st.class_section_id IN (:...scope)', { scope })
      .getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  /**
   * 404 unless the guardian is linked to a live student in a visible section. No-op when unscoped.
   * Returns the caller's `sectionScope`, so the caller can filter without computing it again.
   */
  async assertCanSeeGuardian(input: {
    role: string;
    userId: string;
    tenantId: string;
    guardianId: string;
    includeCoordinated?: CoordinatedScope;
  }): Promise<string[] | null> {
    const scope = await this.sectionScope(input);
    if (scope === null) return null;
    const ok =
      scope.length > 0 &&
      isUUID(input.guardianId) &&
      (
        await this.studentRepo.manager.query(
          `SELECT 1 FROM student_guardians sg
             JOIN students st ON st.id = sg.student_id AND st.tenant_id = $1 AND st.deleted_at IS NULL
             JOIN guardians g ON g.id = sg.guardian_id AND g.tenant_id = $1 AND g.deleted_at IS NULL
            WHERE sg.guardian_id = $2 AND st.class_section_id = ANY($3::uuid[]) LIMIT 1`,
          [input.tenantId, input.guardianId, scope],
        )
      ).length > 0;
    if (!ok) throw new NotFoundException('Guardian not found');
    return scope;
  }

  /**
   * `homeroom` is the caller's CLASS/ASSISTANT row for the section (a teacher
   * holds at most one, by `UQ_tcs_teacher_section_homeroom`). `subjectIds`
   * holds only **live** subjects (D16): a soft-deleted subject drops out, so
   * its teacher loses read and write on it. `inYearWindow` is true when the
   * section is live and in the current academic year, or in the year right
   * before it while its class still has a DRAFT exam [X-07]. Marks gate on it
   * (Epic 75 D31), so marks entry outlives the year flag for subject rows too.
   * DRAFT only, on purpose (D45): last year's PROCESSED-but-unpublished exam
   * is admin-only to correct, and the window matches the marks-due alerts.
   */
  async rolesInSection(input: { userId: string; tenantId: string; sectionId: string }): Promise<{
    homeroom: HomeroomType | null;
    subjectIds: string[];
    inYearWindow: boolean;
    coordinated: CoordinatedGrant;
  }> {
    const { userId, tenantId, sectionId } = input;
    const rows = await this.tcsRepo
      .createQueryBuilder('tcs')
      .innerJoin(
        'teachers',
        't',
        't.id = tcs.teacher_id AND t.tenant_id = :tenantId AND t.deleted_at IS NULL',
        { tenantId },
      )
      .leftJoin(
        'subjects',
        's',
        's.id = tcs.subject_id AND s.tenant_id = :tenantId AND s.deleted_at IS NULL',
        { tenantId },
      )
      // Homeroom (CLASS/ASSISTANT) grants a read of EVERY subject, so it only
      // counts while the section is live and in the current academic year, or in
      // the year right before it (latest start_date before the current year's)
      // while that class still has a DRAFT exam [X-07]: marks entry outlives the
      // year flag. DRAFT only, and the same two years (`priorYearStartSql`) as the
      // marks-overdue alert, so the grant ends when the alert clears; older and
      // future years never qualify for either. Trade-off: the grant then covers every homeroom-gated read, not
      // only marks; narrow it to marks reads if that ever matters.
      // SUBJECT_TEACHER rows stay year-agnostic in `subjectIds`; `inYearWindow` reports
      // the same window for callers (marks) that need it.
      .leftJoin(
        'class_sections',
        'cs',
        'cs.id = tcs.section_id AND cs.tenant_id = :tenantId AND cs.deleted_at IS NULL',
        { tenantId },
      )
      .leftJoin(
        'classes',
        'c',
        'c.id = cs.class_id AND c.tenant_id = :tenantId AND c.deleted_at IS NULL',
        { tenantId },
      )
      .leftJoin(
        'academic_years',
        'ay',
        `ay.id = c.academic_year_id AND ay.tenant_id = :tenantId AND ay.deleted_at IS NULL AND (
          ay.is_current = true
          OR (
            ay.start_date = ${priorYearStartSql(':tenantId')}
            AND EXISTS (SELECT 1 FROM exams e WHERE e.tenant_id = :tenantId AND e.class_id = c.id AND e.academic_year_id = ay.id AND e.deleted_at IS NULL AND e.status = 'DRAFT')
          )
        )`,
        { tenantId },
      )
      .select('tcs.assignment_type', 'assignment_type')
      .addSelect('s.id', 'live_subject_id')
      .addSelect('ay.id', 'homeroom_year_id')
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('tcs.section_id = :sectionId', { sectionId })
      .andWhere('t.user_id = :userId', { userId })
      .getRawMany<{
        assignment_type: TeacherAssignmentType;
        live_subject_id: string | null;
        homeroom_year_id: string | null;
      }>();

    const homeroomTypes = rows
      .filter((r) => r.homeroom_year_id)
      .map((r) => r.assignment_type)
      .filter((type): type is HomeroomType => HOMEROOM_TYPES.includes(type as HomeroomType));
    // CLASS_TEACHER wins if (impossibly, per the unique index) both appear.
    const homeroom = homeroomTypes.includes(TeacherAssignmentType.CLASS_TEACHER)
      ? TeacherAssignmentType.CLASS_TEACHER
      : (homeroomTypes[0] ?? null);
    const subjectIds = rows
      .filter(
        (r) => r.assignment_type === TeacherAssignmentType.SUBJECT_TEACHER && r.live_subject_id,
      )
      .map((r) => r.live_subject_id as string);

    return {
      homeroom,
      subjectIds,
      inYearWindow: rows.some((r) => r.homeroom_year_id),
      coordinated: await this.coordinatedGrant(input),
    };
  }

  /**
   * [83.2.1] D19 — the caller's coordinator rows on the section's class (current year only).
   * Kept apart from `homeroom` / `subjectIds` so write gates, which read only those two, never
   * widen. Read gates opt in by also checking `coordinated`.
   */
  private async coordinatedGrant(input: {
    userId: string;
    tenantId: string;
    sectionId: string;
  }): Promise<CoordinatedGrant> {
    if (!isUUID(input.sectionId)) return { allSubjects: false, subjectIds: [] };
    const rows: { subject_id: string | null }[] = await this.tcsRepo.manager.query(
      `SELECT DISTINCT ca.subject_id ${COORDINATOR_ROWS_FROM_SQL} AND cs.id = $3`,
      [input.tenantId, input.userId, input.sectionId],
    );
    return {
      allSubjects: rows.some((r) => r.subject_id === null),
      subjectIds: rows.filter((r) => r.subject_id !== null).map((r) => r.subject_id as string),
    };
  }

  /**
   * [83.2.1] The caller's coordinator rows, one per (class, subject), current academic year,
   * with the live section ids of each class. Feeds My coordination and its overview (83.3.2).
   * Ordered like `homeroomSections`: numeric grade, then name; class-level rows first.
   */
  async coordinatedClasses(input: {
    userId: string;
    tenantId: string;
  }): Promise<CoordinatedClassRow[]> {
    const rows: CoordinatedClassRow[] = await this.tcsRepo.manager.query(
      `SELECT c.id AS class_id, c.name AS class_name, s.id AS subject_id, s.name_en AS subject_name,
              array_agg(DISTINCT cs.id::text) AS section_ids
         ${COORDINATOR_ROWS_FROM_SQL}
        GROUP BY c.id, c.name, c.numeric_grade, s.id, s.name_en
        ORDER BY c.numeric_grade ASC NULLS LAST, c.name ASC, s.name_en ASC NULLS FIRST`,
      [input.tenantId, input.userId],
    );
    return rows.map((r) => ({ ...r, section_ids: [...r.section_ids].sort() }));
  }

  /** The caller's CLASS/ASSISTANT sections in the **current** academic year,
   * skipping soft-deleted sections/classes, ordered class then section. */
  async homeroomSections(input: {
    userId: string;
    tenantId: string;
  }): Promise<HomeroomSectionRow[]> {
    const { userId, tenantId } = input;
    // numeric_grade first: by name alone "Class 10" sorts before "Class 6".
    return this.tcsRepo
      .createQueryBuilder('tcs')
      .innerJoin(
        'teachers',
        't',
        't.id = tcs.teacher_id AND t.tenant_id = :tenantId AND t.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'class_sections',
        'cs',
        'cs.id = tcs.section_id AND cs.tenant_id = :tenantId AND cs.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'classes',
        'c',
        'c.id = cs.class_id AND c.tenant_id = :tenantId AND c.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'academic_years',
        'ay',
        'ay.id = c.academic_year_id AND ay.tenant_id = :tenantId AND ay.is_current = true AND ay.deleted_at IS NULL',
        { tenantId },
      )
      .select('cs.id', 'section_id')
      .addSelect('cs.section_name', 'section_name')
      .addSelect('c.id', 'class_id')
      .addSelect('c.name', 'class_name')
      .addSelect('tcs.assignment_type', 'assignment_type')
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('tcs.assignment_type IN (:...types)', { types: HOMEROOM_TYPES })
      .andWhere('t.user_id = :userId', { userId })
      .orderBy('c.numeric_grade', 'ASC', 'NULLS LAST')
      .addOrderBy('c.name', 'ASC')
      .addOrderBy('cs.section_name', 'ASC')
      .getRawMany<HomeroomSectionRow>();
  }

  /** REQUESTED arrival-notice subscriptions per section, one grouped query (D18, D37).
   * Callers pass only sections already scoped to the teacher; sections with none are absent. */
  async arrivalRequestCounts(input: {
    tenantId: string;
    sectionIds: string[];
  }): Promise<Map<string, number>> {
    if (input.sectionIds.length === 0) return new Map();
    const rows: { section_id: string; n: string }[] = await this.tcsRepo.manager.query(
      `SELECT st.class_section_id AS section_id, count(*) AS n
         FROM arrival_notice_subscriptions ans
         JOIN students st ON st.id = ans.student_id AND st.tenant_id = $1 AND st.deleted_at IS NULL
         JOIN student_guardians sg ON sg.student_id = ans.student_id AND sg.guardian_id = ans.guardian_id
         JOIN guardians g ON g.id = ans.guardian_id AND g.tenant_id = $1 AND g.deleted_at IS NULL
        WHERE ans.tenant_id = $1 AND ans.status = 'REQUESTED'
          AND st.class_section_id = ANY($2::uuid[])
        GROUP BY st.class_section_id`,
      [input.tenantId, input.sectionIds],
    );
    return new Map(rows.map((r) => [r.section_id, Number(r.n)]));
  }

  /** True when the user holds a live SUBJECT_TEACHER row for `subjectId` in any
   *  live section of live `classId`. Homeroom rows never count (write rule, like marks). */
  async teachesSubjectInClass(input: {
    userId: string;
    tenantId: string;
    classId: string;
    subjectId: string;
  }): Promise<boolean> {
    const { userId, tenantId, classId, subjectId } = input;
    return this.tcsRepo
      .createQueryBuilder('tcs')
      .innerJoin(
        'teachers',
        't',
        't.id = tcs.teacher_id AND t.tenant_id = :tenantId AND t.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'class_sections',
        'cs',
        'cs.id = tcs.section_id AND cs.tenant_id = :tenantId AND cs.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'classes',
        'c',
        'c.id = cs.class_id AND c.tenant_id = :tenantId AND c.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'subjects',
        's',
        's.id = tcs.subject_id AND s.tenant_id = :tenantId AND s.deleted_at IS NULL',
        { tenantId },
      )
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('tcs.assignment_type = :type', { type: TeacherAssignmentType.SUBJECT_TEACHER })
      .andWhere('tcs.subject_id = :subjectId', { subjectId })
      .andWhere('cs.class_id = :classId', { classId })
      .andWhere('t.user_id = :userId', { userId })
      .getExists();
  }
}
