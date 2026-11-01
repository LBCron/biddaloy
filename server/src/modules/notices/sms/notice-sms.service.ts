import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  NoticeRecipientKind,
  NoticeSmsStatus,
  NoticeStatus,
  countSmsSegments,
  AuditAction,
} from '@biddaloy/shared';
import { AlertWriterService } from '../../attention/engine/alert-writer.service';
import { NoticeAlertsService } from '../../attention/notice/notice-alerts.service';
import { AuditService } from '../../audit/audit.service';
import { COMMUNICATIONS_QUEUE } from '../../communications/communications.constants';
import { CommunicationLog } from '../../communications/entities/communication-log.entity';
import { SmsCreditService } from '../../communications/credits/sms-credit.service';
import { INSUFFICIENT_SMS_CREDIT } from '../../communications/credits/insufficient-sms-credit.constants';
import { addressForMedium } from '../../communications/reminder-recipients.util';
import { resolvePublicAppUrl } from '../../invoices/public-app-url.util';
import { SchoolsService } from '../../schools/schools.service';
import { User } from '../../users/entities/user.entity';
import { Notice } from '../entities/notice.entity';
import { NoticeRecipient } from '../entities/notice-recipient.entity';
import { NoticeLinksService } from '../links/notice-links.service';
import { NoticeSmsViewDto, SmsDecisionDto } from './dto/notice-sms.dto';

// Fixed sentences: never echo input (Rule 23).
const M = {
  notFound: 'নোটিশ পাওয়া যায়নি',
  notPending: 'এই নোটিশের এসএমএস অনুরোধ এখন অপেক্ষায় নেই',
  notLive: 'নোটিশটি প্রকাশিত নেই, তুলে নেওয়া হয়েছে বা মেয়াদ শেষ',
  credit: 'এসএমএস ক্রেডিট যথেষ্ট নয়',
};

/** `01712345234` -> `01•••••234`. */
export function maskSmsPhone(phone: string): string {
  if (phone.length <= 5) return `${phone.slice(0, 1)}••••`;
  return `${phone.slice(0, 2)}${'•••••'}${phone.slice(-3)}`;
}

const LINK_PLACEHOLDER = '{link}';

interface Row {
  recipient: NoticeRecipient;
  address: string | null;
  optedOut: boolean;
}

/**
 * [53.5.01] The only code that queues a notice SMS (D24). Approve runs once per notice:
 * lock row -> reserve credit -> personal links -> one CommunicationLog per phone -> queue.
 */
@Injectable()
export class NoticeSmsService {
  private readonly logger = new Logger(NoticeSmsService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(COMMUNICATIONS_QUEUE) private readonly queue: Queue,
    private readonly credits: SmsCreditService,
    private readonly links: NoticeLinksService,
    private readonly alerts: NoticeAlertsService,
    private readonly alertWriter: AlertWriterService,
    private readonly audit: AuditService,
    private readonly schools: SchoolsService,
    private readonly config: ConfigService,
  ) {}

  // ---- helpers ----

  private async lockNotice(em: EntityManager, tenantId: string, id: string): Promise<Notice> {
    const n = await em
      .getRepository(Notice)
      .createQueryBuilder('n')
      .where('n.id = :id AND n.tenant_id = :tenantId', { id, tenantId })
      .setLock('pessimistic_write')
      .getOne();
    if (!n) throw new NotFoundException(M.notFound);
    return n;
  }

  private async isLive(tenantId: string, n: Notice): Promise<boolean> {
    if (n.status !== NoticeStatus.PUBLISHED || n.withdrawn_at) return false;
    if (n.expires_on && n.expires_on < (await this.schools.todayFor(tenantId))) return false;
    return true;
  }

  private async guardianRows(
    em: EntityManager,
    tenantId: string,
    noticeId: string,
  ): Promise<Row[]> {
    const rs = await em.find(NoticeRecipient, {
      where: { tenant_id: tenantId, notice_id: noticeId, kind: NoticeRecipientKind.GUARDIAN },
      relations: { guardian: true, student: true },
      order: { created_at: 'ASC', id: 'ASC' } as never,
    });
    return rs.map((recipient) => ({
      recipient,
      // Soft-deleted guardian loads as null: counts as "no phone".
      address: recipient.guardian
        ? addressForMedium(recipient.guardian, CommunicationMedium.SMS)
        : null,
      optedOut: recipient.guardian ? !recipient.guardian.notifications_enabled : false,
    }));
  }

  /** Rows that will get an SMS: wanted, not opted out, has a phone, one per phone. */
  private sendable(rows: Row[]): Row[] {
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const r of rows) {
      if (!r.recipient.sms_wanted || r.optedOut || !r.address) continue;
      if (seen.has(r.address)) continue;
      seen.add(r.address);
      out.push(r);
    }
    return out;
  }

  private async invalidate(tenantId: string, alertId: string | null) {
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

  // ---- reads ----

  async view(tenantId: string, id: string, page: number, limit: number): Promise<NoticeSmsViewDto> {
    const n = await this.ds.getRepository(Notice).findOne({ where: { id, tenant_id: tenantId } });
    if (!n || n.sms_status === NoticeSmsStatus.NONE) throw new NotFoundException(M.notFound);
    const requester = n.sms_requested_by_user_id
      ? await this.ds
          .getRepository(User)
          .findOne({ where: { id: n.sms_requested_by_user_id }, select: { full_name: true } })
      : null;
    const rows = await this.guardianRows(this.ds.manager, tenantId, id);
    const will = this.sendable(rows);
    const text = `${n.title} ${LINK_PLACEHOLDER}`;
    // The real link is 43 random chars after the app URL; count the placeholder as that long.
    const sample = text.replace(LINK_PLACEHOLDER, `${this.linkBase()}/n/${'x'.repeat(43)}`);
    const seg = countSmsSegments(sample);
    return {
      status: n.sms_status,
      requester: requester?.full_name ?? null,
      requestedAt: n.sms_requested_at ? n.sms_requested_at.toISOString() : null,
      live: await this.isLive(tenantId, n),
      items: rows.slice((page - 1) * limit, page * limit).map((r) => ({
        id: r.recipient.id,
        guardianName: r.recipient.guardian?.full_name ?? '',
        forStudent: r.recipient.student?.full_name ?? null,
        reachable: !r.optedOut && !!r.address,
        smsWanted: r.recipient.sms_wanted,
        phone: r.address ? maskSmsPhone(r.address) : null,
      })),
      total: rows.length,
      page,
      limit,
      counts: {
        willSend: will.length,
        optedOut: rows.filter((r) => r.optedOut).length,
        noPhone: rows.filter((r) => !r.optedOut && !r.address).length,
      },
      sms: {
        text,
        length: seg.chars,
        segments: seg.segments,
        encoding: seg.encoding,
        creditCost: seg.segments * will.length,
      },
    };
  }

  private linkBase(): string {
    return resolvePublicAppUrl(this.config);
  }

  // ---- writes ----

  async setWanted(
    tenantId: string,
    id: string,
    ids: string[],
    smsWanted: boolean,
  ): Promise<{ updated: number }> {
    return this.ds.transaction(async (tx) => {
      const n = await this.lockNotice(tx, tenantId, id);
      if (n.sms_status !== NoticeSmsStatus.PENDING) throw new ConflictException(M.notPending);
      const res = await tx.update(
        NoticeRecipient,
        { tenant_id: tenantId, notice_id: id, kind: NoticeRecipientKind.GUARDIAN, id: In(ids) },
        { sms_wanted: smsWanted },
      );
      return { updated: res.affected ?? 0 };
    });
  }

  async decline(tenantId: string, id: string, userId: string): Promise<SmsDecisionDto> {
    let taskId: string | null = null;
    await this.ds.transaction(async (tx) => {
      const n = await this.lockNotice(tx, tenantId, id);
      if (n.sms_status !== NoticeSmsStatus.PENDING) throw new ConflictException(M.notPending);
      taskId = n.sms_task_alert_id;
      if (taskId) await this.alerts.closeTask(tx, tenantId, taskId);
      await tx.update(
        Notice,
        { id, tenant_id: tenantId },
        {
          sms_status: NoticeSmsStatus.DECLINED,
          sms_decided_by_user_id: userId,
          sms_decided_at: new Date(),
        },
      );
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Notice',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: { event: 'SMS_DECLINE' },
        },
        tx,
      );
    });
    await this.invalidate(tenantId, taskId);
    return { status: NoticeSmsStatus.DECLINED, queued: 0 };
  }

  async approve(tenantId: string, id: string, userId: string): Promise<SmsDecisionDto> {
    // Fresh per attempt: a rolled-back attempt's settled reservation must never block the retry.
    const batchId = randomUUID();
    const batchKey = `batch:${batchId}`;
    let reserved = false;
    let taskId: string | null = null;
    let linkedIds: string[] = [];
    const jobs: { logId: string; segments: number }[] = [];
    try {
      await this.ds.transaction(async (tx) => {
        const n = await this.lockNotice(tx, tenantId, id);
        if (n.sms_status !== NoticeSmsStatus.PENDING) throw new ConflictException(M.notPending);
        if (!(await this.isLive(tenantId, n))) throw new ConflictException(M.notLive);
        taskId = n.sms_task_alert_id;

        const will = this.sendable(await this.guardianRows(tx, tenantId, id));
        const base = this.linkBase();
        const bodyFor = (token: string) => `${n.title} ${base}/n/${token}`;
        // A token is always 43 chars (32 bytes base64url), so the segment count is known up front.
        const segments = countSmsSegments(bodyFor('x'.repeat(43))).segments;
        // Credit units are whole segments (integers): same math as the reminder path.
        const total = segments * will.length;
        // D24 order: credit first, before anything else is written.
        if (will.length > 0) {
          const outcome = await this.credits.reserveIfMetered(tenantId, total, batchId);
          if (typeof outcome === 'object') {
            throw new ConflictException({
              message: M.credit,
              details: {
                code: INSUFFICIENT_SMS_CREDIT,
                required: total,
                available: outcome.available,
              },
            });
          }
          reserved = outcome === 'RESERVED';
        }

        if (taskId) await this.alerts.closeTask(tx, tenantId, taskId);
        await tx.update(
          Notice,
          { id, tenant_id: tenantId },
          {
            sms_status: NoticeSmsStatus.APPROVED,
            sms_decided_by_user_id: userId,
            sms_decided_at: new Date(),
          },
        );
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Notice',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            new_values: { event: 'SMS_APPROVE', queued: will.length },
          },
          tx,
        );

        // Last step before commit: createPersonalLinks writes outside this transaction (it lives
        // in notices/links), so only the log inserts can still fail after it, and the catch
        // below clears the hashes if they do.
        // ponytail: links commit on their own; give createPersonalLinks a tx param to drop the cleanup.
        if (will.length === 0) return;
        const tokens = await this.links.createPersonalLinks(
          id,
          will.map((r) => r.recipient.id),
        );
        linkedIds = tokens.map((t) => t.recipientId);
        const tokenOf = new Map(tokens.map((t) => [t.recipientId, t.token]));
        for (const r of will) {
          const token = tokenOf.get(r.recipient.id);
          if (!token) continue;
          const log = await tx.save(
            CommunicationLog,
            tx.create(CommunicationLog, {
              tenant_id: tenantId,
              medium: CommunicationMedium.SMS,
              recipient_address: r.address as string,
              recipient_name: (r.recipient.guardian?.full_name ?? '').slice(0, 100),
              message_body: bodyFor(token),
              subject: 'Notice',
              student_id: r.recipient.student_id,
              guardian_id: r.recipient.guardian_id,
              sent_by_user_id: userId,
              status: CommunicationStatus.QUEUED,
              trigger: CommunicationTrigger.MANUAL,
              reference_key: `notice-sms:${id}:${r.recipient.id}`,
            }),
          );
          await tx.update(
            NoticeRecipient,
            { id: r.recipient.id, tenant_id: tenantId },
            { communication_log_id: log.id },
          );
          jobs.push({ logId: log.id, segments });
        }
      });
    } catch (e) {
      // Reservation and links are committed on their own: undo both when the rest rolled back.
      if (reserved) {
        try {
          await this.credits.settle(tenantId, batchKey, 'RELEASE');
        } catch (re) {
          this.logger.error(`notice sms credit release failed: ${(re as Error).message}`);
        }
      }
      if (linkedIds.length > 0) {
        try {
          await this.ds
            .getRepository(NoticeRecipient)
            .update(
              { tenant_id: tenantId, notice_id: id, id: In(linkedIds) },
              { link_token_hash: null },
            );
        } catch (le) {
          this.logger.error(`notice sms link cleanup failed: ${(le as Error).message}`);
        }
      }
      throw e;
    }

    // After commit. A failed enqueue gives its credit back and fails only that log.
    for (const j of jobs) {
      try {
        await this.queue.add('send', {
          logId: j.logId,
          ...(reserved ? { batchId, segments: j.segments } : {}),
        });
      } catch (e) {
        this.logger.warn(`notice sms enqueue failed for log ${j.logId}: ${(e as Error).message}`);
        try {
          if (reserved) await this.credits.releaseForLog(tenantId, j.logId, j.segments, batchId);
          await this.ds.getRepository(CommunicationLog).update(
            { id: j.logId, tenant_id: tenantId },
            {
              status: CommunicationStatus.FAILED,
              metadata: { error: 'Failed to enqueue for delivery' } as never,
            },
          );
        } catch (ue) {
          this.logger.error(`notice sms failure bookkeeping failed: ${(ue as Error).message}`);
        }
      }
    }
    await this.invalidate(tenantId, taskId);
    return { status: NoticeSmsStatus.APPROVED, queued: jobs.length };
  }
}
