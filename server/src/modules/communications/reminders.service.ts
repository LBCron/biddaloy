import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { assertDemoRowLimit } from '../demo/demo-row-limit';
import { deliveryErrorCode } from './delivery-error-code';
import { isMessageSink } from './providers/sink/message-sink';
import { messagingDescriptors } from '../schools/settings/messaging-descriptors';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Brackets, Repository } from 'typeorm';
import { CommunicationLog } from './entities/communication-log.entity';
import { ReminderBatch } from './entities/reminder-batch.entity';
import { StudentService } from '../students/students.service';
import { FeeDuesService, StudentDueSnapshot } from '../fees/fee-dues.service';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import {
  SendBulkReminderDto,
  ReminderBatchResponseDto,
  SkippedRecipientDto,
  QueryReminderBatchesDto,
  ReminderBatchListResponseDto,
  ReminderBatchListItemDto,
  BulkReminderPreviewResponseDto,
  BulkPreviewStudentDto,
  BulkSmsProjectionDto,
  QueryReminderBatchLogsDto,
  QueryCommunicationLogsDto,
  ReminderBatchLogListResponseDto,
  ReminderBatchLogDto,
  MessageLogFilterOptionsDto,
} from './dto/reminders.dto';
import {
  findUnsupportedPlaceholders,
  renderReminderTemplate,
  formatDueAmount,
  formatDueMonth,
  ReminderTemplateVars,
  SUPPORTED_PLACEHOLDERS,
  isSupportedPlaceholder,
} from './reminder-template.util';
import { recordBatchOutcome } from './reminder-batch-counters';
import { COMMUNICATIONS_QUEUE } from './communications.constants';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { BN_COLLATION } from '../../common/constants/collation';
import {
  selectReminderGuardians,
  partitionByOptOut,
  resolveReminderAudience,
  addressForMedium,
  DISPATCHABLE_MEDIA,
} from './reminder-recipients.util';
import { resolveWhatsAppTemplate, whatsAppTemplateMetadata } from './whatsapp-template.util';
import { projectSmsUnits } from './sms-projection.util';
import { SmsCreditService } from './credits/sms-credit.service';
import { INSUFFICIENT_SMS_CREDIT } from './credits/insufficient-sms-credit.constants';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { endOfLocalDay, localToday, startOfLocalDay } from '../../common/time';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  Permission,
  ReminderBatchStatus,
  countSmsSegments,
  roleHasPermission,
} from '@biddaloy/shared';
import { REDACTED } from '../account-access/account-access-templates';

// Re-exported so existing imports (this file's own spec, in particular)
// keep working — the shared #18 single-reminder flow needs these too, so
// they now live in reminder-recipients.util.ts.
export { selectReminderGuardians, partitionByOptOut, resolveReminderAudience, addressForMedium };

/**
 * Why a recipient was left out of a batch. Returned verbatim to the caller
 * and persisted in the batch's filters_applied, so "we sent 40 of 60" is
 * always accompanied by which 20 and why.
 */
export const SkipReason = {
  NO_OPEN_DUES: 'no_open_dues',
  NO_GUARDIANS: 'no_guardians',
  MEDIUM_NOT_ALLOWED: 'preferred_medium_not_in_requested_mediums',
  NO_AUTOMATED_PROVIDER: 'preferred_medium_has_no_automated_provider',
  MISSING_ADDRESS: 'guardian_has_no_address_for_preferred_medium',
  NOTIFICATIONS_DISABLED: 'guardian_notifications_disabled',
} as const;

/**
 * [97.4.02] D23, the part of check-status's 409 rules a list can know: SENT, a company message id,
 * a company that declares `status`, not the test inbox. Leaves out the 60 s wait and the tenant's
 * config, so true can still answer 409; false never hides a check that could work.
 */
export function canCheckStatus(log: CommunicationLog): boolean {
  const name = (log.metadata as { provider?: unknown } | null)?.provider;
  return (
    log.status === CommunicationStatus.SENT &&
    !!log.provider_message_id &&
    typeof name === 'string' &&
    !isMessageSink() &&
    messagingDescriptors().some(
      (d) => d.name === name && d.medium === log.medium && d.capabilities.includes('status'),
    )
  );
}

/** A raw invoice share token in a stored body (`${PUBLIC_APP_URL}/i/<base64url>`, Rule 16). */
const SHARE_LINK = /\/i\/[A-Za-z0-9_-]+/g;

/**
 * [#3351 r2] What a message-log row may show of the stored text, decided at READ time for the
 * caller's role. The stored body is never changed: the worker sends `log.message_body` as stored
 * (communications.processor.ts), so masking at write would send the guardian a dead link.
 *
 * | Kind (who writes it)                                                    | Rule                                 |
 * | ----------------------------------------------------------------------- | ------------------------------------ |
 * | Invoice receipt / invoice send (invoice-notifications.listener.ts,      | `/i/<token>` -> `/i/••••••`, every   |
 * | invoices.controller.ts): a live 30-day share link                       | row and role                         |
 * | RESULT_SMS (exams/result-sms.service.ts): a student's result            | null unless the role has RESULT_READ |
 * | ACCOUNT_ACCESS (account-access-delivery.service.ts): codes, links       | already redacted at write            |
 * | Alert SMS fallback (attention/.../guardian-sms-fallback.service.ts):    | kept: only `child.absent_today` and  |
 * | the alert title                                                         | `fees.overdue_family` fall back      |
 * | Study-plan digest (study-plan-flags.scheduler.ts): tasks behind         | kept: no marks or results            |
 * | Application decision (application-notify.service.ts): approved/rejected | kept: no detail of the application   |
 * | Homework, calendar, admission, absence/arrival, incident (fixed text),  | kept: what these roles already see   |
 * | fee reminders, trial notice, staff messages, settings test              | elsewhere, or staff-written text     |
 */
export function visibleLogBody(
  log: Pick<CommunicationLog, 'trigger' | 'message_body'>,
  role: string,
): string | null {
  if (
    log.trigger === CommunicationTrigger.RESULT_SMS &&
    !roleHasPermission(role, Permission.RESULT_READ)
  ) {
    return null;
  }
  return log.message_body.replace(SHARE_LINK, `/i/${REDACTED}`);
}

/** A log query with the sender's name only (D22), never the rest of the user row. */
export function logsWithSender(repo: Repository<CommunicationLog>) {
  return repo
    .createQueryBuilder('log')
    .leftJoin('log.sent_by', 'sender')
    .addSelect(['sender.id', 'sender.full_name']);
}

/**
 * One message-log row (batch logs, tenant-wide log, check-status answer), for the caller's `role`
 * (see `visibleLogBody`). `sent_by_name` needs the sender loaded (`logsWithSender`).
 */
export function toBatchLogDto(log: CommunicationLog, role: string): ReminderBatchLogDto {
  const meta = (log.metadata ?? {}) as { provider?: unknown; segments?: unknown; test?: unknown };
  const provider = meta.provider;
  const body = visibleLogBody(log, role);
  return {
    id: log.id,
    medium: log.medium,
    recipient_address: log.recipient_address,
    recipient_name: log.recipient_name,
    status: log.status,
    trigger: log.trigger,
    student_id: log.student_id,
    guardian_id: log.guardian_id,
    provider_message_id: log.provider_message_id,
    provider: typeof provider === 'string' ? provider : null,
    error: deliveryErrorCode(log.metadata),
    created_at: log.created_at,
    message_body: body,
    body_withheld: body === null,
    subject: log.subject,
    // Counted from the stored text, never the masked one. ACCOUNT_ACCESS stores the redacted text
    // and sends the real one, so without `metadata.segments` its count is unknown.
    segments:
      typeof meta.segments === 'number'
        ? meta.segments
        : log.medium === CommunicationMedium.SMS &&
            log.trigger !== CommunicationTrigger.ACCOUNT_ACCESS
          ? countSmsSegments(log.message_body).segments
          : null,
    batch_id: log.reminder_batch_id,
    is_test: meta.test === true,
    sent_by_user_id: log.sent_by_user_id,
    sent_by_name: log.sent_by?.full_name ?? null,
    can_check_status: canCheckStatus(log),
  };
}

export interface ResolvedRecipient {
  student: Student;
  guardian: Guardian;
  medium: CommunicationMedium;
  address: string;
  vars: ReminderTemplateVars;
}

@Injectable()
export class BulkReminderService {
  private readonly logger = new Logger(BulkReminderService.name);

  constructor(
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectRepository(ReminderBatch)
    private readonly batchRepo: Repository<ReminderBatch>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly studentService: StudentService,
    private readonly feeDuesService: FeeDuesService,
    private readonly auditService: AuditService,
    private readonly smsCreditService: SmsCreditService,
  ) {}

  async sendBulk(
    dto: SendBulkReminderDto,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<ReminderBatchResponseDto> {
    const { studentIds, recipients, skipped } = await this.validateAndResolve(dto, tenantId);

    // [15.6.5/#548] Recomputed from the just-resolved recipients and the
    // template that will actually be sent — never trusted from the client
    // (the DTO carries no client-supplied total to begin with; previewBulk's
    // earlier number is advisory only, this is the number that gets
    // reserved). Server is the enforcement boundary.
    const { sms_units } = projectSmsUnits(recipients, dto.message_template);

    const batch = await this.batchRepo.save(
      this.batchRepo.create({
        tenant_id: tenantId,
        batch_name: dto.batch_name || this.defaultBatchName(),
        // Nothing to dispatch is a finished batch, not a stuck one.
        status:
          recipients.length === 0 ? ReminderBatchStatus.COMPLETED : ReminderBatchStatus.PROCESSING,
        total_recipients: recipients.length,
        message_template: dto.message_template,
        initiated_by_user_id: userId,
        filters_applied: {
          student_ids: studentIds,
          mediums: dto.mediums ?? null,
          // Persisted so a retry can reproduce this batch exactly. Without
          // them, retrying an email-only batch would fan back out to every
          // preferred channel, and retrying a WhatsApp template batch would
          // become a freeform send Meta rejects outside its 24-hour window
          // — reproducing the very failure being retried.
          whatsapp_template_name: dto.whatsapp_template_name ?? null,
          whatsapp_template_language: dto.whatsapp_template_language ?? null,
          whatsapp_template_params: dto.whatsapp_template_params ?? null,
          skipped,
        },
      }),
    );

    // Reserve BEFORE any log/job is created — the batch id is only known
    // once the row above exists (DB-generated uuid), so this is the
    // earliest point a stable `batch:${batch.id}` idempotency key can be
    // formed. On failure, the batch row this transaction just created is
    // compensating-deleted too (there's no surrounding transaction across
    // these three independent calls, so this is a manual cleanup, not a
    // rollback): no batch, no logs, no jobs must remain on insufficient
    // credit (epic #508: external provider calls — and the work that leads
    // to them — never leave partial durable state behind). That cleanup
    // must run whether `reserve` resolves `ok: false` or throws — either
    // way nothing was actually reserved, and leaving the row behind would
    // strand it at PROCESSING forever with no job to ever move it on.
    let metered = false;
    if (sms_units > 0 && (await this.smsCreditService.isMetered(tenantId))) {
      metered = true;
      let reservation: { ok: true } | { ok: false; available: number };
      try {
        reservation = await this.smsCreditService.reserve(
          tenantId,
          sms_units,
          `batch:${batch.id}`,
          { type: 'batch', id: batch.id },
        );
      } catch (err) {
        await this.batchRepo.delete({ id: batch.id, tenant_id: tenantId });
        throw err;
      }
      if (!reservation.ok) {
        await this.batchRepo.delete({ id: batch.id, tenant_id: tenantId });
        throw new ConflictException({
          message: 'Insufficient SMS credit to send this batch.',
          details: {
            code: INSUFFICIENT_SMS_CREDIT,
            required: sms_units,
            available: reservation.available,
          },
        });
      }
    }

    const { queued, failed } = await this.queueRecipients(
      recipients,
      batch,
      dto,
      tenantId,
      userId,
      metered,
    );

    // One record per batch, not per recipient — a bulk send can fan out to
    // hundreds of guardians, and PAYMENT_RECEIVED/BULK_UPLOAD already set
    // the precedent of one audit row per user-initiated action. Queued/
    // failed are enqueue outcomes, not final delivery (that settles async,
    // later, via the worker) — but "attempted N, only M actually reached
    // the queue" is exactly what this record must not silently collapse
    // into a single "sent" count.
    await this.auditService.record({
      action: AuditAction.REMINDER_SENT,
      entity_type: 'ReminderBatch',
      entity_id: batch.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: {
        student_count: studentIds.length,
        recipient_count: recipients.length,
        queued_count: queued,
        failed_count: failed,
        skipped_count: skipped.length,
      },
    });

    // Re-read so the response reflects any failures the enqueue loop
    // recorded rather than the counts the batch was created with.
    const saved = await this.batchRepo.findOne({ where: { id: batch.id } });
    return this.toResponseDto(saved ?? batch, skipped);
  }

  async findBatch(id: string, tenantId: string): Promise<ReminderBatchResponseDto> {
    const batch = await this.batchRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!batch) {
      throw new NotFoundException('Reminder batch not found');
    }
    const skipped = (batch.filters_applied?.skipped as SkippedRecipientDto[] | undefined) ?? [];
    return this.toResponseDto(batch, skipped);
  }

  /**
   * Reminder History's data source: every batch this tenant ever sent,
   * newest first. Excludes each batch's skip list — see
   * ReminderBatchListItemDto for why.
   */
  async findBatches(
    query: QueryReminderBatchesDto,
    tenantId: string,
  ): Promise<ReminderBatchListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.batchRepo
      .createQueryBuilder('batch')
      .where('batch.tenant_id = :tenantId', { tenantId })
      // Exactly the columns toListItemDto maps. Without this, every row on
      // the page also drags back `message_template` (up to 2000 chars) and
      // the `filters_applied` jsonb — which holds the batch's whole
      // student_ids list *and* its skip list, potentially hundreds of
      // entries — only for them to be discarded here.
      .select([
        'batch.id',
        'batch.batch_name',
        'batch.status',
        'batch.total_recipients',
        'batch.successful_count',
        'batch.failed_count',
        'batch.created_at',
      ]);

    const search = normalizeSearchTerm(query.search);
    if (search) {
      qb.andWhere('batch.batch_name ILIKE :search', { search: `%${search}%` });
    }
    if (query.status) {
      qb.andWhere('batch.status = :status', { status: query.status });
    }
    if (query.from_date) {
      qb.andWhere('batch.created_at >= :fromDate', { fromDate: query.from_date });
    }
    if (query.to_date) {
      // A date-only value must include the whole day, matching the
      // pattern used elsewhere in this codebase for to_date filters
      // (e.g. AuditService.findAll).
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(query.to_date);
      const toDate = new Date(query.to_date);
      if (isDateOnly) {
        toDate.setUTCHours(23, 59, 59, 999);
      }
      qb.andWhere('batch.created_at <= :toDate', { toDate });
    }

    if (query.sort === 'batch_name') {
      qb.orderBy(
        `batch.batch_name COLLATE "${BN_COLLATION}"`,
        query.order === 'desc' ? 'DESC' : 'ASC',
      );
    } else if (query.sort === 'total_recipients') {
      qb.orderBy('batch.total_recipients', query.order === 'asc' ? 'ASC' : 'DESC');
    } else {
      qb.orderBy('batch.created_at', query.order === 'asc' ? 'ASC' : 'DESC');
    }
    qb.addOrderBy('batch.id', 'DESC');

    const [batches, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: batches.map((batch) => this.toListItemDto(batch)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Exactly what sendBulk would deliver for this request, without doing
   * any of it — no batch row, no communication logs, no queue jobs. The
   * epic makes preview mandatory before send: the sender must see the
   * resolved recipients *and* the skipped ones (with reasons), because the
   * server's skip logic (dues, guardian preferences, missing addresses)
   * cannot be reproduced client-side.
   *
   * "Delivers" rather than "does": WhatsApp recipients are dispatched as a
   * Meta-approved template, not as the rendered `message_body`, so each
   * recipient also carries the resolved `whatsapp_template` — see
   * whatsapp-template.util.ts, which both this and the send path share so
   * the two can never disagree.
   *
   * One write does happen, deliberately: an audit record. Nothing is sent,
   * but the response names every guardian, channel and contact address
   * behind the filter, so who asked for it must leave a trace — same
   * reasoning as SETTINGS_TEST. Only counts are recorded, never the
   * resolved contact data itself.
   */
  async previewBulk(
    dto: SendBulkReminderDto,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<BulkReminderPreviewResponseDto> {
    const { studentIds, students, recipients, skipped } = await this.validateAndResolve(
      dto,
      tenantId,
    );

    const guardianNames = new Map<string, string>();
    const studentsById = new Map(students.map((s) => [s.id, s]));
    for (const student of students) {
      for (const guardian of student.guardians ?? []) {
        guardianNames.set(guardian.id, guardian.full_name);
      }
    }

    // Grouped per student, in request order — the review step reads
    // "for this student, these guardians get this exact message."
    const byStudent = new Map<string, BulkPreviewStudentDto>();
    for (const id of studentIds) {
      const student = studentsById.get(id);
      if (!student) continue; // unreachable: validateAndResolve 404s on missing ids
      byStudent.set(id, {
        student_id: id,
        student_name: student.full_name,
        recipients: [],
        skipped: [],
      });
    }

    for (const r of recipients) {
      byStudent.get(r.student.id)?.recipients.push({
        guardian_id: r.guardian.id,
        guardian_name: r.guardian.full_name,
        medium: r.medium,
        address: r.address,
        message_body: renderReminderTemplate(dto.message_template, r.vars),
        subject: r.medium === CommunicationMedium.EMAIL ? this.emailSubject(dto) : null,
        whatsapp_template: resolveWhatsAppTemplate(r.medium, r.vars, dto),
      });
    }

    for (const s of skipped) {
      byStudent.get(s.student_id)?.skipped.push({
        guardian_id: s.guardian_id,
        guardian_name: s.guardian_id ? (guardianNames.get(s.guardian_id) ?? null) : null,
        reason: s.reason,
      });
    }

    // Counts only — the point of the record is "this user resolved this
    // many contacts", not a second copy of the contacts themselves.
    await this.auditService.record({
      action: AuditAction.REMINDER_PREVIEWED,
      entity_type: 'ReminderBatchPreview',
      entity_id: null,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: {
        student_count: studentIds.length,
        recipient_count: recipients.length,
        skipped_count: skipped.length,
        mediums: dto.mediums ?? null,
      },
    });

    return {
      total_students: studentIds.length,
      recipients_count: recipients.length,
      skipped_count: skipped.length,
      students: [...byStudent.values()],
      projection: await this.projectSms(recipients, dto.message_template, tenantId),
    };
  }

  /**
   * [15.6.4/#547] Rendered-per-recipient SMS unit projection, plus balance
   * context when the tenant meters SMS. `available`/`reserved`/`shortfall`
   * only mean anything under PLATFORM metering — OFF omits them rather than
   * shipping zeros a reader could mistake for "you have none left."
   */
  private async projectSms(
    recipients: ResolvedRecipient[],
    template: string,
    tenantId: string,
  ): Promise<BulkSmsProjectionDto> {
    const { sms_recipients, sms_units } = projectSmsUnits(recipients, template);

    if (!(await this.smsCreditService.isMetered(tenantId))) {
      return { sms_recipients, sms_units, metering: 'OFF' };
    }

    const { available, reserved } = await this.smsCreditService.getBalance(tenantId);
    return {
      sms_recipients,
      sms_units,
      metering: 'PLATFORM',
      available,
      reserved,
      shortfall: Math.max(0, sms_units - available),
    };
  }

  /**
   * Per-recipient delivery status for one batch — the batch detail page's
   * table, and the source a retry composes its failed-students list from.
   * The batch is looked up first (tenant-scoped) so a cross-tenant batch id
   * 404s rather than returning an empty page indistinguishable from a
   * batch with no logs.
   */
  async findBatchLogs(
    id: string,
    query: QueryReminderBatchLogsDto,
    tenantId: string,
    role: string,
  ): Promise<ReminderBatchLogListResponseDto> {
    const batch = await this.batchRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!batch) {
      throw new NotFoundException('Reminder batch not found');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    // offset/limit, not skip/take: the sender join is many-to-one, so one query pages correctly.
    const [logs, total] = await logsWithSender(this.logRepo)
      .where('log.tenant_id = :tenantId', { tenantId })
      .andWhere('log.reminder_batch_id = :id', { id })
      .orderBy('log.created_at', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    return {
      data: logs.map((log) => toBatchLogDto(log, role)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * [87.SD, 97.4.01] Tenant-wide message log (newest first) with every D22
   * filter. Same row shape as a batch's logs, fixed error codes (Rule 23).
   * Every value is a bound parameter (Rule 4).
   */
  async findLogs(
    query: QueryCommunicationLogsDto,
    tenantId: string,
    role: string,
  ): Promise<ReminderBatchLogListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const qb = logsWithSender(this.logRepo)
      .where('log.tenant_id = :tenantId', { tenantId })
      // PUSH rows are app notifications ('push:<user id>'), not messages a school sent.
      .andWhere('log.medium IN (:...media)', {
        media: query.medium ? [query.medium] : Object.values(CommunicationMedium),
      });
    // [#3343] One student's or guardian's messages (their detail pages' Messages link).
    if (query.student_id) {
      qb.andWhere('log.student_id = :studentId', { studentId: query.student_id });
    }
    if (query.guardian_id) {
      qb.andWhere('log.guardian_id = :guardianId', { guardianId: query.guardian_id });
    }
    if (query.status) qb.andWhere('log.status = :status', { status: query.status });
    if (query.trigger) qb.andWhere('log.trigger = :trigger', { trigger: query.trigger });
    if (query.sent_by) qb.andWhere('log.sent_by_user_id = :sentBy', { sentBy: query.sent_by });
    if (query.provider) {
      qb.andWhere(`log.metadata ->> 'provider' = :provider`, { provider: query.provider });
    }
    // School-local days (IsRealDate: always YYYY-MM-DD), the same days the
    // Failed messages widget counts with, so its link lands on the same rows.
    if (query.from_date) {
      qb.andWhere('log.created_at >= :from', { from: startOfLocalDay(query.from_date) });
    }
    if (query.to_date) {
      qb.andWhere('log.created_at <= :to', { to: endOfLocalDay(query.to_date) });
    }
    const search = normalizeSearchTerm(query.search);
    if (search) {
      // D33: a phone-shaped term also matches by digits with the country code dropped, so
      // `+880 1712-345678`, `8801712345678` and `01712 345678` all find `01712345678`.
      // ponytail: no trigram index; add pg_trgm when a school passes 100k logs.
      const digits = /^[\d\s+()-]+$/.test(search) ? search.replace(/\D/g, '') : '';
      // Only the country code `880` (`8801…` -> `01…`), not any leading `88`.
      const local = digits.startsWith('880') ? digits.slice(2) : digits;
      // At least 4 digits: `880` alone would become `0` and match nearly every number.
      const phone = local.length >= 4 ? local : '';
      qb.andWhere(
        new Brackets((w) => {
          w.where('log.recipient_name ILIKE :search', { search: `%${search}%` }).orWhere(
            'log.recipient_address ILIKE :search',
          );
          // Review round 2 on #3347: digits on both sides, so a stored `+880 1712-345678` matches
          // too. `phone` is digits only, so it holds no LIKE wildcard (Rule 4).
          if (phone) {
            w.orWhere(`regexp_replace(log.recipient_address, '[^0-9]', '', 'g') ILIKE :phone`, {
              phone: `%${phone}%`,
            });
          }
        }),
      );
    }

    const [logs, total] = await qb
      .orderBy('log.created_at', 'DESC')
      .addOrderBy('log.id', 'DESC')
      // offset/limit, not skip/take: the sender join is many-to-one, so one query pages correctly.
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    return {
      data: logs.map((log) => toBatchLogDto(log, role)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * [97.4.02] D22: the message log's Company and Sent-by choices, readable with the page's own
   * permission (the settings and users lists need permissions Accountant and Office staff lack).
   * Companies are the static descriptors (no config, no secrets); senders are this school's staff
   * who sent at least one message.
   */
  async findLogFilterOptions(tenantId: string): Promise<MessageLogFilterOptionsDto> {
    const senders = await this.logRepo
      .createQueryBuilder('log')
      .innerJoin('log.sent_by', 'sender')
      .select('sender.id', 'id')
      .addSelect('sender.full_name', 'full_name')
      .where('log.tenant_id = :tenantId', { tenantId })
      // The list hides PUSH rows (app notifications), so their senders are no choice here.
      .andWhere('log.medium IN (:...media)', { media: Object.values(CommunicationMedium) })
      .groupBy('sender.id')
      .addGroupBy('sender.full_name')
      .orderBy(`sender.full_name COLLATE "${BN_COLLATION}"`, 'ASC')
      // ponytail: 100 senders (Rule 5); a school with more needs a searchable picker.
      .limit(100)
      .getRawMany<{ id: string; full_name: string }>();
    return {
      companies: messagingDescriptors().map((d) => ({
        name: d.name,
        medium: d.medium,
        label: { en: d.label.en, bn: d.label.bn },
      })),
      senders,
    };
  }

  /**
   * The request-shaped half shared by previewBulk and sendBulk: template
   * and WhatsApp-param validation, id dedupe, tenant-scoped batch loads
   * (one query for students+guardians, one for due snapshots — never one
   * per student; input is capped at 500), and recipient resolution.
   * Shared so preview can never disagree with what send would then do.
   */
  private async validateAndResolve(
    dto: SendBulkReminderDto,
    tenantId: string,
  ): Promise<{
    studentIds: string[];
    students: Student[];
    recipients: ResolvedRecipient[];
    skipped: SkippedRecipientDto[];
  }> {
    const unsupported = findUnsupportedPlaceholders(dto.message_template);
    if (unsupported.length > 0) {
      throw new BadRequestException(
        `Unsupported template placeholder(s): ${unsupported.join(', ')}. ` +
          `Supported: ${SUPPORTED_PLACEHOLDERS.join(', ')}`,
      );
    }
    this.validateWhatsAppParams(dto);

    // A duplicated ID would otherwise send the same guardian the same
    // reminder twice and inflate total_recipients.
    const studentIds = [...new Set(dto.student_ids)];
    // The demo cap counts the students picked (the rows of the request), before any DB read.
    assertDemoRowLimit(studentIds.length);

    const students = await this.studentService.findManyWithGuardians(studentIds, tenantId);
    const found = new Set(students.map((s) => s.id));
    const missing = studentIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new NotFoundException('One or more student IDs not found');
    }

    const dueSnapshots = await this.feeDuesService.getDueSnapshots(studentIds, tenantId);

    const skipped: SkippedRecipientDto[] = [];
    const recipients = this.resolveRecipients(students, dueSnapshots, dto, skipped);

    return { studentIds, students, recipients, skipped };
  }

  /**
   * Walks students → guardians → a concrete (medium, address) pair, pushing
   * anything undeliverable onto `skipped` instead of queueing a send that
   * cannot succeed.
   */
  private resolveRecipients(
    students: Student[],
    dueSnapshots: Map<string, StudentDueSnapshot>,
    dto: SendBulkReminderDto,
    skipped: SkippedRecipientDto[],
  ): ResolvedRecipient[] {
    const allowed = dto.mediums && dto.mediums.length > 0 ? new Set(dto.mediums) : null;
    const recipients: ResolvedRecipient[] = [];

    for (const student of students) {
      const snapshot = dueSnapshots.get(student.id);
      if (!snapshot) {
        // No open fee means there is nothing to remind about — a reminder
        // reading "you owe 0.00" is worse than no reminder.
        skipped.push({
          student_id: student.id,
          guardian_id: null,
          reason: SkipReason.NO_OPEN_DUES,
        });
        continue;
      }

      const linked = student.guardians ?? [];
      if (linked.length === 0) {
        skipped.push({
          student_id: student.id,
          guardian_id: null,
          reason: SkipReason.NO_GUARDIANS,
        });
        continue;
      }

      // Selection runs over the reachable guardians (so an opted-out sole
      // primary promotes the reachable non-primaries rather than silencing
      // the student), while the reported skips are limited to opt-outs that
      // would actually have been selected. See resolveReminderAudience. [5.4c]
      const { guardians, skippedOptOut } = resolveReminderAudience(linked);
      for (const guardian of skippedOptOut) {
        skipped.push({
          student_id: student.id,
          guardian_id: guardian.id,
          reason: SkipReason.NOTIFICATIONS_DISABLED,
        });
      }

      // A student whose guardians have ALL opted out gets the per-guardian
      // entries above only — no misleading NO_GUARDIANS on top.
      if (guardians.length === 0) {
        continue;
      }

      const dueMonth =
        snapshot.earliest_due_month !== null && snapshot.earliest_due_year !== null
          ? formatDueMonth(snapshot.earliest_due_month, snapshot.earliest_due_year)
          : '';

      for (const guardian of guardians) {
        const medium = guardian.preferred_communication;

        if (allowed && !allowed.has(medium)) {
          skipped.push({
            student_id: student.id,
            guardian_id: guardian.id,
            reason: SkipReason.MEDIUM_NOT_ALLOWED,
          });
          continue;
        }
        if (!DISPATCHABLE_MEDIA.includes(medium)) {
          skipped.push({
            student_id: student.id,
            guardian_id: guardian.id,
            reason: SkipReason.NO_AUTOMATED_PROVIDER,
          });
          continue;
        }

        const address = addressForMedium(guardian, medium);
        if (!address) {
          skipped.push({
            student_id: student.id,
            guardian_id: guardian.id,
            reason: SkipReason.MISSING_ADDRESS,
          });
          continue;
        }

        recipients.push({
          student,
          guardian,
          medium,
          address,
          vars: {
            student_name: student.full_name,
            guardian_name: guardian.full_name,
            due_amount: formatDueAmount(snapshot.total_due),
            due_month: dueMonth,
          },
        });
      }
    }

    return recipients;
  }

  private async queueRecipients(
    recipients: ResolvedRecipient[],
    batch: ReminderBatch,
    dto: SendBulkReminderDto,
    tenantId: string,
    userId: string,
    metered: boolean,
  ): Promise<{ queued: number; failed: number }> {
    let queued = 0;
    let failed = 0;

    for (const recipient of recipients) {
      const renderedBody = renderReminderTemplate(dto.message_template, recipient.vars);
      const log = await this.logRepo.save(
        this.logRepo.create({
          tenant_id: tenantId,
          reminder_batch_id: batch.id,
          medium: recipient.medium,
          recipient_address: recipient.address,
          recipient_name: recipient.guardian.full_name,
          message_body: renderedBody,
          subject: recipient.medium === CommunicationMedium.EMAIL ? this.emailSubject(dto) : null,
          student_id: recipient.student.id,
          guardian_id: recipient.guardian.id,
          sent_by_user_id: userId,
          status: CommunicationStatus.QUEUED,
          trigger: CommunicationTrigger.BULK_REMINDER,
          metadata: this.whatsAppMetadata(dto, recipient),
        }),
      );

      // [15.6.5/#548] `segments` is only meaningful for SMS — every other
      // medium never touches the credit ledger, so its job data carries
      // none. Settlement (peeling this off the batch's RESERVE) is #549;
      // this just plumbs the number the worker will eventually need.
      const segments =
        recipient.medium === CommunicationMedium.SMS
          ? countSmsSegments(renderedBody).segments
          : undefined;

      try {
        await this.queue.add('send', {
          logId: log.id,
          batchId: batch.id,
          ...(segments !== undefined ? { segments } : {}),
        });
        queued++;
      } catch {
        // One recipient failing to enqueue shouldn't abort the rest of the
        // batch, but the row must not be left QUEUED with no job behind it.
        // Save and counter update run in one transaction — same reasoning
        // as CommunicationsProcessor.settle: separately, a crash between
        // them would leave a FAILED log whose outcome was never counted.
        log.status = CommunicationStatus.FAILED;
        log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
        await this.logRepo.manager.transaction(async (manager) => {
          await manager.save(log);
          await recordBatchOutcome(manager, batch.id, 'failure');
        });
        failed++;

        // The job that would have settled this recipient's share of the
        // batch RESERVE was never created, so nothing else will ever
        // release it — do it here instead of leaving units reserved
        // forever (#570). A failure here must not escape the loop: the
        // log above already saved as FAILED, so a `settlePart` error
        // (e.g. a stale RESERVE key) must not stop the remaining
        // recipients from being enqueued — the reservation just stays
        // stranded pending reconciliation, same as any other UNSETTLED
        // credit case.
        if (metered && recipient.medium === CommunicationMedium.SMS && segments !== undefined) {
          try {
            await this.smsCreditService.settlePart(
              tenantId,
              `batch:${batch.id}`,
              `log:${log.id}`,
              segments,
              'RELEASE',
            );
          } catch (err) {
            this.logger.error({
              msg: 'sms credit release on enqueue failure failed — reservation left stranded',
              communication_log_id: log.id,
              tenant_id: tenantId,
              batch_id: batch.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    return { queued, failed };
  }

  /**
   * WhatsApp template params are named here and positional at Meta's end, so
   * a name the renderer can't fill would silently send an empty parameter
   * and get the message rejected. Catch it before the batch is created.
   */
  private validateWhatsAppParams(dto: SendBulkReminderDto): void {
    const unknown = (dto.whatsapp_template_params ?? []).filter(
      (name) => !isSupportedPlaceholder(name),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unsupported whatsapp_template_params: ${unknown.join(', ')}. ` +
          `Supported: ${SUPPORTED_PLACEHOLDERS.join(', ')}`,
      );
    }
  }

  /**
   * Shares resolveWhatsAppTemplate with previewBulk on purpose: the review
   * step must show the same template name, language and positional params
   * the worker will actually dispatch.
   */
  private whatsAppMetadata(
    dto: SendBulkReminderDto,
    recipient: ResolvedRecipient,
  ): Record<string, unknown> | null {
    return whatsAppTemplateMetadata(resolveWhatsAppTemplate(recipient.medium, recipient.vars, dto));
  }

  private emailSubject(dto: SendBulkReminderDto): string {
    return (dto.batch_name || 'Fee Reminder').slice(0, 200);
  }

  private defaultBatchName(): string {
    return `Fee Reminder ${localToday()}`;
  }

  private toListItemDto(batch: ReminderBatch): ReminderBatchListItemDto {
    return {
      id: batch.id,
      batch_name: batch.batch_name,
      status: batch.status,
      total_recipients: batch.total_recipients,
      successful_count: batch.successful_count,
      failed_count: batch.failed_count,
      created_at: batch.created_at,
    };
  }

  private toResponseDto(
    batch: ReminderBatch,
    skipped: SkippedRecipientDto[],
  ): ReminderBatchResponseDto {
    return {
      id: batch.id,
      batch_name: batch.batch_name,
      status: batch.status,
      total_recipients: batch.total_recipients,
      successful_count: batch.successful_count,
      failed_count: batch.failed_count,
      message_template: batch.message_template,
      created_at: batch.created_at,
      // The batch's original targeting, so the detail page can retry the
      // failures on the same channels with the same approved template
      // rather than on looser defaults. Null means "each guardian's
      // preferred channel", which is what the send used.
      mediums: (batch.filters_applied?.mediums as CommunicationMedium[] | null) ?? null,
      whatsapp_template_name:
        (batch.filters_applied?.whatsapp_template_name as string | null) ?? null,
      whatsapp_template_language:
        (batch.filters_applied?.whatsapp_template_language as string | null) ?? null,
      whatsapp_template_params:
        (batch.filters_applied?.whatsapp_template_params as string[] | null) ?? null,
      skipped,
    };
  }
}
