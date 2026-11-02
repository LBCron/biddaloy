import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AudienceTab,
  AudienceTarget,
  NOTICE_LIMITS,
  NoticeRecipientKind,
  UserRole,
} from '@biddaloy/shared';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
import { OPEN_FEE_STATUSES } from '../fees/fees.constants';
import { SchoolsService } from '../schools/schools.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AudienceQueryDto, AudiencePersonDto, AudiencePageDto } from './dto/audience-query.dto';

export interface AudienceActor {
  role: string;
  userId: string;
}

const BAD_COMBO = 'এই ফিল্টার এখানে ব্যবহার করা যায় না';
const NEED_PICK = 'অন্তত একটি বেছে নিন';

const STUDENT_TABS: AudienceTab[] = [
  AudienceTab.CLASS,
  AudienceTab.SECTION,
  AudienceTab.NAMED_STUDENT,
  AudienceTab.EXAM_FAILED,
  AudienceTab.FEE_DUE,
  AudienceTab.LOW_ATTENDANCE,
  AudienceTab.ORG_GROUP,
];
/** Tabs served per target. STAFF has no advanced tabs. */
const BUILT_TABS: Record<AudienceTarget, AudienceTab[]> = {
  [AudienceTarget.STAFF]: [AudienceTab.ROLE, AudienceTab.NAMED_STAFF],
  [AudienceTarget.STUDENTS]: STUDENT_TABS,
  [AudienceTarget.GUARDIANS]: STUDENT_TABS,
};

/**
 * Params: $1 tenant, $2 roles|null, $3 classIds|null, $4 sectionIds|null, $5 teacher sections|null,
 * $6 name pattern|null, $7 limit|null (null = all), $8 offset, $9 exam|null, $10 today|null (FEE_DUE),
 * $11 open fee statuses|null, $12 low-attendance student ids|null, $13 shift|null, $14 version|null,
 * $15 group|null. Fixed SQL; optional filters are `IS NULL OR` (Rule 4). A shift matches the class's
 * `shift_id` row by name; the deprecated `classes.shift` text counts only when `shift_id` is unset,
 * since a shift rename never rewrites it.
 */
const STAFF_SQL = `
  SELECT 'STAFF' AS kind, u.id AS user_id, NULL::uuid AS student_id, NULL::uuid AS guardian_id,
         u.full_name AS name, string_agg(ut.role::text, ', ' ORDER BY ut.role::text) AS detail,
         true AS has_login, (u.phone IS NOT NULL AND u.phone <> '') AS has_phone,
         count(*) OVER()::int AS total
    FROM user_tenants ut
    JOIN users u ON u.id = ut.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
   WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL
     AND ut.role::text NOT IN ('SUPER_ADMIN', 'PARENT', 'STUDENT')
     AND ($2::text[] IS NULL OR ut.role::text = ANY($2::text[]))
     AND $3::uuid[] IS NULL AND $4::uuid[] IS NULL AND $5::uuid[] IS NULL
     AND $9::uuid IS NULL AND $10::date IS NULL AND $11::text[] IS NULL AND $12::uuid[] IS NULL
     AND $13::text IS NULL AND $14::text IS NULL AND $15::text IS NULL
     AND ($6::text IS NULL OR u.full_name ILIKE '%' || $6::text || '%')
   GROUP BY u.id
   ORDER BY u.full_name, u.id
   LIMIT $7::int OFFSET $8`;

const STUDENTS_SQL = `
  SELECT 'STUDENT' AS kind, s.user_id AS user_id, s.id AS student_id, NULL::uuid AS guardian_id,
         s.full_name AS name, c.name || ' · ' || cs.section_name AS detail,
         (u.id IS NOT NULL AND u.status = 'ACTIVE' AND u.deleted_at IS NULL) AS has_login, (u.phone IS NOT NULL AND u.phone <> '') AS has_phone,
         count(*) OVER()::int AS total
    FROM students s
    JOIN class_sections cs ON cs.id = s.class_section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
    JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
    LEFT JOIN users u ON u.id = s.user_id
   WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
     AND $2::text[] IS NULL
     AND ($3::uuid[] IS NULL OR c.id = ANY($3::uuid[]))
     AND ($4::uuid[] IS NULL OR s.class_section_id = ANY($4::uuid[]))
     AND ($5::uuid[] IS NULL OR s.class_section_id = ANY($5::uuid[]))
     AND ($6::text IS NULL OR s.full_name ILIKE '%' || $6::text || '%')
     AND ($9::uuid IS NULL OR EXISTS (SELECT 1 FROM results r
           WHERE r.exam_id = $9::uuid AND r.student_id = s.id AND r.tenant_id = $1
             AND r.deleted_at IS NULL AND r.is_fail = true))
     AND ($10::date IS NULL OR EXISTS (SELECT 1 FROM student_fees sf
           WHERE sf.student_id = s.id AND sf.deleted_at IS NULL
             AND sf.status::text = ANY($11::text[])
             AND sf.due_date IS NOT NULL AND sf.due_date < $10::date
             AND (sf.total_amount - sf.paid_amount - sf.discount_amount) > 0))
     AND ($12::uuid[] IS NULL OR s.id = ANY($12::uuid[]))
     AND ($13::text IS NULL OR EXISTS (SELECT 1 FROM shifts sh
           WHERE sh.id = c.shift_id AND sh.tenant_id = $1 AND sh.deleted_at IS NULL AND sh.name = $13::text)
          OR (c.shift_id IS NULL AND c.shift = $13::text))
     AND ($14::text IS NULL OR c.version = $14::text)
     AND ($15::text IS NULL OR cs.group_name = $15::text)
   ORDER BY c.name, cs.section_name, s.roll_number NULLS LAST, s.full_name, s.id
   LIMIT $7::int OFFSET $8`;

// One row per (guardian, student) pair (D17).
const GUARDIANS_SQL = `
  SELECT 'GUARDIAN' AS kind, g.user_id AS user_id, s.id AS student_id, g.id AS guardian_id,
         g.full_name AS name, s.full_name || ' · ' || c.name || ' · ' || cs.section_name AS detail,
         (gu.id IS NOT NULL AND gu.status = 'ACTIVE' AND gu.deleted_at IS NULL) AS has_login, (g.phone IS NOT NULL AND g.phone <> '') AS has_phone,
         count(*) OVER()::int AS total
    FROM students s
    JOIN student_guardians sg ON sg.student_id = s.id
    JOIN guardians g ON g.id = sg.guardian_id AND g.tenant_id = $1 AND g.deleted_at IS NULL
    LEFT JOIN users gu ON gu.id = g.user_id
    JOIN class_sections cs ON cs.id = s.class_section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
    JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
   WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
     AND $2::text[] IS NULL
     AND ($3::uuid[] IS NULL OR c.id = ANY($3::uuid[]))
     AND ($4::uuid[] IS NULL OR s.class_section_id = ANY($4::uuid[]))
     AND ($5::uuid[] IS NULL OR s.class_section_id = ANY($5::uuid[]))
     AND ($6::text IS NULL OR s.full_name ILIKE '%' || $6::text || '%')
     AND ($9::uuid IS NULL OR EXISTS (SELECT 1 FROM results r
           WHERE r.exam_id = $9::uuid AND r.student_id = s.id AND r.tenant_id = $1
             AND r.deleted_at IS NULL AND r.is_fail = true))
     AND ($10::date IS NULL OR EXISTS (SELECT 1 FROM student_fees sf
           WHERE sf.student_id = s.id AND sf.deleted_at IS NULL
             AND sf.status::text = ANY($11::text[])
             AND sf.due_date IS NOT NULL AND sf.due_date < $10::date
             AND (sf.total_amount - sf.paid_amount - sf.discount_amount) > 0))
     AND ($12::uuid[] IS NULL OR s.id = ANY($12::uuid[]))
     AND ($13::text IS NULL OR EXISTS (SELECT 1 FROM shifts sh
           WHERE sh.id = c.shift_id AND sh.tenant_id = $1 AND sh.deleted_at IS NULL AND sh.name = $13::text)
          OR (c.shift_id IS NULL AND c.shift = $13::text))
     AND ($14::text IS NULL OR c.version = $14::text)
     AND ($15::text IS NULL OR cs.group_name = $15::text)
   ORDER BY c.name, cs.section_name, s.roll_number NULLS LAST, s.full_name, g.full_name, g.id
   LIMIT $7::int OFFSET $8`;

const SQL: Record<AudienceTarget, string> = {
  [AudienceTarget.STAFF]: STAFF_SQL,
  [AudienceTarget.STUDENTS]: STUDENTS_SQL,
  [AudienceTarget.GUARDIANS]: GUARDIANS_SQL,
};

export type AudienceFilter = Pick<
  AudienceQueryDto,
  | 'target'
  | 'tab'
  | 'roles'
  | 'classIds'
  | 'sectionIds'
  | 'q'
  | 'examId'
  | 'belowPercent'
  | 'shift'
  | 'version'
  | 'group'
>;

interface Advanced {
  examId: string | null;
  today: string | null;
  openStatuses: string[] | null;
  lowIds: string[] | null;
  shift: string | null;
  version: string | null;
  group: string | null;
}

interface Row {
  kind: NoticeRecipientKind;
  user_id: string | null;
  student_id: string | null;
  guardian_id: string | null;
  name: string;
  detail: string;
  has_login: boolean;
  has_phone: boolean;
  total: number;
}

@Injectable()
export class AudienceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly teacherScope: TeacherScopeService,
    private readonly attendance: AttendanceSummaryService,
    private readonly schools: SchoolsService,
  ) {}

  async list(
    tenantId: string,
    actor: AudienceActor,
    dto: AudienceQueryDto,
  ): Promise<AudiencePageDto> {
    const { items, total } = await this.run(
      tenantId,
      actor,
      dto,
      dto.limit,
      (dto.page - 1) * dto.limit,
    );
    return { items, total, page: dto.page, limit: dto.limit };
  }

  /**
   * Every match for "select all". STUDENTS/STAFF: at most `recipientsMax + 1` rows (one row is one
   * person), so the caller can refuse above the cap. GUARDIANS returns every (guardian, student) pair,
   * bounded by the school's roster, so the caller can count distinct guardians against the cap.
   */
  async matchAll(
    tenantId: string,
    actor: AudienceActor,
    filter: AudienceFilter,
  ): Promise<AudiencePersonDto[]> {
    // ponytail: GUARDIANS select-all is unbounded rows (≈ students × guardians); fine at school size.
    const limit =
      filter.target === AudienceTarget.GUARDIANS ? null : NOTICE_LIMITS.recipientsMax + 1;
    return (await this.run(tenantId, actor, filter, limit, 0)).items;
  }

  private async run(
    tenantId: string,
    actor: AudienceActor,
    f: AudienceFilter,
    limit: number | null,
    offset: number,
  ): Promise<{ items: AudiencePersonDto[]; total: number }> {
    if (!BUILT_TABS[f.target]?.includes(f.tab)) throw new BadRequestException(BAD_COMBO);
    if (f.roles?.some((r) => ['SUPER_ADMIN', 'PARENT', 'STUDENT'].includes(r)))
      throw new BadRequestException(BAD_COMBO);
    if (
      (f.tab === AudienceTab.ROLE && !f.roles?.length) ||
      (f.tab === AudienceTab.CLASS && !f.classIds?.length) ||
      (f.tab === AudienceTab.SECTION && !f.sectionIds?.length) ||
      (f.tab === AudienceTab.EXAM_FAILED && !f.examId) ||
      (f.tab === AudienceTab.LOW_ATTENDANCE && f.belowPercent == null) ||
      (f.tab === AudienceTab.ORG_GROUP && !f.shift && !f.version && !f.group)
    )
      throw new BadRequestException(NEED_PICK);

    // null = no filter; array = a teacher's assigned sections ([] = none).
    const scope = await this.teacherScope.sectionScope({
      role: actor.role,
      userId: actor.userId,
      tenantId,
    });
    if (scope !== null) {
      if (f.target === AudienceTarget.STAFF)
        throw new ForbiddenException('You do not have access to this audience');
      if (f.sectionIds?.some((id) => !scope.includes(id)))
        throw new NotFoundException('Section not found');
      if (scope.length === 0) return { items: [], total: 0 };
      if (f.tab === AudienceTab.CLASS && f.classIds?.length) {
        // A class passes when the teacher has at least one section in it (the result narrows to those).
        const own: { class_id: string }[] = await this.dataSource.query(
          `SELECT DISTINCT cs.class_id FROM class_sections cs
            WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL AND cs.id = ANY($2::uuid[])`,
          [tenantId, scope],
        );
        if (f.classIds.some((id) => !own.some((o) => o.class_id === id)))
          throw new NotFoundException('Class not found');
      }
    }

    const adv = await this.advanced(tenantId, f, scope);
    if (adv === 'EMPTY') return { items: [], total: 0 };

    const params = [
      tenantId,
      f.tab === AudienceTab.ROLE ? f.roles : null,
      f.tab === AudienceTab.CLASS ? f.classIds : null,
      f.tab === AudienceTab.SECTION ? f.sectionIds : null,
      scope,
      normalizeSearchTerm(f.q),
      limit,
      offset,
      adv.examId,
      adv.today,
      adv.openStatuses,
      adv.lowIds,
      adv.shift,
      adv.version,
      adv.group,
    ];
    const rows: Row[] = await this.dataSource.query(SQL[f.target], params);
    let total = rows[0]?.total ?? 0;
    if (rows.length === 0 && offset > 0) {
      // A page past the end has no row to carry the count: ask the same query for one row of page 1.
      const first: Row[] = await this.dataSource.query(SQL[f.target], [
        ...params.slice(0, 6),
        1,
        0,
        ...params.slice(8),
      ]);
      total = first[0]?.total ?? 0;
    }
    return {
      total,
      items: rows.map((r) => ({
        kind: r.kind,
        userId: r.user_id,
        studentId: r.student_id,
        guardianId: r.guardian_id,
        name: r.name,
        detail: r.detail,
        hasLogin: r.has_login,
        hasPhone: r.has_phone,
      })),
    };
  }

  /** Extra inputs of the advanced tabs, or 'EMPTY' when nothing can match (never "no filter"). */
  private async advanced(
    tenantId: string,
    f: AudienceFilter,
    scope: string[] | null,
  ): Promise<Advanced | 'EMPTY'> {
    const adv: Advanced = {
      examId: null,
      today: null,
      openStatuses: null,
      lowIds: null,
      shift: null,
      version: null,
      group: null,
    };
    if (f.tab === AudienceTab.EXAM_FAILED) {
      // One 404 text for foreign, unpublished, deleted or out-of-scope exams (Rule 23).
      const ok = await this.dataSource.query(
        `SELECT 1 FROM exams e
          WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL AND e.status = 'PUBLISHED'
            AND ($3::uuid[] IS NULL OR EXISTS (
                  SELECT 1 FROM class_sections cs
                   WHERE cs.class_id = e.class_id AND cs.tenant_id = $2 AND cs.deleted_at IS NULL
                     AND cs.id = ANY($3::uuid[])))`,
        [f.examId, tenantId, scope],
      );
      if (ok.length === 0) throw new NotFoundException('Exam not found');
      adv.examId = f.examId!;
    } else if (f.tab === AudienceTab.FEE_DUE) {
      adv.today = await this.schools.todayFor(tenantId);
      adv.openStatuses = OPEN_FEE_STATUSES;
    } else if (f.tab === AudienceTab.LOW_ATTENDANCE) {
      const today = await this.schools.todayFor(tenantId);
      // Current year up to today; clamped to 400 days, the working-day calendar's limit.
      const [range] = await this.dataSource.query(
        `SELECT to_char(GREATEST(y.start_date, LEAST(y.end_date, $2::date) - 399), 'YYYY-MM-DD') AS "from",
                to_char(LEAST(y.end_date, $2::date), 'YYYY-MM-DD') AS "to"
           FROM academic_years y
          WHERE y.tenant_id = $1 AND y.is_current = true AND y.deleted_at IS NULL
          LIMIT 1`,
        [tenantId, today],
      );
      if (!range || range.from > range.to) return 'EMPTY';
      // ponytail: recomputes tenant-wide attendance on every page/select-all; cache per (tenant, day, threshold) if it gets slow.
      const { data } = await this.attendance.getLowAttendanceFlags({
        tenantId,
        from: range.from,
        to: range.to,
        thresholdPercent: f.belowPercent,
        page: 1,
        limit: Number.MAX_SAFE_INTEGER, // one grouped pass, same as at-risk.service.ts
      });
      // An empty list must stay an empty array: null would mean "no filter" in the SQL.
      if (data.length === 0) return 'EMPTY';
      adv.lowIds = data.map((d) => d.student_id);
    } else if (f.tab === AudienceTab.ORG_GROUP) {
      adv.shift = f.shift || null;
      adv.version = f.version || null;
      adv.group = f.group || null;
    }
    return adv;
  }
}
