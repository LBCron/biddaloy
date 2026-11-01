import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditAction, NoticeSmsStatus, NoticeStatus } from '@biddaloy/shared';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { AlertWriterService } from '../attention/engine/alert-writer.service';
import { NoticeAlertsService, NoticeAlertInput } from '../attention/notice/notice-alerts.service';
import { AuditService } from '../audit/audit.service';
import { PushService } from '../push/push.service';
import { SchoolsService } from '../schools/schools.service';
import { StorageService } from '../storage/storage.service';
import { NoticeLinksService } from './links/notice-links.service';
import { Notice } from './entities/notice.entity';
import { NoticeAttachment } from './entities/notice-attachment.entity';
import {
  MSG,
  NoticeActor,
  NoticeRecipientsService,
  PERSON,
  canManage,
  loadOwnedNotice,
} from './notice-recipients.service';
import {
  CreateNoticeDto,
  NoticeDto,
  NoticeListQueryDto,
  NoticePageDto,
  NoticeReportDto,
  NoticeReportQueryDto,
  UpdateNoticeDto,
} from './dto/notice.dto';

const M = {
  expiry: 'শেষ তারিখ আজ বা তার পরে হতে হবে',
  noRecipients: 'অন্তত একজন প্রাপক বেছে নিন',
  notDraft: 'এই নোটিশ আগেই প্রকাশ হয়েছে',
  deleteNotDraft: 'প্রকাশিত নোটিশ মুছে ফেলা যায় না, তুলে নিন',
  notPublished: 'শুধু প্রকাশিত নোটিশে এটি করা যায়',
  withdrawn: 'তুলে নেওয়া নোটিশ বদলানো যায় না',
  smsAsked: 'এসএমএসের অনুরোধ আগেই করা হয়েছে',
  outOfScope: 'আপনার শ্রেণির বাইরের প্রাপক আছে',
  nullField: 'শিরোনাম, লেখা বা কোনো সুইচ খালি রাখা যায় না',
} as const;

/** Which services a publish touches. Pure so the decision table is one readable unit test. */
export function publishPlan(n: { important: boolean; isPublic: boolean; requestSms: boolean }) {
  return { alert: n.important, publicLink: n.isPublic, smsTask: n.requestSms };
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const chunk = <T>(a: T[], n: number) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

@Injectable()
export class NoticesService {
  private readonly logger = new Logger(NoticesService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly recipients: NoticeRecipientsService,
    private readonly alerts: NoticeAlertsService,
    private readonly alertWriter: AlertWriterService,
    private readonly links: NoticeLinksService,
    private readonly push: PushService,
    private readonly audit: AuditService,
    private readonly schools: SchoolsService,
    private readonly storage: StorageService,
  ) {}

  // ---- reads ----

  private async rows(
    tenantId: string,
    f: { authorId?: string; status?: string; q?: string; id?: string },
    limit: number,
    offset: number,
  ): Promise<{ items: NoticeDto[]; total: number }> {
    // A raw date column comes back as a JS Date; the DTO wants the school-local 'YYYY-MM-DD'.
    // Keep comments out of the call below: the Rule 4 guard only scans a query whose first
    // argument starts right after the open bracket.
    const rows = await this.ds.query(
      `SELECT n.*, to_char(n.expires_on, 'YYYY-MM-DD') AS expires_on_text, a.full_name AS author_name,
              (SELECT count(DISTINCT ${PERSON}) FROM notice_recipients r
                WHERE r.notice_id = n.id AND r.tenant_id = n.tenant_id)::int AS people,
              (SELECT count(DISTINCT ${PERSON}) FROM notice_recipients r
                WHERE r.notice_id = n.id AND r.tenant_id = n.tenant_id AND r.seen_at IS NOT NULL)::int AS seen,
              count(*) OVER()::int AS total
         FROM notices n LEFT JOIN users a ON a.id = n.author_user_id
        WHERE n.tenant_id = $1
          AND ($2::uuid IS NULL OR n.author_user_id = $2::uuid)
          AND ($3::text IS NULL OR n.status = $3::text)
          AND ($4::text IS NULL OR n.title ILIKE '%' || $4::text || '%')
          AND ($5::uuid IS NULL OR n.id = $5::uuid)
        ORDER BY n.pinned DESC, COALESCE(n.published_at, n.created_at) DESC, n.id
        LIMIT $6 OFFSET $7`,
      [
        tenantId,
        f.authorId ?? null,
        f.status ?? null,
        normalizeSearchTerm(f.q),
        f.id ?? null,
        limit,
        offset,
      ],
    );
    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((n: any): NoticeDto => ({
        id: n.id,
        title: n.title,
        body: f.id ? n.body : undefined,
        status: n.status,
        important: n.important,
        pinned: n.pinned,
        isPublic: n.is_public,
        expiresOn: n.expires_on_text,
        authorUserId: n.author_user_id,
        authorName: n.author_name,
        publishedAt: iso(n.published_at),
        editedAt: iso(n.edited_at),
        withdrawnAt: iso(n.withdrawn_at),
        smsStatus: n.sms_status,
        recipientCount: n.people,
        seenCount: n.seen,
        createdAt: iso(n.created_at)!,
      })),
    };
  }

  async list(tenantId: string, actor: NoticeActor, q: NoticeListQueryDto): Promise<NoticePageDto> {
    const { items, total } = await this.rows(
      tenantId,
      {
        // a teacher sees their own; NOTICE_MANAGE sees all
        authorId: canManage(actor) ? undefined : actor.userId,
        status: q.status,
        q: q.q,
      },
      q.limit,
      (q.page - 1) * q.limit,
    );
    return { items, total, page: q.page, limit: q.limit };
  }

  async get(tenantId: string, actor: NoticeActor, id: string): Promise<NoticeDto> {
    await loadOwnedNotice(this.ds.manager, tenantId, actor, id);
    const { items } = await this.rows(tenantId, { id }, 1, 0);
    if (!items[0]) throw new NotFoundException(MSG.notFound);
    return items[0];
  }

  async listRecipients(
    tenantId: string,
    actor: NoticeActor,
    id: string,
    page: number,
    limit: number,
  ) {
    await loadOwnedNotice(this.ds.manager, tenantId, actor, id);
    return this.recipients.page(tenantId, id, page, limit);
  }

  async report(
    tenantId: string,
    actor: NoticeActor,
    id: string,
    q: NoticeReportQueryDto,
  ): Promise<NoticeReportDto> {
    await loadOwnedNotice(this.ds.manager, tenantId, actor, id);
    const page = await this.recipients.page(tenantId, id, q.page, q.limit, q.status);
    const [t] = await this.ds.query(
      `SELECT count(DISTINCT ${PERSON})::int AS people,
              (count(DISTINCT ${PERSON}) FILTER (WHERE r.seen_at IS NOT NULL))::int AS seen,
              (count(DISTINCT ${PERSON}) FILTER (WHERE r.link_opened_at IS NOT NULL))::int AS link_opened,
              (count(DISTINCT ${PERSON}) FILTER (WHERE r.acknowledged_at IS NOT NULL))::int AS acknowledged,
              (count(DISTINCT ${PERSON}) FILTER (WHERE r.user_id IS NULL AND COALESCE(g.phone, '') = ''))::int AS unreachable
         FROM notice_recipients r
         LEFT JOIN guardians g ON g.id = r.guardian_id AND g.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 AND r.notice_id = $2`,
      [tenantId, id],
    );
    return {
      ...page,
      totals: {
        people: t.people,
        seen: t.seen,
        linkOpened: t.link_opened,
        acknowledged: t.acknowledged,
        unreachable: t.unreachable,
      },
    };
  }

  // ---- drafts ----

  private async assertExpiry(tenantId: string, expiresOn?: string | null) {
    if (!expiresOn) return;
    if (expiresOn < (await this.schools.todayFor(tenantId)))
      throw new BadRequestException(M.expiry);
  }

  async create(tenantId: string, actor: NoticeActor, dto: CreateNoticeDto): Promise<NoticeDto> {
    await this.assertExpiry(tenantId, dto.expiresOn);
    const saved = await this.ds.getRepository(Notice).save({
      tenant_id: tenantId,
      author_user_id: actor.userId,
      title: dto.title,
      body: dto.body,
      important: dto.important ?? false,
      pinned: dto.pinned ?? false,
      is_public: dto.isPublic ?? false,
      expires_on: dto.expiresOn ?? null,
    });
    return this.get(tenantId, actor, saved.id);
  }

  async remove(tenantId: string, actor: NoticeActor, id: string): Promise<void> {
    const keys = await this.ds.transaction(async (tx) => {
      const n = await loadOwnedNotice(tx, tenantId, actor, id, true);
      if (n.status !== NoticeStatus.DRAFT) throw new ConflictException(M.deleteNotDraft);
      const files = await tx.find(NoticeAttachment, {
        where: { notice_id: id, tenant_id: tenantId },
      });
      await tx.delete(NoticeAttachment, { notice_id: id, tenant_id: tenantId });
      await tx.query(`DELETE FROM notice_recipients WHERE tenant_id = $1 AND notice_id = $2`, [
        tenantId,
        id,
      ]);
      await tx.delete(Notice, { id, tenant_id: tenantId });
      return files.map((f) => f.storage_key);
    });
    await Promise.all(
      keys.map((k) => this.storage.deleteForTenant(k, tenantId).catch(() => undefined)),
    );
  }

  /** Same text, flags and Chosen list; no files, no expiry (a copied date may already be past). */
  async copy(tenantId: string, actor: NoticeActor, id: string): Promise<NoticeDto> {
    const newId = await this.ds.transaction(async (tx) => {
      const n = await loadOwnedNotice(tx, tenantId, actor, id);
      const copy = await tx.save(Notice, {
        tenant_id: tenantId,
        author_user_id: actor.userId,
        title: n.title,
        body: n.body,
        important: n.important,
        pinned: n.pinned,
        is_public: n.is_public,
        expires_on: null,
      });
      await this.recipients.copyInto(tx, tenantId, actor, id, copy.id);
      return copy.id;
    });
    return this.get(tenantId, actor, newId);
  }

  // ---- publish / edit / withdraw ----

  private alertInput(n: Notice, over: Partial<NoticeAlertInput> = {}): NoticeAlertInput {
    return {
      id: n.id,
      tenantId: n.tenant_id,
      title: n.title,
      body: n.body,
      expiresOn: n.expires_on,
      ...over,
    };
  }

  private async alertRecipients(tx: EntityManager, tenantId: string, noticeId: string) {
    const rows: { kind: string; user_id: string }[] = await tx.query(
      `SELECT kind, user_id FROM notice_recipients
        WHERE tenant_id = $1 AND notice_id = $2 AND user_id IS NOT NULL`,
      [tenantId, noticeId],
    );
    return rows.map((r) => ({ userId: r.user_id, portal: r.kind !== 'STAFF' }));
  }

  private async userIds(tx: EntityManager | DataSource, tenantId: string, noticeId: string) {
    const rows: { user_id: string }[] = await tx.query(
      `SELECT DISTINCT user_id FROM notice_recipients
        WHERE tenant_id = $1 AND notice_id = $2 AND user_id IS NOT NULL`,
      [tenantId, noticeId],
    );
    return rows.map((r) => r.user_id);
  }

  /** After commit: a Redis hiccup only means a stale 60 s summary. */
  private async invalidate(tenantId: string, noticeId: string) {
    try {
      await this.alertWriter.invalidateSummary(
        tenantId,
        await this.userIds(this.ds, tenantId, noticeId),
      );
    } catch (e) {
      this.logger.warn(`notice summary invalidation failed: ${(e as Error).message}`);
    }
  }

  /** After commit: the admins who hold an SMS-approval task get a fresh summary too. */
  private async invalidateAlert(tenantId: string, alertId: string | null | undefined) {
    if (!alertId) return;
    try {
      const rows: { user_id: string }[] = await this.ds.query(
        `SELECT user_id FROM alert_recipients WHERE tenant_id = $1 AND alert_id = $2`,
        [tenantId, alertId],
      );
      await this.alertWriter.invalidateSummary(
        tenantId,
        rows.map((r) => r.user_id),
      );
    } catch (e) {
      this.logger.warn(`alert summary invalidation failed: ${(e as Error).message}`);
    }
  }

  /** Detached work (push fan-out): never blocks or fails the request. Tests await `idle()`. */
  private readonly inflight = new Set<Promise<void>>();
  private detach(work: () => Promise<void>) {
    const p: Promise<void> = new Promise<void>((r) => setImmediate(r))
      .then(work)
      .catch((e) => this.logger.warn(`detached notice job failed: ${String(e)}`))
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }
  /** Resolves when every detached job started so far has finished (deterministic wait for tests). */
  async idle(): Promise<void> {
    await Promise.all([...this.inflight]);
  }

  async publish(
    tenantId: string,
    actor: NoticeActor,
    id: string,
    requestSms: boolean,
  ): Promise<NoticeDto> {
    const scope = await this.recipients.sectionScope(tenantId, actor);
    let smsTaskId: string | null = null;
    const notice = await this.ds.transaction(async (tx) => {
      const n = await loadOwnedNotice(tx, tenantId, actor, id, true);
      if (n.status !== NoticeStatus.DRAFT) throw new ConflictException(M.notDraft);
      const [{ c }] = await tx.query(
        `SELECT count(*)::int AS c FROM notice_recipients WHERE tenant_id = $1 AND notice_id = $2`,
        [tenantId, id],
      );
      if (c === 0) throw new BadRequestException(M.noRecipients);
      await this.assertExpiry(tenantId, n.expires_on);
      if (scope !== null) {
        // re-check: sections may have been reassigned since the rows were added
        const [{ bad }] = await tx.query(
          `SELECT count(*)::int AS bad FROM notice_recipients r
             LEFT JOIN students s ON s.id = r.student_id AND s.tenant_id = r.tenant_id
            WHERE r.tenant_id = $1 AND r.notice_id = $2
              AND (r.kind = 'STAFF' OR s.id IS NULL OR s.class_section_id <> ALL($3::uuid[]))`,
          [tenantId, id, scope],
        );
        if (bad > 0) throw new ForbiddenException(M.outOfScope);
      }
      // carry-over 1: a student / guardian who has a login gets their user_id now, so push and reader access work
      await tx.query(
        `UPDATE notice_recipients r SET user_id = s.user_id FROM students s
          WHERE r.kind = 'STUDENT' AND s.id = r.student_id AND s.tenant_id = $1
            AND r.tenant_id = $1 AND r.notice_id = $2 AND r.user_id IS DISTINCT FROM s.user_id`,
        [tenantId, id],
      );
      await tx.query(
        `UPDATE notice_recipients r SET user_id = g.user_id FROM guardians g
          WHERE r.kind = 'GUARDIAN' AND g.id = r.guardian_id AND g.tenant_id = $1
            AND r.tenant_id = $1 AND r.notice_id = $2 AND r.user_id IS DISTINCT FROM g.user_id`,
        [tenantId, id],
      );
      const [{ people }] = await tx.query(
        `SELECT count(DISTINCT ${PERSON})::int AS people FROM notice_recipients r
          WHERE r.tenant_id = $1 AND r.notice_id = $2`,
        [tenantId, id],
      );
      const now = new Date();
      const patch: Partial<Notice> = {
        status: NoticeStatus.PUBLISHED,
        published_at: now,
        recipient_count: people,
      };
      const plan = publishPlan({ important: n.important, isPublic: n.is_public, requestSms });
      if (plan.alert)
        patch.alert_id = await this.alerts.raiseImportant(
          tx,
          this.alertInput(n),
          await this.alertRecipients(tx, tenantId, id),
        );
      if (plan.smsTask) {
        // never sends (D24): an admin approves later
        patch.sms_status = NoticeSmsStatus.PENDING;
        patch.sms_requested_by_user_id = actor.userId;
        patch.sms_requested_at = now;
        patch.sms_task_alert_id = await this.alerts.raiseSmsApprovalTask(tx, this.alertInput(n));
        smsTaskId = patch.sms_task_alert_id;
      }
      await tx.update(Notice, { id, tenant_id: tenantId }, patch);
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Notice',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: actor.userId,
          new_values: { event: 'PUBLISH', recipients: people, important: n.important, requestSms },
        },
        tx,
      );
      return n;
    });

    // The links service uses its own connection, so it runs after our row lock is released.
    // The raw token is NOT returned: publish carries an Idempotency-Key, and the interceptor
    // stores the whole answer in Redis for 24 h. The client asks POST :id/public-link for one.
    if (notice.is_public) {
      try {
        await this.links.createPublicLink({ id, tenant_id: tenantId });
      } catch (e) {
        this.logger.error(`public link failed after publish: ${(e as Error).message}`);
      }
    }
    await this.invalidate(tenantId, id);
    await this.invalidateAlert(tenantId, smsTaskId);
    // D29: push fan-out runs after the response is decided; a failure is only logged
    this.detach(() => this.pushAll(tenantId, notice));
    return this.get(tenantId, actor, id);
  }

  /** D29: a failed push is logged; publish already succeeded. Muted NOTICE category is skipped unless important. */
  private async pushAll(tenantId: string, n: Notice) {
    try {
      const users: { user_id: string; portal: boolean; preferences: any }[] = await this.ds.query(
        `SELECT r.user_id, bool_and(r.kind <> 'STAFF') AS portal, u.preferences
           FROM notice_recipients r JOIN users u ON u.id = r.user_id
          WHERE r.tenant_id = $1 AND r.notice_id = $2
          GROUP BY r.user_id, u.preferences`,
        [tenantId, n.id],
      );
      const send = users.filter(
        (u) =>
          n.important || !(u.preferences?.notifications?.mutedCategories ?? []).includes('NOTICE'),
      );
      const accepted: string[] = [];
      for (const part of chunk(send, 20))
        await Promise.all(
          part.map((u) =>
            this.push
              .sendToUser(u.user_id, tenantId, {
                type: 'notice',
                title: n.title,
                body: n.body.slice(0, 100),
                url: `${u.portal ? '/portal' : '/communications'}/notices/${n.id}`,
              })
              .then((r) => {
                if (r.accepted > 0) accepted.push(u.user_id);
              })
              .catch((e) => this.logger.warn(`notice push failed: ${String(e)}`)),
          ),
        );
      await this.ds.query(
        `UPDATE notice_recipients SET pushed_at = now()
          WHERE tenant_id = $1 AND notice_id = $2 AND user_id = ANY($3::uuid[])`,
        [tenantId, n.id, accepted],
      );
    } catch (e) {
      this.logger.warn(`notice push failed: ${String(e)}`);
    }
  }

  async update(
    tenantId: string,
    actor: NoticeActor,
    id: string,
    dto: UpdateNoticeDto,
  ): Promise<NoticeDto> {
    // PartialType's @IsOptional lets null through; only expiresOn may be cleared (Rule 24: no 500)
    if (
      (['title', 'body', 'important', 'pinned', 'isPublic'] as const).some((k) => dto[k] === null)
    )
      throw new BadRequestException(M.nullField);
    if (dto.expiresOn) await this.assertExpiry(tenantId, dto.expiresOn);
    const after = await this.ds.transaction(async (tx) => {
      const n = await loadOwnedNotice(tx, tenantId, actor, id, true);
      if (n.status === NoticeStatus.WITHDRAWN) throw new ConflictException(M.withdrawn);
      const published = n.status === NoticeStatus.PUBLISHED;
      const patch: Partial<Notice> = {};
      if (dto.title !== undefined) patch.title = dto.title;
      if (dto.body !== undefined) patch.body = dto.body;
      if (dto.important !== undefined) patch.important = dto.important;
      if (dto.pinned !== undefined) patch.pinned = dto.pinned;
      if (dto.isPublic !== undefined) patch.is_public = dto.isPublic;
      if (dto.expiresOn !== undefined) patch.expires_on = dto.expiresOn;

      const changed = (k: keyof Notice) => k in patch && patch[k] !== n[k];
      const textChanged = (['title', 'body', 'expires_on', 'pinned'] as const).some(changed);
      let linkOn = false;
      let linkOff = false;
      let alertTouched = false;
      if (published) {
        // D5: editing a published notice stamps edited_at and sends no push
        if (textChanged) patch.edited_at = new Date();
        const next = { ...n, ...patch };
        if (next.important && (!n.important || textChanged)) {
          patch.alert_id = await this.alerts.raiseImportant(
            tx,
            this.alertInput(n, {
              title: next.title,
              body: next.body,
              expiresOn: next.expires_on,
            }),
            await this.alertRecipients(tx, tenantId, id),
          );
          alertTouched = true;
        } else if (!next.important && n.important && n.alert_id) {
          await this.alerts.withdraw(tx, tenantId, n.alert_id);
          patch.alert_id = null;
          alertTouched = true;
        }
        // every off->on flip mints a fresh token, so a hash a failed turn-off left behind never
        // revives; a flag with no token (an earlier link failure) also counts as "needs a link"
        linkOn = next.is_public && (!n.is_public || !n.public_token_hash);
        if (linkOn && n.public_token_hash) patch.public_token_hash = null;
        linkOff = !next.is_public && (n.is_public || !!n.public_token_hash);
      }
      if (Object.keys(patch).length) await tx.update(Notice, { id, tenant_id: tenantId }, patch);
      if (published && Object.keys(patch).length)
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Notice',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: actor.userId,
            new_values: { event: 'EDIT', fields: Object.keys(patch) },
          },
          tx,
        );
      return { linkOn, linkOff, alertTouched };
    });

    let token: string | null = null;
    if (after.linkOn) {
      try {
        token = await this.links.createPublicLink({ id, tenant_id: tenantId });
      } catch (e) {
        this.logger.error(`public link failed after edit: ${(e as Error).message}`);
      }
    }
    if (after.linkOff) {
      // the edit has committed; resolve() also refuses a public hash while is_public is off
      try {
        await this.links.turnOffPublicLink({ id, tenant_id: tenantId });
      } catch (e) {
        this.logger.error(`public link off failed after edit: ${(e as Error).message}`);
      }
    }
    if (after.alertTouched) await this.invalidate(tenantId, id);
    return { ...(await this.get(tenantId, actor, id)), publicLinkToken: token };
  }

  async withdraw(tenantId: string, actor: NoticeActor, id: string): Promise<NoticeDto> {
    let closedTask: string | null = null;
    await this.ds.transaction(async (tx) => {
      const n = await loadOwnedNotice(tx, tenantId, actor, id, true);
      if (n.status !== NoticeStatus.PUBLISHED) throw new ConflictException(M.notPublished);
      const now = new Date();
      const patch: Partial<Notice> = {
        status: NoticeStatus.WITHDRAWN,
        withdrawn_at: now,
        withdrawn_by_user_id: actor.userId,
      };
      if (n.alert_id) await this.alerts.withdraw(tx, tenantId, n.alert_id);
      if (n.sms_status === NoticeSmsStatus.PENDING) {
        if (n.sms_task_alert_id) await this.alerts.closeTask(tx, tenantId, n.sms_task_alert_id);
        closedTask = n.sms_task_alert_id;
        // declined by the system: no deciding user
        patch.sms_status = NoticeSmsStatus.DECLINED;
        patch.sms_decided_at = now;
      }
      await tx.update(Notice, { id, tenant_id: tenantId }, patch);
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Notice',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: actor.userId,
          new_values: { event: 'WITHDRAW' },
        },
        tx,
      );
    });
    // Links are already dead once the status is WITHDRAWN (resolve checks it); this also clears the hashes.
    try {
      await this.links.killAll(id);
    } catch (e) {
      this.logger.error(`killAll failed after withdraw: ${(e as Error).message}`);
    }
    await this.invalidate(tenantId, id);
    await this.invalidateAlert(tenantId, closedTask);
    return this.get(tenantId, actor, id);
  }

  async requestSms(tenantId: string, actor: NoticeActor, id: string): Promise<NoticeDto> {
    let taskId = '';
    await this.ds.transaction(async (tx) => {
      const n = await loadOwnedNotice(tx, tenantId, actor, id, true);
      if (n.status !== NoticeStatus.PUBLISHED) throw new ConflictException(M.notPublished);
      if (n.sms_status !== NoticeSmsStatus.NONE) throw new ConflictException(M.smsAsked);
      taskId = await this.alerts.raiseSmsApprovalTask(tx, this.alertInput(n));
      await tx.update(
        Notice,
        { id, tenant_id: tenantId },
        {
          sms_status: NoticeSmsStatus.PENDING,
          sms_requested_by_user_id: actor.userId,
          sms_requested_at: new Date(),
          sms_task_alert_id: taskId,
        },
      );
    });
    await this.invalidateAlert(tenantId, taskId);
    return this.get(tenantId, actor, id);
  }

  // ---- public link ----

  async newPublicLink(
    tenantId: string,
    actor: NoticeActor,
    id: string,
  ): Promise<{ token: string }> {
    const n = await loadOwnedNotice(this.ds.manager, tenantId, actor, id);
    if (n.status !== NoticeStatus.PUBLISHED) throw new ConflictException(M.notPublished);
    const token = await this.links.createPublicLink({ id, tenant_id: tenantId });
    await this.ds.transaction(async (tx) => {
      await tx.update(Notice, { id, tenant_id: tenantId }, { is_public: true });
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Notice',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: actor.userId,
          new_values: { event: 'PUBLIC_LINK_ON' },
        },
        tx,
      );
    });
    return { token };
  }

  async turnOffPublicLink(tenantId: string, actor: NoticeActor, id: string): Promise<void> {
    await loadOwnedNotice(this.ds.manager, tenantId, actor, id);
    // flag + audit commit first; the links service has its own connection, so it runs after the lock is gone
    await this.ds.transaction(async (tx) => {
      await tx.update(Notice, { id, tenant_id: tenantId }, { is_public: false });
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Notice',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: actor.userId,
          new_values: { event: 'PUBLIC_LINK_OFF' },
        },
        tx,
      );
    });
    // is_public is already false, so resolve() refuses the old hash even if this clean-up fails,
    // and the next turn-on mints a new token (update()).
    try {
      await this.links.turnOffPublicLink({ id, tenant_id: tenantId });
    } catch (e) {
      this.logger.error(`public link off failed: ${(e as Error).message}`);
    }
  }
}
