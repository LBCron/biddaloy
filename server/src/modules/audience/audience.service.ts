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
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AudienceQueryDto, AudiencePersonDto, AudiencePageDto } from './dto/audience-query.dto';

export interface AudienceActor {
  role: string;
  userId: string;
}

const NOT_BUILT = 'এই ফিল্টার এখনো চালু হয়নি';
const BAD_COMBO = 'এই ফিল্টার এখানে ব্যবহার করা যায় না';
const NEED_PICK = 'অন্তত একটি বেছে নিন';

/** Tabs this ticket serves per target; the advanced tabs (53.3.04) answer 400 until then. */
const BUILT_TABS: Record<AudienceTarget, AudienceTab[]> = {
  [AudienceTarget.STAFF]: [AudienceTab.ROLE, AudienceTab.NAMED_STAFF],
  [AudienceTarget.STUDENTS]: [AudienceTab.CLASS, AudienceTab.SECTION, AudienceTab.NAMED_STUDENT],
  [AudienceTarget.GUARDIANS]: [AudienceTab.CLASS, AudienceTab.SECTION, AudienceTab.NAMED_STUDENT],
};
const ADVANCED_TABS = [
  AudienceTab.EXAM_FAILED,
  AudienceTab.FEE_DUE,
  AudienceTab.LOW_ATTENDANCE,
  AudienceTab.ORG_GROUP,
];

/**
 * Params: $1 tenant, $2 roles|null, $3 classIds|null, $4 sectionIds|null, $5 teacher sections|null,
 * $6 name pattern|null, $7 limit, $8 offset. Fixed SQL; optional filters are `IS NULL OR` (Rule 4).
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
     AND ($6::text IS NULL OR u.full_name ILIKE '%' || $6::text || '%')
   GROUP BY u.id
   ORDER BY u.full_name, u.id
   LIMIT $7 OFFSET $8`;

const STUDENTS_SQL = `
  SELECT 'STUDENT' AS kind, s.user_id AS user_id, s.id AS student_id, NULL::uuid AS guardian_id,
         s.full_name AS name, c.name || ' · ' || cs.section_name AS detail,
         (s.user_id IS NOT NULL) AS has_login, (u.phone IS NOT NULL AND u.phone <> '') AS has_phone,
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
   ORDER BY c.name, cs.section_name, s.roll_number NULLS LAST, s.full_name, s.id
   LIMIT $7 OFFSET $8`;

// One row per (guardian, student) pair (D17).
const GUARDIANS_SQL = `
  SELECT 'GUARDIAN' AS kind, g.user_id AS user_id, s.id AS student_id, g.id AS guardian_id,
         g.full_name AS name, s.full_name || ' · ' || c.name || ' · ' || cs.section_name AS detail,
         (g.user_id IS NOT NULL) AS has_login, (g.phone IS NOT NULL AND g.phone <> '') AS has_phone,
         count(*) OVER()::int AS total
    FROM students s
    JOIN student_guardians sg ON sg.student_id = s.id
    JOIN guardians g ON g.id = sg.guardian_id AND g.tenant_id = $1 AND g.deleted_at IS NULL
    JOIN class_sections cs ON cs.id = s.class_section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
    JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
   WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
     AND $2::text[] IS NULL
     AND ($3::uuid[] IS NULL OR c.id = ANY($3::uuid[]))
     AND ($4::uuid[] IS NULL OR s.class_section_id = ANY($4::uuid[]))
     AND ($5::uuid[] IS NULL OR s.class_section_id = ANY($5::uuid[]))
     AND ($6::text IS NULL OR s.full_name ILIKE '%' || $6::text || '%')
   ORDER BY c.name, cs.section_name, s.roll_number NULLS LAST, s.full_name, g.full_name, g.id
   LIMIT $7 OFFSET $8`;

const SQL: Record<AudienceTarget, string> = {
  [AudienceTarget.STAFF]: STAFF_SQL,
  [AudienceTarget.STUDENTS]: STUDENTS_SQL,
  [AudienceTarget.GUARDIANS]: GUARDIANS_SQL,
};

export type AudienceFilter = Pick<
  AudienceQueryDto,
  'target' | 'tab' | 'roles' | 'classIds' | 'sectionIds' | 'q'
>;

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

  /** Every match for "select all": at most `recipientsMax + 1`, so the caller can refuse above the cap. */
  async matchAll(
    tenantId: string,
    actor: AudienceActor,
    filter: AudienceFilter,
  ): Promise<AudiencePersonDto[]> {
    return (await this.run(tenantId, actor, filter, NOTICE_LIMITS.recipientsMax + 1, 0)).items;
  }

  private async run(
    tenantId: string,
    actor: AudienceActor,
    f: AudienceFilter,
    limit: number,
    offset: number,
  ): Promise<{ items: AudiencePersonDto[]; total: number }> {
    if (ADVANCED_TABS.includes(f.tab)) throw new BadRequestException(NOT_BUILT);
    if (!BUILT_TABS[f.target]?.includes(f.tab)) throw new BadRequestException(BAD_COMBO);
    if (f.roles?.some((r) => ['SUPER_ADMIN', 'PARENT', 'STUDENT'].includes(r)))
      throw new BadRequestException(BAD_COMBO);
    if (
      (f.tab === AudienceTab.ROLE && !f.roles?.length) ||
      (f.tab === AudienceTab.CLASS && !f.classIds?.length) ||
      (f.tab === AudienceTab.SECTION && !f.sectionIds?.length)
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
    }

    const rows: Row[] = await this.dataSource.query(SQL[f.target], [
      tenantId,
      f.tab === AudienceTab.ROLE ? f.roles : null,
      f.tab === AudienceTab.CLASS ? f.classIds : null,
      f.tab === AudienceTab.SECTION ? f.sectionIds : null,
      scope,
      normalizeSearchTerm(f.q),
      limit,
      offset,
    ]);
    return {
      total: rows[0]?.total ?? 0,
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
}
