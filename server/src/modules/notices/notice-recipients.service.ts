import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  NOTICE_LIMITS,
  NoticeRecipientKind,
  NoticeStatus,
  Permission,
  UserRole,
  roleHasPermission,
} from '@biddaloy/shared';
import { AudienceService, AudienceFilter } from '../audience/audience.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { Notice } from './entities/notice.entity';
import {
  NoticeRecipientDto,
  NoticeRecipientPageDto,
  NoticeReportStatus,
  RecipientRefDto,
  AddRecipientsResultDto,
} from './dto/notice.dto';

export interface NoticeActor {
  userId: string;
  role: string;
}

export const MSG = {
  notFound: 'Notice not found',
  notDraft: 'প্রাপক শুধু খসড়া নোটিশে বদলানো যায়',
  // the cap counts rows: a guardian of 2 children is 2 rows (recipient_count still counts people)
  cap: 'সর্বোচ্চ ৫,০০০ জন (অভিভাবককে প্রতিটি সন্তানের জন্য আলাদা গোনা হয়)',
  staffForbidden: 'You do not have access to this audience',
} as const;

/** One distinct person per row: guardian, else student, else staff user. A guardian with 3 children is 1 person. */
export const PERSON = 'COALESCE(r.guardian_id, r.student_id, r.user_id)';

export const canManage = (actor: NoticeActor) =>
  roleHasPermission(actor.role as UserRole, Permission.NOTICE_MANAGE);

/**
 * Loads a notice of this tenant that the actor may touch (author, or NOTICE_MANAGE holder).
 * Anything else is a 404, never a 403 (D20): a teacher cannot learn another's notice exists.
 */
export async function loadOwnedNotice(
  em: EntityManager,
  tenantId: string,
  actor: NoticeActor,
  id: string,
  lock = false,
): Promise<Notice> {
  const qb = em
    .getRepository(Notice)
    .createQueryBuilder('n')
    .where('n.id = :id AND n.tenant_id = :tenantId', { id, tenantId });
  if (lock) qb.setLock('pessimistic_write');
  const notice = await qb.getOne();
  if (!notice || (!canManage(actor) && notice.author_user_id !== actor.userId))
    throw new NotFoundException(MSG.notFound);
  return notice;
}

/**
 * A student or guardian who got a login after publish has rows with user_id NULL. Every reader path
 * (list, open, acknowledge, file) calls this first, so that person's current login owns their rows.
 * PUBLISHED notices only: readers never see drafts, publish copies user_id itself, and a draft
 * being published reads as DRAFT here, so the claim never locks rows against publish.
 * ponytail: write-on-read, claim only. A login unlinked later keeps its rows until the new login
 * reads; refresh where accounts get linked if that ever matters.
 */
export async function claimRecipientRows(
  q: Pick<EntityManager, 'query'>,
  tenantId: string,
  userId: string,
): Promise<void> {
  await q.query(
    `UPDATE notice_recipients r SET user_id = s.user_id FROM students s
      WHERE r.kind = 'STUDENT' AND r.tenant_id = $1 AND s.tenant_id = $1 AND s.id = r.student_id
        AND s.user_id = $2::uuid AND r.user_id IS DISTINCT FROM $2::uuid
        AND EXISTS (SELECT 1 FROM notices n WHERE n.id = r.notice_id AND n.tenant_id = $1
                     AND n.status = 'PUBLISHED')`,
    [tenantId, userId],
  );
  await q.query(
    `UPDATE notice_recipients r SET user_id = g.user_id FROM guardians g
      WHERE r.kind = 'GUARDIAN' AND r.tenant_id = $1 AND g.tenant_id = $1 AND g.id = r.guardian_id
        AND g.user_id = $2::uuid AND r.user_id IS DISTINCT FROM $2::uuid
        AND EXISTS (SELECT 1 FROM notices n WHERE n.id = r.notice_id AND n.tenant_id = $1
                     AND n.status = 'PUBLISHED')`,
    [tenantId, userId],
  );
}

// Fixed SQL, every id a parameter (Rule 4). Each statement re-checks tenant ownership, so a foreign
// or made-up id is silently skipped. $1 tenant, $2 notice, $3.. ids, last = teacher sections|null.
const STAFF_INSERT = `
  INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id)
  SELECT $1, $2, 'STAFF', u FROM unnest($3::uuid[]) AS u
   WHERE EXISTS (SELECT 1 FROM user_tenants ut JOIN users x ON x.id = ut.user_id
                  AND x.status = 'ACTIVE' AND x.deleted_at IS NULL
                  WHERE ut.user_id = u AND ut.tenant_id = $1 AND ut.deleted_at IS NULL
                    AND ut.role::text NOT IN ('SUPER_ADMIN','PARENT','STUDENT'))
  ON CONFLICT DO NOTHING RETURNING id`;
const STUDENT_INSERT = `
  INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id, student_id)
  SELECT $1, $2, 'STUDENT', s.user_id, s.id FROM students s
   WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
     AND s.id = ANY($3::uuid[]) AND ($4::uuid[] IS NULL OR s.class_section_id = ANY($4::uuid[]))
  ON CONFLICT DO NOTHING RETURNING id`;
const GUARDIAN_INSERT = `
  INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id, student_id, guardian_id)
  SELECT $1, $2, 'GUARDIAN', g.user_id, s.id, g.id
    FROM unnest($3::uuid[], $4::uuid[]) AS v(guardian_id, student_id)
    JOIN students s ON s.id = v.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
         AND s.enrollment_status = 'ACTIVE'
    JOIN guardians g ON g.id = v.guardian_id AND g.tenant_id = $1 AND g.deleted_at IS NULL
    JOIN student_guardians sg ON sg.student_id = s.id AND sg.guardian_id = g.id
   WHERE ($5::uuid[] IS NULL OR s.class_section_id = ANY($5::uuid[]))
  ON CONFLICT DO NOTHING RETURNING id`;

@Injectable()
export class NoticeRecipientsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audience: AudienceService,
    private readonly teacherScope: TeacherScopeService,
  ) {}

  /** null = no limit; array = a teacher's assigned sections. */
  sectionScope(tenantId: string, actor: NoticeActor): Promise<string[] | null> {
    return this.teacherScope.sectionScope({ role: actor.role, userId: actor.userId, tenantId });
  }

  async insertRefs(
    tx: EntityManager,
    tenantId: string,
    noticeId: string,
    scope: string[] | null,
    refs: Pick<RecipientRefDto, 'kind' | 'userId' | 'studentId' | 'guardianId'>[],
  ): Promise<number> {
    const staff = refs.filter((r) => r.kind === NoticeRecipientKind.STAFF && r.userId);
    // A teacher's notice holds only students and guardians of their own sections (D2).
    if (scope !== null && staff.length) throw new ForbiddenException(MSG.staffForbidden);
    const students = refs.filter((r) => r.kind === NoticeRecipientKind.STUDENT && r.studentId);
    const guardians = refs.filter(
      (r) => r.kind === NoticeRecipientKind.GUARDIAN && r.studentId && r.guardianId,
    );
    let added = 0;
    const run = async (sql: string, params: unknown[]) => {
      // TypeORM returns the RETURNING rows for INSERT
      added += ((await tx.query(sql, params)) as unknown[]).length;
    };
    const base = [tenantId, noticeId];
    if (staff.length) await run(STAFF_INSERT, [...base, staff.map((r) => r.userId)]);
    if (students.length)
      await run(STUDENT_INSERT, [...base, students.map((r) => r.studentId), scope]);
    if (guardians.length)
      await run(GUARDIAN_INSERT, [
        ...base,
        guardians.map((r) => r.guardianId),
        guardians.map((r) => r.studentId),
        scope,
      ]);
    return added;
  }

  /** `rows` = recipient rows; `people` = distinct people (a guardian with 2 children is 1; the cap counts people). */
  private async total(
    tx: EntityManager,
    tenantId: string,
    noticeId: string,
  ): Promise<{ rows: number; people: number }> {
    const [counts] = await tx.query(
      `SELECT count(*)::int AS rows,
              count(DISTINCT COALESCE(r.guardian_id, r.student_id, r.user_id))::int AS people
         FROM notice_recipients r WHERE r.tenant_id = $1 AND r.notice_id = $2`,
      [tenantId, noticeId],
    );
    return counts;
  }

  /** Runs `fill` on a locked DRAFT, then refuses (and rolls back) if the list grew past the cap. */
  private async changeDraft(
    tenantId: string,
    actor: NoticeActor,
    id: string,
    fill: (tx: EntityManager, notice: Notice) => Promise<number>,
  ): Promise<AddRecipientsResultDto> {
    return this.ds.transaction(async (tx) => {
      const notice = await loadOwnedNotice(tx, tenantId, actor, id, true);
      if (notice.status !== NoticeStatus.DRAFT) throw new ConflictException(MSG.notDraft);
      const added = await fill(tx, notice);
      const { rows, people } = await this.total(tx, tenantId, id);
      if (people > NOTICE_LIMITS.recipientsMax) throw new BadRequestException(MSG.cap);
      return { added, total: rows };
    });
  }

  async add(tenantId: string, actor: NoticeActor, id: string, refs: RecipientRefDto[]) {
    const scope = await this.sectionScope(tenantId, actor);
    return this.changeDraft(tenantId, actor, id, (tx) =>
      this.insertRefs(tx, tenantId, id, scope, refs),
    );
  }

  /** "Select all": AudienceService enforces the teacher scope; above the cap nothing is stored. */
  async addMatching(tenantId: string, actor: NoticeActor, id: string, filter: AudienceFilter) {
    // ownership and DRAFT first: a foreign or published notice never triggers the audience query
    const notice = await loadOwnedNotice(this.ds.manager, tenantId, actor, id);
    if (notice.status !== NoticeStatus.DRAFT) throw new ConflictException(MSG.notDraft);
    const people = await this.audience.matchAll(tenantId, actor, filter);
    const distinct = new Set(people.map((p) => p.guardianId ?? p.studentId ?? p.userId));
    if (distinct.size > NOTICE_LIMITS.recipientsMax) throw new BadRequestException(MSG.cap);
    const scope = await this.sectionScope(tenantId, actor);
    return this.changeDraft(tenantId, actor, id, async (tx) => {
      let added = 0;
      // chunks keep each statement's parameter arrays small
      for (let i = 0; i < people.length; i += 1000)
        added += await this.insertRefs(tx, tenantId, id, scope, people.slice(i, i + 1000));
      return added;
    });
  }

  async remove(tenantId: string, actor: NoticeActor, id: string, ids: string[]): Promise<void> {
    await this.ds.transaction(async (tx) => {
      const notice = await loadOwnedNotice(tx, tenantId, actor, id, true);
      if (notice.status !== NoticeStatus.DRAFT) throw new ConflictException(MSG.notDraft);
      await tx.query(
        `DELETE FROM notice_recipients WHERE tenant_id = $1 AND notice_id = $2 AND id = ANY($3::uuid[])`,
        [tenantId, id, ids],
      );
    });
  }

  /** Shared by the Chosen-list page and the report. `status` is bound as a parameter, never spliced into SQL. */
  async page(
    tenantId: string,
    noticeId: string,
    page: number,
    limit: number,
    status?: NoticeReportStatus,
  ): Promise<NoticeRecipientPageDto> {
    const rows = await this.ds.query(
      `SELECT r.id, r.kind, r.user_id IS NOT NULL AS has_login, r.seen_at, r.link_opened_at, r.acknowledged_at,
              COALESCE(g.full_name, s.full_name, u.full_name) AS name,
              CASE WHEN r.kind = 'GUARDIAN' THEN s.full_name END AS for_student,
              (r.user_id IS NULL AND COALESCE(g.phone, '') = '') AS unreachable,
              count(*) OVER()::int AS total
         FROM notice_recipients r
         LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN students s ON s.id = r.student_id AND s.tenant_id = r.tenant_id
         LEFT JOIN guardians g ON g.id = r.guardian_id AND g.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 AND r.notice_id = $2 AND ($5::text IS NULL OR CASE $5::text
              WHEN 'SEEN' THEN r.seen_at IS NOT NULL
              WHEN 'UNSEEN' THEN r.seen_at IS NULL
              WHEN 'ACKNOWLEDGED' THEN r.acknowledged_at IS NOT NULL
              WHEN 'UNREACHABLE' THEN (r.user_id IS NULL AND COALESCE(g.phone, '') = '')
            END)
        ORDER BY name, r.id
        LIMIT $3 OFFSET $4`,
      [tenantId, noticeId, limit, (page - 1) * limit, status ?? null],
    );
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    const items: NoticeRecipientDto[] = rows.map((r: any) => ({
      id: r.id,
      kind: r.kind,
      name: r.name ?? '',
      forStudent: r.for_student,
      hasLogin: r.has_login,
      seenAt: iso(r.seen_at),
      linkOpenedAt: iso(r.link_opened_at),
      acknowledgedAt: iso(r.acknowledged_at),
      unreachable: r.unreachable,
    }));
    return { items, total: rows[0]?.total ?? 0, page, limit };
  }

  /** Copies the Chosen list onto a new draft, re-checking each person against today's roll and the actor's scope. */
  async copyInto(
    tx: EntityManager,
    tenantId: string,
    actor: NoticeActor,
    fromId: string,
    toId: string,
  ): Promise<void> {
    const rows = await tx.query(
      `SELECT kind, user_id AS "userId", student_id AS "studentId", guardian_id AS "guardianId"
         FROM notice_recipients WHERE tenant_id = $1 AND notice_id = $2`,
      [tenantId, fromId],
    );
    const scope = await this.sectionScope(tenantId, actor);
    // A STUDENT / GUARDIAN row's login is looked up again on insert, so userId is dropped there.
    await this.insertRefs(tx, tenantId, toId, scope, rows);
  }
}
