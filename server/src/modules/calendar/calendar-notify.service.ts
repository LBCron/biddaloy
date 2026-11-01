import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';
import {
  CalendarAudience,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  countSmsSegments,
  EnrollmentStatus,
  ReminderBatchStatus,
  STAFF_ROLES,
  UserStatus,
} from '@biddaloy/shared';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventClass } from './entities/calendar-event-class.entity';
import { Student } from '../students/entities/student.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { recordBatchOutcome } from '../communications/reminder-batch-counters';
import { resolveReminderAudience } from '../communications/reminder-recipients.util';
import { School } from '../schools/entities/school.entity';
import { formatFeeNotificationDueDate } from '../communications/fee-notification-template.util';
import { resolveTemplateLocale } from '../account-access/account-access-templates';
import { PushService } from '../push/push.service';

export interface CalendarNotifyOpts {
  notify?: boolean;
  notifySms?: boolean;
  /** Who to attribute the SMS `ReminderBatch`/audit trail to — falls back
   * to the event's own `updated_by_user_id`/`created_by_user_id` when the
   * caller doesn't pass one. */
  userId?: string;
}

interface ResolvedRecipients {
  /** Distinct user ids to push to — every role that can see the event. */
  pushUserIds: string[];
  /** Distinct guardians to SMS — only ever populated for an `ALL`
   * (family-visible) event; `STAFF` events never reach a guardian phone. */
  smsGuardians: { id: string; full_name: string; phone: string }[];
}

/**
 * Fills the [17.1.2] stub. Push goes straight through `PushService` (no
 * queue, no credit ledger — web push has no per-send cost). SMS reuses the
 * same `ReminderBatch` + `CommunicationLog` + `COMMUNICATIONS_QUEUE`
 * primitive `absence-notice.service.ts` uses, *not*
 * `SingleReminderService.sendSingle` — see the plan comment on #713 for
 * why the ticket's literal wording doesn't fit here.
 */
@Injectable()
export class CalendarNotifyService {
  private readonly logger = new Logger(CalendarNotifyService.name);

  constructor(
    @InjectRepository(CalendarEventClass)
    private readonly eventClassRepo: Repository<CalendarEventClass>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    @InjectRepository(ReminderBatch)
    private readonly batchRepo: Repository<ReminderBatch>,
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly pushService: PushService,
    private readonly smsCreditService: SmsCreditService,
  ) {}

  async eventCreated(event: CalendarEvent, opts?: CalendarNotifyOpts): Promise<void> {
    await this.notifyOne(event, opts, 'created');
  }

  async eventUpdated(event: CalendarEvent, opts?: CalendarNotifyOpts): Promise<void> {
    await this.notifyOne(event, opts, 'updated');
  }

  /** One push per user, summarising the whole import batch — never one
   * push per imported event, which would flood a guardian who happens to
   * be linked to several affected classes. SMS is intentionally not sent
   * for imports: the ticket's SMS step is scoped to a single event's own
   * `notify_sms` flag, and an import batch has no single flag to charge
   * credits against — see the plan comment's documented deviation. */
  async eventsImported(events: CalendarEvent[], opts?: CalendarNotifyOpts): Promise<void> {
    // Same D9 guard as notifyOne — a batch that included left-as-draft
    // rows must not count or notify for them.
    const publishedEvents = events.filter((event) => event.published_at !== null);
    if (!opts?.notify || publishedEvents.length === 0) return;

    const tenantId = publishedEvents[0].tenant_id;
    const userIds = new Set<string>();
    for (const event of publishedEvents) {
      const { pushUserIds } = await this.resolveRecipients(event, tenantId);
      pushUserIds.forEach((id) => userIds.add(id));
    }

    const title = 'Calendar updated';
    const body = `${publishedEvents.length} new calendar event${publishedEvents.length === 1 ? '' : 's'} added`;
    const url = '/calendar';

    const results = await Promise.allSettled(
      [...userIds].map((userId) =>
        this.pushService.sendToUser(userId, tenantId, {
          type: 'calendar.imported',
          title,
          body,
          url,
        }),
      ),
    );
    this.logFailures('eventsImported', results);
  }

  // -----------------------------------------------------------------
  // Shared create/update path
  // -----------------------------------------------------------------

  private async notifyOne(
    event: CalendarEvent,
    opts: CalendarNotifyOpts | undefined,
    action: 'created' | 'updated',
  ): Promise<void> {
    // Defense-in-depth: both callers only pass notify:true for an
    // already-published event today, but this guard means a draft can
    // never reach a recipient regardless of what a future caller does —
    // same D9 rule the rest of the calendar module enforces.
    if (!opts?.notify || event.published_at === null) return;

    // The whole body is best-effort: calendar-events.service.ts's callers
    // (eventCreated/eventUpdated) have no try/catch of their own, so
    // nothing here — recipient resolution, push, or SMS (credit
    // reservation, batch/log persistence, queue) — may propagate.
    try {
      const tenantId = event.tenant_id;
      const { pushUserIds, smsGuardians } = await this.resolveRecipients(event, tenantId);

      const title = action === 'created' ? 'New calendar event' : 'Calendar event updated';
      const body = `${event.name} — ${event.start_date}`;
      const url = `/calendar?date=${event.start_date}`;

      const pushResults = await Promise.allSettled(
        pushUserIds.map((userId) =>
          this.pushService.sendToUser(userId, tenantId, {
            type: 'calendar.event',
            title,
            body,
            url,
          }),
        ),
      );
      this.logFailures(`notifyOne:${action}`, pushResults);

      if (opts.notifySms) {
        try {
          await this.sendSms(event, smsGuardians, opts);
        } catch (error) {
          this.logger.error(
            `notifyOne:${action}: SMS send failed for event ${event.id}: ${String(error)}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `notifyOne:${action}: notification failed for event ${event.id}: ${String(error)}`,
      );
    }
  }

  private logFailures(where: string, results: PromiseSettledResult<unknown>[]): void {
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0) {
      this.logger.warn(`${where}: ${failures}/${results.length} push sends failed`);
    }
  }

  // -----------------------------------------------------------------
  // Recipient resolution
  // -----------------------------------------------------------------

  /**
   * Staff (every `STAFF_ROLES` role — which already includes TEACHER) is
   * always notified tenant-wide, for both `ALL` and `STAFF` audience
   * events — "all staff" per the ticket's own wording, so a class-scoped
   * `TeacherClassSection` lookup would only ever re-derive a subset of
   * what this already includes. Family (guardians + the students
   * themselves) is only ever added for `ALL` audience events, scoped to
   * the event's linked classes when it has any.
   */
  private async resolveRecipients(
    event: CalendarEvent,
    tenantId: string,
  ): Promise<ResolvedRecipients> {
    const pushUserIds = new Set<string>();
    const smsGuardians = new Map<string, { id: string; full_name: string; phone: string }>();

    const staffMemberships = await this.userTenantRepo.find({
      where: { tenant_id: tenantId, role: In(STAFF_ROLES as unknown as string[]) },
      relations: ['user'],
    });
    for (const membership of staffMemberships) {
      if (membership.user?.status === UserStatus.ACTIVE) {
        pushUserIds.add(membership.user_id);
      }
    }

    if (event.audience === CalendarAudience.STAFF) {
      return { pushUserIds: [...pushUserIds], smsGuardians: [] };
    }

    // ALL audience — add family, scoped to the event's linked classes
    // when it has any (an event with no class links is visible tenant-wide).
    const links = await this.eventClassRepo.find({
      where: { event_id: event.id, tenant_id: tenantId },
    });
    const classIds = links.map((l) => l.class_id);

    const qb = this.studentRepo
      .createQueryBuilder('student')
      .leftJoinAndSelect('student.guardians', 'guardian')
      .leftJoinAndSelect('student.class_section', 'class_section')
      .leftJoinAndSelect('student.user', 'student_user')
      .leftJoinAndSelect('guardian.user', 'guardian_user')
      .where('student.tenant_id = :tenantId', { tenantId })
      .andWhere('student.deleted_at IS NULL')
      .andWhere('student.enrollment_status = :enrollmentStatus', {
        enrollmentStatus: EnrollmentStatus.ACTIVE,
      });
    if (classIds.length > 0) {
      qb.andWhere('class_section.class_id IN (:...classIds)', { classIds });
    }
    const students = await qb.getMany();

    for (const student of students) {
      if (student.user_id && student.user?.status === UserStatus.ACTIVE) {
        pushUserIds.add(student.user_id);
      }
      const linked = student.guardians ?? [];
      for (const guardian of linked) {
        if (guardian.user_id && guardian.user?.status === UserStatus.ACTIVE) {
          pushUserIds.add(guardian.user_id);
        }
      }

      // SMS is metered and billed per recipient — unlike push above, it must
      // respect the same opt-out/primary-contact selection every other
      // reminder flow uses (`reminders.service.ts`, `absence-notice.service.ts`),
      // or an opted-out guardian keeps getting charged-for SMS and a
      // non-primary guardian doubles the bill for one student.
      const { guardians: smsEligible } = resolveReminderAudience(linked);
      for (const guardian of smsEligible) {
        if (guardian.phone && !smsGuardians.has(guardian.id)) {
          smsGuardians.set(guardian.id, {
            id: guardian.id,
            full_name: guardian.full_name,
            phone: guardian.phone,
          });
        }
      }
    }

    return { pushUserIds: [...pushUserIds], smsGuardians: [...smsGuardians.values()] };
  }

  // -----------------------------------------------------------------
  // SMS — mirrors absence-notice.service.ts's queueRecipients, minus the
  // per-medium branching (this path is always SMS, never mixed).
  // -----------------------------------------------------------------

  private async sendSms(
    event: CalendarEvent,
    guardians: { id: string; full_name: string; phone: string }[],
    opts: CalendarNotifyOpts,
  ): Promise<void> {
    if (guardians.length === 0) return;

    const tenantId = event.tenant_id;
    const userId = opts.userId ?? event.updated_by_user_id ?? event.created_by_user_id;
    if (!userId) {
      this.logger.warn(`sendSms: no attributable user for event ${event.id}, skipping SMS`);
      return;
    }

    // D14: SMS only when the tenant has actually turned on PLATFORM
    // metering — an unmetered tenant is never charged, and is never sent
    // calendar SMS either (same gate `reminders.service.ts` uses to decide
    // whether `sms_units > 0` even matters).
    const metered = await this.smsCreditService.isMetered(tenantId);
    if (!metered) {
      this.logger.log(`sendSms: tenant ${tenantId} not SMS-metered, skipping calendar SMS`);
      return;
    }

    // [#2265] Bangla-locale schools get a Bangla body; credit is priced on it.
    const school = await this.logRepo.manager.findOne(School, {
      where: { id: tenantId },
      select: { id: true, settings: true },
    });
    // No stored locale resolves to the bn-BD default (#3136).
    const locale = resolveTemplateLocale(school?.settings?.region?.locale);
    const message =
      locale === 'bn'
        ? `${event.name} — ${formatFeeNotificationDueDate('bn', event.start_date)}। বিস্তারিত স্কুলের ক্যালেন্ডারে দেখুন।`
        : `${event.name} on ${event.start_date}. Please check the school calendar for details.`;
    const segmentsPerRecipient = countSmsSegments(message).segments;
    const totalSegments = segmentsPerRecipient * guardians.length;

    const batch = await this.batchRepo.save(
      this.batchRepo.create({
        tenant_id: tenantId,
        batch_name: `Calendar: ${event.name}`,
        status: ReminderBatchStatus.PROCESSING,
        total_recipients: guardians.length,
        message_template: message,
        initiated_by_user_id: userId,
      }),
    );

    // [#713] Real `SmsCreditService.reserve` — same `batch:${batch.id}`
    // idempotency key shape `reminders.service.ts` uses — instead of the
    // debit-only raw UPDATE this replaced. That workaround skipped
    // `sms_credit_ledger` entirely; now that both bare `CreditsModule`
    // imports on this module's cycle are `forwardRef`'d, there's no reason
    // left to bypass the real ledger/reservation path.
    let reservation: { ok: true } | { ok: false; available: number };
    try {
      reservation = await this.smsCreditService.reserve(
        tenantId,
        totalSegments,
        `batch:${batch.id}`,
        {
          type: 'batch',
          id: batch.id,
        },
      );
    } catch (error) {
      await this.batchRepo.delete({ id: batch.id, tenant_id: tenantId });
      throw error;
    }
    if (!reservation.ok) {
      await this.batchRepo.delete({ id: batch.id, tenant_id: tenantId });
      this.logger.warn(
        `sendSms: insufficient SMS credit for event ${event.id} (tenant ${tenantId}), skipping — reason=insufficient_credit`,
      );
      return;
    }

    for (const guardian of guardians) {
      let log: CommunicationLog;
      try {
        log = await this.logRepo.save(
          this.logRepo.create({
            tenant_id: tenantId,
            reminder_batch_id: batch.id,
            medium: CommunicationMedium.SMS,
            recipient_address: guardian.phone,
            recipient_name: guardian.full_name,
            message_body: message,
            subject: 'Calendar Update',
            guardian_id: guardian.id,
            sent_by_user_id: userId,
            status: CommunicationStatus.QUEUED,
            trigger: CommunicationTrigger.AUTOMATED,
            metadata: { calendar_event_id: event.id },
          }),
        );
      } catch (error) {
        this.logger.warn(
          `sendSms: failed to create CommunicationLog for batch ${batch.id}, guardian ${guardian.id}: ${String(error)}`,
        );
        // No log/job was ever created for this guardian's share, so
        // nothing will settle it later — release it here instead of
        // leaving it reserved forever (mirrors reminders.service.ts's
        // enqueue-failure release below).
        await this.releaseSegments(tenantId, batch.id, guardian.id, segmentsPerRecipient);
        // Nothing will ever process a job for this guardian's share either
        // — record the failure now, or this batch never reaches
        // total_recipients and stays PROCESSING forever (mirrors
        // absence-notice.service.ts's queueRecipients).
        await recordBatchOutcome(this.logRepo.manager, batch.id, 'failure');
        continue;
      }

      try {
        // `batchId` + `segments` are what gate `CommunicationsProcessor`'s
        // per-log credit *settlement* (`isSettleableSmsBatchJob`) — the
        // reservation above needs to be peeled down (`settlePart`) as each
        // log resolves, same as any other metered SMS batch.
        await this.queue.add('send', {
          logId: log.id,
          batchId: batch.id,
          segments: segmentsPerRecipient,
        });
      } catch (error) {
        this.logger.warn(
          `sendSms: failed to enqueue log ${log.id} for batch ${batch.id}: ${String(error)}`,
        );
        // Same transaction as absence-notice.service.ts's enqueue-failure
        // path: the log's terminal status and the batch's counter/status
        // transition must commit together, or a crash between them leaves
        // the batch permanently short a count.
        await this.logRepo.manager.transaction(async (manager) => {
          log.status = CommunicationStatus.FAILED;
          await manager.save(log);
          await recordBatchOutcome(manager, batch.id, 'failure');
        });
        // Same as reminders.service.ts:696-723 — the job that would have
        // settled this log's share of the RESERVE was never created.
        await this.releaseSegments(tenantId, batch.id, log.id, segmentsPerRecipient);
      }
    }
  }

  /**
   * Releases one recipient's share of a batch's SMS credit RESERVE when
   * no job was ever created to settle it (log creation failed, or the
   * enqueue itself failed) — otherwise those segments stay reserved
   * forever. Mirrors reminders.service.ts:696-723. Must not mask the
   * original failure that triggered the release: any error here is
   * logged, not rethrown.
   */
  private async releaseSegments(
    tenantId: string,
    batchId: string,
    partKey: string,
    segments: number,
  ): Promise<void> {
    try {
      await this.smsCreditService.settlePart(
        tenantId,
        `batch:${batchId}`,
        `log:${partKey}`,
        segments,
        'RELEASE',
      );
    } catch (err) {
      this.logger.error(
        `sendSms: credit release failed for batch ${batchId}, part ${partKey} — reservation left stranded: ${String(err)}`,
      );
    }
  }
}
