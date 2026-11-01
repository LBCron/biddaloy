import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  AttendanceSessionState,
  AttendanceStatus,
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  ReminderBatchStatus,
} from '@biddaloy/shared';
import { localToday, resolveAttendancePolicy } from './attendance-policy.util';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { recordBatchOutcome } from '../communications/reminder-batch-counters';
import {
  addressForMedium,
  DISPATCHABLE_MEDIA,
  resolveReminderAudience,
} from '../communications/reminder-recipients.util';
import {
  joinStudentNames,
  renderReminderTemplate,
  ReminderTemplateVars,
} from '../communications/reminder-template.util';
import { resolveTemplateLocale } from '../account-access/account-access-templates';
import { sectionRosterStudentIds } from '../enrollments/section-roster';
import { AuditService } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import {
  CREDIT_RESERVE_FAILED,
  INSUFFICIENT_SMS_CREDIT,
} from '../communications/credits/insufficient-sms-credit.constants';
import {
  AbsenceNoticePreviewResponseDto,
  AbsenceNoticeSendResponseDto,
} from './dto/absence-notice.dto';

/**
 * Mirrors `communications/reminders.service.ts`'s `SkipReason` shape and
 * exact string values so `guardian_notifications_disabled` etc. mean the
 * same thing everywhere a skip reason is logged, but is declared locally
 * rather than imported — this module's skip vocabulary is a subset (no
 * `NO_OPEN_DUES`, no `MEDIUM_NOT_ALLOWED`; absence notices are never
 * medium-restricted by the caller) and the two are free to diverge later
 * without one file's changes leaking into the other's contract.
 */
export const AbsenceNoticeSkipReason = {
  NO_GUARDIANS: 'no_guardians',
  NOTIFICATIONS_DISABLED: 'guardian_notifications_disabled',
  NO_AUTOMATED_PROVIDER: 'preferred_medium_has_no_automated_provider',
  MISSING_ADDRESS: 'guardian_has_no_address_for_preferred_medium',
} as const;

export interface AbsenceSkippedRecipient {
  student_id: string;
  guardian_id: string | null;
  reason: string;
}

/** One guardian, grouped across every one of their children absent that
 * day — "one guardian with 3 absent children gets exactly one message
 * naming all 3", not three separate sends. */
export interface AbsenceResolvedRecipient {
  guardian: Guardian;
  medium: CommunicationMedium;
  address: string;
  students: Student[];
  vars: ReminderTemplateVars;
}

interface AbsenceRecipientResolution {
  session: AttendanceSession | null;
  className: string;
  sectionName: string;
  schoolName: string;
  recipients: AbsenceResolvedRecipient[];
  skipped: AbsenceSkippedRecipient[];
  /** The absence template chosen for the school's locale. */
  template: string;
}

/** Kept short and placeholder-only — SMS segments cost money, per the
 * `sms-segment-counter.tsx` convention the fee-reminder composer follows.
 * Not yet tenant-overridable: `AttendancePolicySettings` has no message-
 * template field, and adding one is a schema change this ticket's touched
 * files don't include (see the implementation report for this divergence
 * from the plan's "next to tenant-settings defaults" suggestion). */
export const DEFAULT_ABSENCE_NOTICE_TEMPLATE =
  'Dear Guardian, {{student_names}} was marked absent today ({{date}}) in ' +
  '{{section_name}} at {{school_name}}. If this is a mistake, please contact the school.';

/** [D15] Bangla-locale schools get the Bangla text. */
export const ABSENCE_NOTICE_TEMPLATE_BN =
  'প্রিয় অভিভাবক, {{student_names}} আজ ({{date}}) {{school_name}}-এর {{section_name}}-এ অনুপস্থিত ছিল। ভুল হলে স্কুলে যোগাযোগ করুন।';

/** [D16] Sent when a teacher corrects a child to not-absent after the notice
 * went out. Neutral on purpose: the new status may be PRESENT, LATE or LEAVE,
 * and the register may be from an earlier day (#2262). */
const ABSENCE_CORRECTION_TEMPLATE_EN =
  'Correction: {{student_names}} was not absent on {{date}}. Sorry for the earlier message.';
const ABSENCE_CORRECTION_TEMPLATE_BN =
  'সংশোধন: {{student_names}} {{date}} তারিখে অনুপস্থিত ছিল না। আগের বার্তার জন্য দুঃখিত।';

/**
 * Builds and sends the guardian-facing "your child was marked absent today"
 * notice for one section's finalized register. [9.8]
 *
 * Recipient resolution (`buildRecipients`) is pure and read-only, shared by
 * both the preview route and `sendAbsenceNotices` — a sender must see
 * exactly what a send would do, never a different resolution. Reuses
 * `reminder-recipients.util.ts`'s guardian-selection/opt-out/medium rules
 * as-is (they take `Guardian[]` and know nothing about fees), but this
 * module's own recipient shape and skip vocabulary, because the fee path's
 * `resolveRecipients` filters on open dues — nothing here fits it.
 */
@Injectable()
export class AbsenceNoticeService {
  private readonly logger = new Logger(AbsenceNoticeService.name);

  constructor(
    @InjectRepository(AttendanceSession)
    private readonly sessionRepo: Repository<AttendanceSession>,
    @InjectRepository(AttendanceRecord)
    private readonly recordRepo: Repository<AttendanceRecord>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(ReminderBatch)
    private readonly batchRepo: Repository<ReminderBatch>,
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly schoolsService: SchoolsService,
    private readonly smsCreditService: SmsCreditService,
  ) {}

  // ---------------------------------------------------------------------
  // Recipient resolution — no writes, no sending.
  // ---------------------------------------------------------------------

  async buildRecipients(params: {
    tenantId: string;
    sectionId: string;
    date: string;
  }): Promise<AbsenceRecipientResolution> {
    const { tenantId, sectionId, date } = params;
    const { className, sectionName, schoolName } = await this.loadSectionContext(
      tenantId,
      sectionId,
    );

    const session = await this.sessionRepo.findOne({
      where: { tenant_id: tenantId, section_id: sectionId, date, period_no: IsNull() },
    });
    if (!session || session.state !== AttendanceSessionState.FINALIZED) {
      return {
        session,
        className,
        sectionName,
        schoolName,
        recipients: [],
        skipped: [],
        template: await this.absenceTemplate(tenantId),
      };
    }

    const { recipients, skipped, template } = await this.resolveAbsentees(
      this.dataSource.manager,
      tenantId,
      session,
      sectionName,
      schoolName,
    );
    return { session, className, sectionName, schoolName, recipients, skipped, template };
  }

  /**
   * Walks a finalized session's `ABSENT` records → students → guardians,
   * grouping by guardian so one guardian with several absent children
   * produces one recipient. `LATE` and `LEAVE` never appear here — an
   * approved leave or a late arrival is not an absence, and texting a
   * guardian about one destroys trust in the channel for real absences.
   *
   * A guardian who cannot be reached at all (no automated provider for
   * their preferred medium, or no address for it) is skipped once, not
   * once per absent child — the reason doesn't change on a second student,
   * and a repeated skip row would just double-count the same guardian in
   * `skipped_count`.
   */
  private async resolveAbsentees(
    manager: EntityManager,
    tenantId: string,
    session: AttendanceSession,
    sectionName: string,
    schoolName: string,
    /** One student, in whatever status they have now — used by corrections. */
    only?: { studentId: string; status: AttendanceStatus },
  ): Promise<{
    recipients: AbsenceResolvedRecipient[];
    skipped: AbsenceSkippedRecipient[];
    template: string;
  }> {
    const recordRepo = manager.getRepository(AttendanceRecord);
    const studentRepo = manager.getRepository(Student);
    const locale = await this.noticeLocale(tenantId);
    const template = locale === 'bn' ? ABSENCE_NOTICE_TEMPLATE_BN : DEFAULT_ABSENCE_NOTICE_TEMPLATE;

    const absentRecords = await recordRepo.find({
      where: {
        session_id: session.id,
        tenant_id: tenantId,
        status: only?.status ?? AttendanceStatus.ABSENT,
        ...(only ? { student_id: only.studentId } : {}),
      },
    });
    // #2269: a child who left the section since the register was marked is
    // not texted about it (roster as of today, not the session date).
    const timezone =
      (await this.schoolsService.getResolvedSettings(tenantId)).region?.timezone ?? 'UTC';
    const roster = new Set(
      await sectionRosterStudentIds(manager, tenantId, session.section_id, {
        onRollOn: localToday(timezone),
      }),
    );
    const studentIds = absentRecords.map((r) => r.student_id).filter((id) => roster.has(id));
    if (studentIds.length === 0) {
      return { recipients: [], skipped: [], template };
    }

    const students = await studentRepo.find({
      where: { id: In(studentIds), tenant_id: tenantId },
      relations: ['guardians'],
    });

    const skipped: AbsenceSkippedRecipient[] = [];
    const byGuardian = new Map<
      string,
      { guardian: Guardian; medium: CommunicationMedium; address: string; students: Student[] }
    >();
    const unreachableGuardianIds = new Set<string>();

    for (const student of students) {
      const linked = student.guardians ?? [];
      if (linked.length === 0) {
        skipped.push({
          student_id: student.id,
          guardian_id: null,
          reason: AbsenceNoticeSkipReason.NO_GUARDIANS,
        });
        continue;
      }

      const { guardians, skippedOptOut } = resolveReminderAudience(linked);
      for (const guardian of skippedOptOut) {
        skipped.push({
          student_id: student.id,
          guardian_id: guardian.id,
          reason: AbsenceNoticeSkipReason.NOTIFICATIONS_DISABLED,
        });
      }

      for (const guardian of guardians) {
        if (unreachableGuardianIds.has(guardian.id)) continue;

        let entry = byGuardian.get(guardian.id);
        if (!entry) {
          const medium = guardian.preferred_communication;
          if (!DISPATCHABLE_MEDIA.includes(medium)) {
            skipped.push({
              student_id: student.id,
              guardian_id: guardian.id,
              reason: AbsenceNoticeSkipReason.NO_AUTOMATED_PROVIDER,
            });
            unreachableGuardianIds.add(guardian.id);
            continue;
          }
          const address = addressForMedium(guardian, medium);
          if (!address) {
            skipped.push({
              student_id: student.id,
              guardian_id: guardian.id,
              reason: AbsenceNoticeSkipReason.MISSING_ADDRESS,
            });
            unreachableGuardianIds.add(guardian.id);
            continue;
          }
          entry = { guardian, medium, address, students: [] };
          byGuardian.set(guardian.id, entry);
        }
        entry.students.push(student);
      }
    }

    const recipients: AbsenceResolvedRecipient[] = [...byGuardian.values()].map((entry) => ({
      guardian: entry.guardian,
      medium: entry.medium,
      address: entry.address,
      students: entry.students,
      vars: {
        student_names: joinStudentNames(
          entry.students.map((s) =>
            locale === 'bn' ? (s.full_name_bn ?? s.full_name) : s.full_name,
          ),
          locale === 'bn' ? 'bn-BD' : 'en-US',
        ),
        date: session.date,
        section_name: sectionName,
        school_name: schoolName,
      },
    }));

    return { recipients, skipped, template };
  }

  /** No stored locale resolves to the bn-BD default (#3136). */
  private async noticeLocale(tenantId: string) {
    const school = await this.schoolsService.findById(tenantId);
    return resolveTemplateLocale(school.settings?.region?.locale);
  }

  private async absenceTemplate(tenantId: string): Promise<string> {
    return (await this.noticeLocale(tenantId)) === 'bn'
      ? ABSENCE_NOTICE_TEMPLATE_BN
      : DEFAULT_ABSENCE_NOTICE_TEMPLATE;
  }

  private async loadSectionContext(
    tenantId: string,
    sectionId: string,
  ): Promise<{ className: string; sectionName: string; schoolName: string }> {
    const section = await this.sectionRepo.findOne({
      where: { id: sectionId, tenant_id: tenantId },
      relations: ['class', 'tenant'],
    });
    // `findOne` excludes soft-deleted sections by default, but the
    // scheduler's own session query does not check the section's
    // deleted_at — a finalized session can still reference one that was
    // since removed. Silently falling back to empty names would let a
    // batch and SMS go out naming no section at all; fail loudly instead.
    if (!section) {
      throw new NotFoundException('Section not found');
    }
    return {
      className: section.class?.name ?? '',
      sectionName: section.section_name,
      schoolName: section.tenant?.name ?? '',
    };
  }

  // ---------------------------------------------------------------------
  // Preview — resolves exactly what `sendAbsenceNotices` would do, sends
  // nothing.
  // ---------------------------------------------------------------------

  async previewAbsenceNotice(params: {
    tenantId: string;
    sectionId: string;
    date: string;
    userId: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<AbsenceNoticePreviewResponseDto> {
    const { tenantId, sectionId, date, userId, ip, userAgent } = params;
    const { session, recipients, skipped, template } = await this.buildRecipients({
      tenantId,
      sectionId,
      date,
    });

    await this.auditService.record({
      action: AuditAction.REMINDER_PREVIEWED,
      entity_type: 'AbsenceNoticePreview',
      entity_id: session?.id ?? null,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: ip,
      user_agent: userAgent,
      new_values: {
        section_id: sectionId,
        date,
        recipient_count: recipients.length,
        skipped_count: skipped.length,
      },
    });

    return {
      session_found: !!session,
      finalized: session?.state === AttendanceSessionState.FINALIZED,
      already_notified: !!session?.notified_at,
      recipients: recipients.map((r) => ({
        guardian_id: r.guardian.id,
        guardian_name: r.guardian.full_name,
        medium: r.medium,
        address: r.address,
        student_ids: r.students.map((s) => s.id),
        student_names: r.students.map((s) => s.full_name),
        message_body: renderReminderTemplate(template, r.vars),
      })),
      skipped,
      message_preview: template,
    };
  }

  // ---------------------------------------------------------------------
  // Send — the only path that actually queues messages and marks a session
  // notified. Called from three places: the manual `send` route, [9.8]'s
  // scheduler sweep, and `AttendanceService.putRegister` right after a
  // teacher-initiated `finalize: true`.
  // ---------------------------------------------------------------------

  async sendAbsenceNotices(params: {
    tenantId: string;
    sectionId: string;
    date: string;
    initiatedByUserId: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<AbsenceNoticeSendResponseDto> {
    const { tenantId, sectionId, date, initiatedByUserId, ip = null, userAgent = null } = params;

    const { className, sectionName, schoolName } = await this.loadSectionContext(
      tenantId,
      sectionId,
    );

    // Everything that decides *whether* to send, plus the batch row and the
    // `notified_at` stamp, happens in one transaction under a row lock — the
    // idempotency guarantee is the `FOR UPDATE` read below, not an
    // in-memory check, so two concurrent callers (the scheduler and a
    // manual send, say) can never both queue a batch for the same session.
    const outcome = await this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(AttendanceSession);
      const session = await sessionRepo.findOne({
        where: { tenant_id: tenantId, section_id: sectionId, date, period_no: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) {
        return { batch: null, recipients: [], template: '', skipped_reason: 'no_session' as const };
      }
      if (session.state !== AttendanceSessionState.FINALIZED) {
        return {
          batch: null,
          recipients: [],
          template: '',
          skipped_reason: 'not_finalized' as const,
        };
      }
      if (session.notified_at) {
        return {
          batch: null,
          recipients: [],
          template: '',
          skipped_reason: 'already_notified' as const,
        };
      }

      const { recipients, skipped, template } = await this.resolveAbsentees(
        manager,
        tenantId,
        session,
        sectionName,
        schoolName,
      );

      const batchRepo = manager.getRepository(ReminderBatch);
      const batch = await batchRepo.save(
        batchRepo.create({
          tenant_id: tenantId,
          batch_name: `Absence notice — ${className} ${sectionName} — ${date}`.slice(0, 200),
          status:
            recipients.length === 0
              ? ReminderBatchStatus.COMPLETED
              : ReminderBatchStatus.PROCESSING,
          total_recipients: recipients.length,
          message_template: template,
          initiated_by_user_id: initiatedByUserId,
          filters_applied: { purpose: 'ABSENCE_NOTICE', section_id: sectionId, date, skipped },
        }),
      );

      session.notified_at = new Date();
      await sessionRepo.save(session);

      return { batch, recipients, template, skipped_reason: null };
    });

    if (outcome.batch) {
      await this.auditService.record({
        action: AuditAction.REMINDER_SENT,
        entity_type: 'ReminderBatch',
        entity_id: outcome.batch.id,
        tenant_id: tenantId,
        performed_by_user_id: initiatedByUserId,
        ip_address: ip,
        user_agent: userAgent,
        new_values: {
          section_id: sectionId,
          date,
          recipient_count: outcome.recipients.length,
        },
      });

      // Enqueueing happens after the transaction has committed — a job
      // that fails to enqueue must never roll back the batch row or the
      // `notified_at` stamp; the batch stays visible in Reminder History
      // recording that a send was attempted, which is recoverable, unlike
      // silently losing the fact a batch happened at all.
      await this.queueRecipients(
        outcome.batch,
        outcome.recipients,
        tenantId,
        initiatedByUserId,
        outcome.template,
      );
    }

    return {
      batch_id: outcome.batch?.id ?? null,
      status: outcome.batch?.status ?? null,
      total_recipients: outcome.recipients.length,
      skipped_reason: outcome.skipped_reason,
    };
  }

  /**
   * [D16] A teacher corrected one record after the register was notified.
   * The guardian's latest message about this child and register must match
   * the record (#2262). So compare with what they were last told: the newest
   * notice or correction for this child that did not fail. Nothing told
   * counts as "not absent". Send only when the absent / not-absent answer
   * differs: a "sorry" after a notice, a notice after a "sorry" (or after
   * nothing). Guardians of other children get nothing. Callers wrap it in
   * try/catch because the correction itself has already committed.
   */
  async notifyCorrection(params: {
    tenantId: string;
    sessionId: string;
    studentId: string;
    oldStatus: AttendanceStatus;
    newStatus: AttendanceStatus;
    userId: string;
  }): Promise<void> {
    const { tenantId, sessionId, studentId, oldStatus, newStatus, userId } = params;
    const isAbsent = newStatus === AttendanceStatus.ABSENT;
    if ((oldStatus === AttendanceStatus.ABSENT) === isAbsent) return;

    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tenant_id: tenantId },
    });
    if (!session || session.period_no !== null) return;
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    if (!resolveAttendancePolicy(settings).autoAbsentNotification.enabled) return;

    // [84.3.1 / D14] An arrival notice ("reached school") counts as a not-absent message, so
    // PRESENT->ABSENT after one tells the guardian, and ABSENT->PRESENT after one says nothing new.
    const [{ last_told, batches }] = (await this.dataSource.query(
      `WITH told AS (
         SELECT b.filters_applied->>'purpose' AS purpose, l.created_at, l.status, l.reminder_batch_id
           FROM communication_logs l
           JOIN reminder_batches b ON b.id = l.reminder_batch_id AND b.tenant_id = $1
          WHERE l.tenant_id = $1 AND l.metadata->'student_ids' @> to_jsonb($4::text)
            AND b.filters_applied->>'purpose' IN ('ABSENCE_NOTICE', 'ABSENCE_CORRECTION')
            AND b.filters_applied->>'section_id' = $2 AND b.filters_applied->>'date' = $3
         UNION ALL
         SELECT 'ARRIVAL_NOTICE', l.created_at, l.status, NULL::uuid
           FROM communication_logs l
          WHERE l.tenant_id = $1 AND l.trigger = $6 AND l.student_id::text = $4
            AND l.reference_key LIKE 'arrival:' || $3 || ':%'
       )
       SELECT (array_agg(purpose ORDER BY created_at DESC) FILTER (WHERE status <> $5))[1] AS last_told,
              count(DISTINCT reminder_batch_id)::int AS batches
         FROM told`,
      [
        tenantId,
        session.section_id,
        session.date,
        studentId,
        CommunicationStatus.FAILED,
        CommunicationTrigger.ARRIVAL_NOTICE,
      ],
    )) as { last_told: string | null; batches: number }[];
    // No absence notice was ever sent and no arrival notice either: nothing to correct.
    // An arrival notice only counts on a FINALIZED register: on a DRAFT, finalize itself sends
    // the absence notice, so correcting here too would message the guardian twice.
    if (
      !session.notified_at &&
      (last_told !== 'ARRIVAL_NOTICE' || session.state !== AttendanceSessionState.FINALIZED)
    ) {
      return;
    }
    if ((last_told === 'ABSENCE_NOTICE') === isAbsent) return;

    // One key per message in this child's thread (FAILED ones included, so a
    // retry after a failure gets a fresh key): two racing corrections that
    // both decided to send share a key, and the unique index lets one through.
    const keyPrefix = `absence-correction:${sessionId}:${studentId}:${batches + 1}`;

    const { sectionName, schoolName } = await this.loadSectionContext(tenantId, session.section_id);
    const { recipients, template } = await this.resolveAbsentees(
      this.dataSource.manager,
      tenantId,
      session,
      sectionName,
      schoolName,
      { studentId, status: newStatus },
    );
    if (recipients.length === 0) return;
    const body = isAbsent
      ? template
      : template === ABSENCE_NOTICE_TEMPLATE_BN
        ? ABSENCE_CORRECTION_TEMPLATE_BN
        : ABSENCE_CORRECTION_TEMPLATE_EN;

    const batch = await this.batchRepo.save(
      this.batchRepo.create({
        tenant_id: tenantId,
        batch_name:
          `Absence ${isAbsent ? 'notice' : 'correction'} — ${sectionName} — ${session.date}`.slice(
            0,
            200,
          ),
        status: ReminderBatchStatus.PROCESSING,
        total_recipients: recipients.length,
        message_template: body,
        initiated_by_user_id: userId,
        filters_applied: {
          purpose: isAbsent ? 'ABSENCE_NOTICE' : 'ABSENCE_CORRECTION',
          section_id: session.section_id,
          date: session.date,
          student_id: studentId,
        },
      }),
    );
    await this.queueRecipients(batch, recipients, tenantId, userId, body, keyPrefix);
  }

  /** Mirrors `BulkReminderService.queueRecipients` — one `CommunicationLog`
   * row and one queue job per guardian, same worker, same retry policy. A
   * recipient here can name several students, so unlike the fee path's
   * one-student-per-log, `metadata.student_ids` carries the full list and
   * `student_id` is only the first — enough for the existing per-log
   * drill-down to link back to a real student without a schema change. */
  private async queueRecipients(
    batch: ReminderBatch,
    recipients: AbsenceResolvedRecipient[],
    tenantId: string,
    userId: string,
    template: string,
    /** Per-guardian idempotency key prefix (corrections only). */
    referenceKeyPrefix?: string,
  ): Promise<void> {
    for (const recipient of recipients) {
      let log: CommunicationLog;
      try {
        log = await this.logRepo.save(
          this.logRepo.create({
            tenant_id: tenantId,
            reminder_batch_id: batch.id,
            medium: recipient.medium,
            recipient_address: recipient.address,
            recipient_name: recipient.guardian.full_name,
            message_body: renderReminderTemplate(template, recipient.vars),
            reference_key: referenceKeyPrefix
              ? `${referenceKeyPrefix}:${recipient.guardian.id}`
              : null,
            // Stored for every medium, not only EMAIL: `tryPushFirst`
            // (`communications.processor.ts`) reads `log.subject` as the
            // push notification's title, and this is the only place that
            // knows it — falling back to a generic "Notification" there
            // loses the absence-notice title entirely for push recipients.
            subject: 'Absence Notice',
            student_id: recipient.students[0]?.id ?? null,
            guardian_id: recipient.guardian.id,
            sent_by_user_id: userId,
            status: CommunicationStatus.QUEUED,
            trigger: CommunicationTrigger.AUTOMATED,
            metadata: { student_ids: recipient.students.map((s) => s.id) },
          }),
        );
      } catch (error) {
        // Unlike the `queue.add` failure below, there is no log row to
        // mark FAILED — it never got created. A transient insert error
        // (connection drop, deadlock, a constraint violation) must not
        // abort every *remaining* recipient in this batch, so record the
        // outcome and move on rather than letting the exception propagate.
        this.logger.warn(
          `Failed to create CommunicationLog for batch ${batch.id}, guardian ${recipient.guardian.id}: ${String(error)}`,
        );
        await recordBatchOutcome(this.logRepo.manager, batch.id, 'failure');
        continue;
      }

      // [#2216] Metered SMS must hold credit before it is queued. A reserve
      // that throws fails this log only — never strand it QUEUED or abort
      // the remaining recipients.
      const credit = await this.smsCreditService
        .reserveForLog(tenantId, log)
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to reserve SMS credit for absence-notice log ${log.id}: ${String(error)}`,
          );
          return CREDIT_RESERVE_FAILED;
        });
      if (typeof credit === 'string') {
        log.status = CommunicationStatus.FAILED;
        log.metadata = {
          ...log.metadata,
          reason: credit === 'INSUFFICIENT' ? INSUFFICIENT_SMS_CREDIT : credit,
        };
        await this.logRepo.manager.transaction(async (manager) => {
          await manager.save(log);
          await recordBatchOutcome(manager, batch.id, 'failure');
        });
        continue;
      }

      try {
        await this.queue.add('send', { logId: log.id, ...credit });
      } catch (error) {
        if (credit.segments !== undefined) {
          await this.smsCreditService.releaseForLog(tenantId, log.id, credit.segments);
        }
        this.logger.warn(
          `Failed to enqueue absence-notice log ${log.id} for batch ${batch.id}: ${String(error)}`,
        );
        log.status = CommunicationStatus.FAILED;
        log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
        await this.logRepo.manager.transaction(async (manager) => {
          await manager.save(log);
          await recordBatchOutcome(manager, batch.id, 'failure');
        });
      }
    }
  }
}
