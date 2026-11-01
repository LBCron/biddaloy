import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import {
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
  AttendanceStatus,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
} from '@biddaloy/shared';
import { ArrivalNoticeSubscription } from './entities/arrival-notice-subscription.entity';
import { AttendanceDevice } from './entities/attendance-device.entity';
import { CommunicationLog, PUSH_MEDIUM } from '../communications/entities/communication-log.entity';
import { failUnclaimedLog } from '../communications/worker/log-claim';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { partitionByOptOut } from '../communications/reminder-recipients.util';
import { renderReminderTemplate } from '../communications/reminder-template.util';
import { resolveFeeNotificationLocale } from '../communications/fee-notification-template.util';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import {
  CREDIT_RESERVE_FAILED,
  INSUFFICIENT_SMS_CREDIT,
} from '../communications/credits/insufficient-sms-credit.constants';
import { SchoolsService } from '../schools/schools.service';
import { Student } from '../students/entities/student.entity';
import { localToday } from '../../common/time';

/** [84.2.2 / D12] Two wordings per locale. The teacher text never claims an arrival time. */
export const ARRIVAL_TEMPLATES = {
  en: {
    TEACHER: '{{student_name}} is present today at {{time}} — {{taken_by}}.',
    DEVICE: '{{student_name}} reached school today at {{time}} — {{taken_by}}.',
  },
  bn: {
    TEACHER: '{{student_name}} আজ {{time}}-এ উপস্থিত — {{taken_by}}।',
    DEVICE: '{{student_name}} আজ {{time}}-এ স্কুলে পৌঁছেছে — {{taken_by}}।',
  },
} as const;

const OFFICE = { en: 'the office', bn: 'অফিস' } as const;
const ENQUEUE_TIMEOUT_MS = 3000;
const PG_UNIQUE_VIOLATION = '23505';
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export type ArrivalTakenBy =
  { kind: 'TEACHER'; userId: string } | { kind: 'DEVICE'; deviceId: string };

export interface ArrivalStudent {
  studentId: string;
  status: AttendanceStatus;
  occurredAt: Date;
}

export const ArrivalSkipReason = {
  NO_USER: 'guardian_has_no_user_for_push',
  SMS_NOT_ALLOWED: 'sms_not_allowed',
  NO_PHONE: 'guardian_has_no_phone',
  INSUFFICIENT_CREDIT: 'insufficient_sms_credit',
  CREDIT_RESERVE_FAILED: 'credit_reserve_failed',
  ALREADY_SENT: 'already_sent_today',
  ENQUEUE_FAILED: 'enqueue_failed',
} as const;

export interface ArrivalNoticeResult {
  queued: number;
  skipped: { studentId: string; guardianId: string; reason: string }[];
}

/** `h:mm` with Bangla digits and a day-part word (bn), or `HH:mm` (en), in the school timezone. */
export function formatArrivalTime(at: Date, timezone: string, locale: 'en' | 'bn'): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')!.value);
  const minute = parts.find((p) => p.type === 'minute')!.value;
  if (locale === 'en') return `${String(hour).padStart(2, '0')}:${minute}`;
  const word = hour < 12 ? 'সকাল' : hour < 16 ? 'দুপুর' : 'বিকাল';
  const digits = `${hour % 12 || 12}:${minute}`.replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
  return `${word} ${digits}`;
}

/**
 * [84.2.2] Queues one arrival notice per ACTIVE subscription for the students just marked in.
 * Nothing calls it yet (84.3.1). Dedupe is the `(tenant_id, reference_key)` unique index, never a
 * code check. Failures (Redis down included) are logged and swallowed: the register still saves
 * (D26, Rule 15).
 */
@Injectable()
export class ArrivalNoticeService {
  private readonly logger = new Logger(ArrivalNoticeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(COMMUNICATIONS_QUEUE) private readonly queue: Queue,
    private readonly schoolsService: SchoolsService,
    private readonly smsCreditService: SmsCreditService,
  ) {}

  async sendArrivalNotices(params: {
    tenantId: string;
    date: string;
    students: ArrivalStudent[];
    takenBy: ArrivalTakenBy;
  }): Promise<ArrivalNoticeResult> {
    const result: ArrivalNoticeResult = { queued: 0, skipped: [] };
    try {
      await this.run(params, result);
    } catch (error) {
      this.logger.warn(`Arrival notices skipped for tenant ${params.tenantId}: ${String(error)}`);
    }
    return result;
  }

  private async run(
    params: Parameters<ArrivalNoticeService['sendArrivalNotices']>[0],
    result: ArrivalNoticeResult,
  ): Promise<void> {
    const { tenantId, date, takenBy } = params;
    // D21: only PRESENT and LATE count as "reached".
    const arrived = new Map(
      params.students
        .filter((s) => s.status === AttendanceStatus.PRESENT || s.status === AttendanceStatus.LATE)
        .map((s) => [s.studentId, s]),
    );
    if (arrived.size === 0) return;

    const [locale, timezone, smsAllowed] = await this.loadSchool(tenantId);
    // The text says "today": a late finalize of an earlier day or an old device backlog sends nothing.
    if (date !== localToday(timezone)) return;

    // D6 / lock: NEVER is dropped in SQL; opt-out is applied after, so it beats ALWAYS.
    const subs = await this.dataSource
      .getRepository(ArrivalNoticeSubscription)
      .createQueryBuilder('sub')
      .innerJoinAndSelect('sub.guardian', 'guardian', 'guardian.tenant_id = :tenantId')
      .where('sub.tenant_id = :tenantId', { tenantId })
      .andWhere('sub.student_id IN (:...ids)', { ids: [...arrived.keys()] })
      .andWhere('sub.status = :active', { active: ArrivalNoticeStatus.ACTIVE })
      .andWhere('sub.lock <> :never', { never: ArrivalNoticeLock.NEVER })
      .andWhere('sub.consumed_at IS NULL')
      // A guardian unlinked from the child keeps no subscription rights (the row may survive).
      .andWhere(
        'EXISTS (SELECT 1 FROM student_guardians sg WHERE sg.student_id = sub.student_id AND sg.guardian_id = sub.guardian_id)',
      )
      .getMany();
    // D7: no primary-only rule; each subscription stands on its own.
    const reachableGuardians = new Set(
      partitionByOptOut(subs.map((s) => s.guardian)).reachable.map((g) => g.id),
    );
    const live = subs.filter((s) => reachableGuardians.has(s.guardian_id));
    if (live.length === 0) return;

    const students = new Map(
      (
        await this.dataSource
          .getRepository(Student)
          .createQueryBuilder('s')
          .where('s.tenant_id = :tenantId', { tenantId })
          .andWhere('s.id IN (:...ids)', { ids: [...new Set(live.map((s) => s.student_id))] })
          .getMany()
      ).map((s) => [s.id, s]),
    );
    const takenByName = await this.resolveTakenBy(tenantId, takenBy, locale);
    const finalizedAt = new Date();

    for (const sub of live) {
      const skip = (reason: string) =>
        result.skipped.push({ studentId: sub.student_id, guardianId: sub.guardian_id, reason });
      const student = students.get(sub.student_id);
      if (!student) continue;
      const sms = sub.channel === ArrivalNoticeChannel.SMS;
      const guardian = sub.guardian;
      if (sms && !smsAllowed) {
        skip(ArrivalSkipReason.SMS_NOT_ALLOWED);
        continue;
      }
      if (sms && !guardian.phone?.trim()) {
        skip(ArrivalSkipReason.NO_PHONE);
        continue;
      }
      if (!sms && !guardian.user_id) {
        skip(ArrivalSkipReason.NO_USER);
        continue;
      }

      // D39: the teacher text uses the finalize time, the device text the punch time.
      const at = takenBy.kind === 'DEVICE' ? arrived.get(sub.student_id)!.occurredAt : finalizedAt;
      const body = renderReminderTemplate(ARRIVAL_TEMPLATES[locale][takenBy.kind], {
        student_name: (locale === 'bn' && student.full_name_bn) || student.full_name,
        time: formatArrivalTime(at, timezone, locale),
        taken_by: takenByName,
      });
      // One failing insert must not stop the remaining guardians.
      const outcome = await this.queueOne(tenantId, date, sub, body, takenBy, sms).catch(
        (error: unknown) => {
          this.logger.warn(`Arrival notice failed for subscription ${sub.id}: ${String(error)}`);
          return ArrivalSkipReason.ENQUEUE_FAILED;
        },
      );
      if (outcome === 'QUEUED') {
        result.queued++;
        // A failed consume must not stop the remaining guardians.
        if (sub.mode === ArrivalNoticeMode.ONCE) {
          await this.consume(tenantId, sub.id).catch((error: unknown) =>
            this.logger.warn(
              `Arrival ONCE consume failed for subscription ${sub.id}: ${String(error)}`,
            ),
          );
        }
      } else skip(outcome);
    }
  }

  // ---- copies of AbsenceNoticeService's private helpers (D41) ----

  /** Resolved locale (no stored locale means the bn-BD default, #3136), the tz and the SMS switch. */
  private async loadSchool(tenantId: string): Promise<['en' | 'bn', string, boolean]> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    return [
      resolveFeeNotificationLocale(settings.region?.locale),
      settings.region?.timezone ?? 'Asia/Dhaka',
      settings.attendance?.arrivalNotice?.smsAllowed === true,
    ];
  }

  /** D38: teacher = staff name or "the office"; device = its name verbatim. */
  private async resolveTakenBy(
    tenantId: string,
    takenBy: ArrivalTakenBy,
    locale: 'en' | 'bn',
  ): Promise<string> {
    if (takenBy.kind === 'DEVICE') {
      const device = await this.dataSource
        .getRepository(AttendanceDevice)
        .findOne({ where: { id: takenBy.deviceId, tenant_id: tenantId } });
      return device?.name ?? OFFICE[locale];
    }
    // staff_hr_records.name_bn (Epic 32) is optional: bn messages use it, else the English name.
    const rows: { full_name: string; name_bn: string | null }[] = await this.dataSource.query(
      `SELECT u.full_name, h.name_bn FROM staff_profiles sp JOIN users u ON u.id = sp.user_id
        LEFT JOIN staff_hr_records h ON h.user_id = sp.user_id AND h.tenant_id = sp.tenant_id
        WHERE sp.tenant_id = $1 AND sp.user_id = $2`,
      [tenantId, takenBy.userId],
    );
    const bn = rows[0]?.name_bn?.trim();
    if (locale === 'bn' && bn) return bn;
    return rows[0]?.full_name ?? OFFICE[locale];
  }

  /**
   * Log, reserve SMS credit, enqueue. Mirrors `AbsenceNoticeService.queueRecipients`.
   * The unique index decides "already sent" (D22): a conflict is a skip, not an error.
   */
  private async queueOne(
    tenantId: string,
    date: string,
    sub: ArrivalNoticeSubscription,
    body: string,
    takenBy: ArrivalTakenBy,
    sms: boolean,
  ): Promise<'QUEUED' | string> {
    const guardian = sub.guardian;
    const repo = this.dataSource.getRepository(CommunicationLog);
    const referenceKey = `arrival:${date}:${sub.student_id}:${sub.guardian_id}`;
    let log: CommunicationLog;
    try {
      log = await repo.save(
        repo.create({
          tenant_id: tenantId,
          medium: sms ? CommunicationMedium.SMS : PUSH_MEDIUM,
          recipient_address: sms ? guardian.phone!.trim() : `push:${guardian.user_id}`,
          recipient_name: guardian.full_name,
          message_body: body,
          subject: 'Arrival Notice',
          student_id: sub.student_id,
          guardian_id: sub.guardian_id,
          sent_by_user_id: takenBy.kind === 'TEACHER' ? takenBy.userId : null,
          status: CommunicationStatus.QUEUED,
          trigger: CommunicationTrigger.ARRIVAL_NOTICE,
          reference_key: referenceKey,
          metadata: { subscription_id: sub.id },
        }),
      );
    } catch (error) {
      if ((error as { driverError?: { code?: string } }).driverError?.code === PG_UNIQUE_VIOLATION)
        return ArrivalSkipReason.ALREADY_SENT;
      throw error;
    }

    // Metered SMS must hold credit before it is queued; PUSH never reserves.
    let credit: { batchId?: string; segments?: number } = {};
    if (sms) {
      const reserved = await this.smsCreditService
        .reserveForLog(tenantId, log)
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to reserve SMS credit for arrival log ${log.id}: ${String(error)}`,
          );
          return CREDIT_RESERVE_FAILED;
        });
      if (typeof reserved === 'string') {
        const insufficient = reserved === 'INSUFFICIENT';
        log.status = CommunicationStatus.FAILED;
        // Free the key, as on enqueue failure, so a later call that day (after a top-up) can retry.
        log.reference_key = null;
        log.metadata = {
          ...log.metadata,
          reason: insufficient ? INSUFFICIENT_SMS_CREDIT : reserved,
        };
        await repo.save(log);
        return insufficient
          ? ArrivalSkipReason.INSUFFICIENT_CREDIT
          : ArrivalSkipReason.CREDIT_RESERVE_FAILED;
      }
      credit = reserved;
    }

    try {
      // Measured (Epic 84 follow-up 9): with Redis down this queue's offline queue never rejects
      // (a single add hung >180s), so N sequential adds would stall finalize. Bound each add.
      await Promise.race([
        this.queue.add('send', { logId: log.id, ...credit }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('queue add timed out')), ENQUEUE_TIMEOUT_MS).unref(),
        ),
      ]);
    } catch (error) {
      // D26: Redis/BullMQ down fails open. Free the credit and the key so a later call can retry.
      // Conditional on QUEUED + unclaimed: the add may have landed just before the timeout and a
      // worker may already own the log. Then the worker settles it; leave credit and key alone.
      this.logger.warn(`Failed to enqueue arrival log ${log.id}: ${String(error)}`);
      let failed: boolean;
      try {
        failed = await failUnclaimedLog(repo, tenantId, log.id, 'Failed to enqueue for delivery');
      } catch (dbError) {
        // The log may stay QUEUED with its key and credit held: make it loud for reconciliation.
        this.logger.error(
          `needs_reconciliation: could not fail arrival log ${log.id} after an enqueue error: ${String(dbError)}`,
        );
        return ArrivalSkipReason.ENQUEUE_FAILED;
      }
      if (!failed) return 'QUEUED';
      if (credit.segments !== undefined) {
        await this.smsCreditService.releaseForLog(tenantId, log.id, credit.segments);
      }
      return ArrivalSkipReason.ENQUEUE_FAILED;
    }
    return 'QUEUED';
  }

  /** D23: ONCE is spent when the log is enqueued, not when it is delivered. */
  private async consume(tenantId: string, subscriptionId: string): Promise<void> {
    await this.dataSource
      .getRepository(ArrivalNoticeSubscription)
      .update(
        { id: subscriptionId, tenant_id: tenantId },
        { consumed_at: new Date(), status: ArrivalNoticeStatus.OFF },
      );
  }
}
