import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, In, Repository } from 'typeorm';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  FeeType,
  countSmsSegments,
} from '@biddaloy/shared';
import { CommunicationLog } from './entities/communication-log.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { Student } from '../students/entities/student.entity';
import { FeeGenerationsService } from '../fees/fee-generations.service';
import { SchoolsService } from '../schools/schools.service';
import { SmsCreditService } from './credits/sms-credit.service';
import { COMMUNICATIONS_QUEUE } from './communications.constants';
import { whatsappConfigured } from '../schools/settings/messaging-descriptors';
import { addressForMedium, resolveReminderAudience } from './reminder-recipients.util';
import {
  buildFeeNotificationMessage,
  FeeNotificationBillLine,
  resolveFeeNotificationLocale,
} from './fee-notification-template.util';
import type { FeesGeneratedEventPayload } from '../fees/fee-generation.service';

/** `fees.generated`'s payload (emitted by #650 after a generation batch
 * commits). Thin on purpose — this listener reloads the batch and its
 * bills from the DB by id rather than trusting anything else the payload
 * might carry, so it stays correct even if the producer's shape grows.
 *
 * Delivered as a `FEE_NOTIFY_QUEUE` job (`FeeNotifyProcessor`) [68.4.10], not an
 * in-memory event, so a restart between commit and send loses nothing. */
export type FeesGeneratedEvent = FeesGeneratedEventPayload;

/** One row of `student_fees` for this batch, joined with what the message
 * and recipient resolution need. */
interface BillRow {
  student_id: string;
  student_full_name: string;
  fee_structure_name: string;
  fee_type: FeeType;
  note: string | null;
  period_start: string;
  total_amount: string;
}

/** Reason this listener created a log without ever handing it to the
 * worker — recorded in `metadata.reason`, same shape as the worker's own
 * `TENANT_SUSPENDED` marker (`communications.processor.ts`). */
const SKIPPED_NO_SMS = 'SKIPPED_NO_SMS';

/** `metadata.reason` for a log whose row was saved but whose `queue.add`
 * then failed — distinct from other FAILED reasons so it can be excluded
 * from the idempotency check below and retried on a replayed event.
 * Minimal fix; a full outbox pattern is deferred. */
const ENQUEUE_FAILED = 'ENQUEUE_FAILED';

const FEE_NOTIFICATION_EVENT = 'fee-notify';

/** One entry of the push -> WhatsApp -> SMS fallback matrix (D13). Push
 * itself is not decided here — `CommunicationsProcessor.tryPushFirst`
 * (`worker/communications.processor.ts`) already tries it for every
 * `CommunicationTrigger.AUTOMATED` log before falling through to whatever
 * this function picked, and stops (no fallback) the moment push delivers.
 * This function only answers "if push doesn't deliver, what next": WhatsApp
 * when the guardian has a dispatchable address for it, else SMS when the
 * tenant's SMS is enabled, else neither. */
export interface ResolvedFeeNotificationChannel {
  medium: CommunicationMedium.WHATSAPP | CommunicationMedium.SMS;
  address: string;
}

export function resolveFeeNotificationChannel(
  guardian: Guardian,
  smsAvailable: boolean,
  whatsappAvailable: boolean,
): ResolvedFeeNotificationChannel | null {
  // `addressForMedium` returns the guardian's phone for both WHATSAPP and
  // SMS (there's no separate "WhatsApp number" field), so a phone alone
  // can't tell the two media apart — only whether the tenant has a
  // WhatsApp provider configured at all can, same as `smsAvailable` below.
  // Without this check every guardian with a phone always got WHATSAPP and
  // the SMS branch was unreachable.
  const whatsappAddress = whatsappAvailable
    ? addressForMedium(guardian, CommunicationMedium.WHATSAPP)
    : null;
  if (whatsappAddress) {
    return { medium: CommunicationMedium.WHATSAPP, address: whatsappAddress };
  }

  const smsAddress = addressForMedium(guardian, CommunicationMedium.SMS);
  if (smsAddress && smsAvailable) {
    return { medium: CommunicationMedium.SMS, address: smsAddress };
  }

  return null;
}

/**
 * [16.3.4] "New fees added" family notification — one message per student
 * per generation batch, sent push -> WhatsApp -> SMS (D13).
 *
 * Push is not this listener's job to attempt: `CommunicationsProcessor`
 * (`worker/communications.processor.ts`) already tries push first for
 * every `CommunicationTrigger.AUTOMATED` log before falling through to
 * whatever medium the log itself carries (#555's `tryPushFirst`). This
 * listener's only decision is which medium to fall back to if push does
 * not deliver — WhatsApp when the guardian has a dispatchable address for
 * it, else SMS if the tenant's SMS is enabled and (for a metered tenant)
 * credit can be reserved, else neither (recorded, never queued).
 *
 * Idempotent per `(feeGenerationId, guardianId)` via `reference_key` — a
 * replayed event finds its prior logs and creates nothing new.
 */
@Injectable()
export class FeeNotificationsListener {
  private readonly logger = new Logger(FeeNotificationsListener.name);

  constructor(
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly feeGenerationsService: FeeGenerationsService,
    private readonly schoolsService: SchoolsService,
    private readonly smsCreditService: SmsCreditService,
  ) {}

  async handleFeesGenerated(event: FeesGeneratedEvent): Promise<void> {
    const { tenantId, feeGenerationId } = event;

    const batch = await this.feeGenerationsService.findOne(feeGenerationId, tenantId);
    if (!batch.notify_families) {
      return;
    }

    const bills = await this.loadBills(tenantId, feeGenerationId);
    if (bills.length === 0) {
      return;
    }

    const billsByStudent = new Map<string, FeeNotificationBillLine[]>();
    for (const row of bills) {
      const lines = billsByStudent.get(row.student_id) ?? [];
      lines.push({
        name: row.fee_structure_name,
        amount: Number(row.total_amount),
        feeType: row.fee_type,
        note: row.note,
        periodStart: row.period_start,
      });
      billsByStudent.set(row.student_id, lines);
    }

    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const locale = resolveFeeNotificationLocale(settings.region?.locale);
    // "Tenant's SMS is enabled" = a gateway is configured at all
    // (`communications.sms` is absent by default — see `SmsSettingsDto`).
    // `isMetered` only tells us whether credit is charged for it, not
    // whether it's turned on, so both checks are needed.
    const smsAvailable = !!settings.communications?.sms?.provider;
    const whatsappAvailable = whatsappConfigured(settings);
    const metered = await this.smsCreditService.isMetered(tenantId);

    // Group by GUARDIAN, not student: the Tests/Acceptance contract keys
    // idempotency on `(feeGenerationId, guardianId)`, so a guardian with
    // two children both billed in this batch must get exactly one message
    // (and one `reference_key`) naming every one of their children's
    // bills — mirrors `AbsenceNoticeService.resolveAbsentees`'s
    // one-guardian-several-students grouping, not the fee path's usual
    // one-student-per-log shape.
    const guardiansById = new Map<string, Guardian>();
    const linesByGuardian = new Map<string, FeeNotificationBillLine[]>();
    const studentIdsByGuardian = new Map<string, string[]>();

    // One query for every billed student rather than one findOne per
    // student — a batch can bill up to 5000 students, and the previous
    // per-student loop issued that many serial queries for a single event.
    const students = await this.dataSource.getRepository(Student).find({
      where: { id: In([...billsByStudent.keys()]), tenant_id: tenantId },
      relations: ['guardians'],
    });
    const studentsById = new Map(students.map((s) => [s.id, s]));

    for (const [studentId, lines] of billsByStudent) {
      const linked: Guardian[] = studentsById.get(studentId)?.guardians ?? [];
      if (linked.length === 0) continue;

      const { guardians } = resolveReminderAudience(linked);
      for (const guardian of guardians) {
        guardiansById.set(guardian.id, guardian);
        const existingLines = linesByGuardian.get(guardian.id) ?? [];
        linesByGuardian.set(guardian.id, [...existingLines, ...lines]);
        const studentIds = studentIdsByGuardian.get(guardian.id) ?? [];
        studentIds.push(studentId);
        studentIdsByGuardian.set(guardian.id, studentIds);
      }
    }

    interface PlannedSend {
      guardianId: string;
      recipientAddress: string;
      recipientName: string;
      medium: CommunicationMedium;
      message: string;
      referenceKey: string;
      segments?: number;
    }
    const planned: PlannedSend[] = [];
    const skippedNoSms: Array<{
      guardianId: string;
      recipientAddress: string;
      recipientName: string;
      referenceKey: string;
    }> = [];

    for (const [guardianId, guardian] of guardiansById) {
      const lines = linesByGuardian.get(guardianId) ?? [];
      // A guardian whose batch mixes FINE and non-FINE bills gets two
      // messages, not one — a fine's reason (`note`) would otherwise get
      // buried in (or push out of an SMS segment) the generic "new fees
      // added" list (Steps §2). Each half gets its own `reference_key` so
      // they're independently idempotent and independently retryable.
      const fineLines = lines.filter((line) => line.feeType === FeeType.FINE);
      const otherLines = lines.filter((line) => line.feeType !== FeeType.FINE);

      const channel = resolveFeeNotificationChannel(guardian, smsAvailable, whatsappAvailable);

      const messageGroups: Array<{ referenceKey: string; message: string }> = [];
      if (otherLines.length > 0) {
        messageGroups.push({
          referenceKey: `${FEE_NOTIFICATION_EVENT}:${feeGenerationId}:${guardianId}`,
          message: buildFeeNotificationMessage(locale, otherLines, batch.due_date),
        });
      }
      if (fineLines.length > 0) {
        messageGroups.push({
          referenceKey: `${FEE_NOTIFICATION_EVENT}:${feeGenerationId}:${guardianId}:fine`,
          message: buildFeeNotificationMessage(locale, fineLines, batch.due_date),
        });
      }

      for (const { referenceKey, message } of messageGroups) {
        if (!channel) {
          skippedNoSms.push({
            guardianId,
            recipientAddress: addressForMedium(guardian, CommunicationMedium.SMS) ?? 'unknown',
            recipientName: guardian.full_name,
            referenceKey,
          });
          continue;
        }

        planned.push({
          guardianId,
          recipientAddress: channel.address,
          recipientName: guardian.full_name,
          medium: channel.medium,
          message,
          referenceKey,
          segments:
            channel.medium === CommunicationMedium.SMS
              ? countSmsSegments(message).segments
              : undefined,
        });
      }
    }

    // Idempotency: drop anything this event (or a prior delivery attempt
    // for the same batch) already logged.
    const allKeys = [
      ...planned.map((p) => p.referenceKey),
      ...skippedNoSms.map((s) => s.referenceKey),
    ];
    if (allKeys.length === 0) {
      return;
    }
    const existing = await this.logRepo.find({
      where: allKeys.map((reference_key) => ({ tenant_id: tenantId, reference_key })),
      select: ['id', 'reference_key', 'status', 'metadata'],
    });
    // A row that failed to enqueue (ENQUEUE_FAILED) never reached the
    // worker, so it must not block a replayed event from retrying it. Such
    // a row is re-claimed in place by `writeLog` rather than inserted
    // again — the (tenant_id, reference_key) unique index would reject a
    // second row for the same key.
    const alreadyLogged = new Set<string>();
    const replayable = new Map<string, string>();
    for (const row of existing) {
      if (row.reference_key === null) continue;
      const enqueueFailed =
        row.status === CommunicationStatus.FAILED &&
        (row.metadata as { reason?: string } | null)?.reason === ENQUEUE_FAILED;
      if (enqueueFailed) {
        replayable.set(row.reference_key, row.id);
      } else {
        alreadyLogged.add(row.reference_key);
      }
    }

    const toSend = planned.filter((p) => !alreadyLogged.has(p.referenceKey));
    const toSkip = skippedNoSms.filter((s) => !alreadyLogged.has(s.referenceKey));

    // Reserve the batch's total SMS units once, before any log/job exists —
    // same reasoning as `BulkReminderService.sendBulk`. On insufficient
    // credit, every SMS recipient in this event falls back to being logged
    // as SKIPPED_NO_SMS instead of throwing: a family generation event has
    // no caller waiting on an HTTP response to fail, and WhatsApp
    // recipients must still be sent.
    const smsSends = toSend.filter((p) => p.medium === CommunicationMedium.SMS);
    const totalSmsUnits = smsSends.reduce((sum, p) => sum + (p.segments ?? 0), 0);
    const batchReservationKey = `${FEE_NOTIFICATION_EVENT}:${feeGenerationId}:sms`;
    let smsReserved = totalSmsUnits === 0;
    if (totalSmsUnits > 0 && metered) {
      const reservation = await this.smsCreditService.reserve(
        tenantId,
        totalSmsUnits,
        // Key convention (#1317): reserve `batch:<id>`, the job carries the bare id.
        `batch:${batchReservationKey}`,
        { type: 'batch', id: feeGenerationId },
      );
      smsReserved = reservation.ok;
    } else if (totalSmsUnits > 0) {
      smsReserved = true;
    }

    let enqueueFailures = 0;
    for (const item of toSend) {
      if (item.medium === CommunicationMedium.SMS && !smsReserved) {
        toSkip.push({
          guardianId: item.guardianId,
          recipientAddress: item.recipientAddress,
          recipientName: item.recipientName,
          referenceKey: item.referenceKey,
        });
        continue;
      }

      const log = await this.writeLog(tenantId, replayable, item.referenceKey, {
        medium: item.medium,
        recipient_address: item.recipientAddress,
        recipient_name: item.recipientName,
        message_body: item.message,
        // No single `student_id` fits — a guardian's message can name
        // several billed children. `metadata.student_ids` (below)
        // carries the full list, same fallback
        // `AbsenceNoticeService.queueRecipients` uses for its own
        // several-students-one-log case.
        student_id: null,
        guardian_id: item.guardianId,
        sent_by_user_id: null,
        status: CommunicationStatus.QUEUED,
        trigger: CommunicationTrigger.AUTOMATED,
        metadata: {
          fee_generation_id: feeGenerationId,
          student_ids: studentIdsByGuardian.get(item.guardianId) ?? [],
        },
      });
      if (log === null) continue;

      try {
        await this.queue.add('send', {
          logId: log.id,
          ...(item.medium === CommunicationMedium.SMS && metered
            ? { batchId: batchReservationKey, segments: item.segments }
            : {}),
        });
      } catch (error) {
        // No release here on purpose: a replay re-claims this log id and its
        // settle draws on the units still held (releasing would make it free).
        this.logger.warn(
          `Failed to enqueue fee-notification log ${log.id} for generation ${feeGenerationId}: ${String(error)}`,
        );
        log.status = CommunicationStatus.FAILED;
        log.metadata = {
          ...log.metadata,
          reason: ENQUEUE_FAILED,
          error: 'Failed to enqueue for delivery',
        };
        await this.logRepo.save(log);
        enqueueFailures += 1;
      }
    }

    for (const item of toSkip) {
      await this.writeLog(tenantId, replayable, item.referenceKey, {
        medium: CommunicationMedium.SMS,
        recipient_address: item.recipientAddress,
        recipient_name: item.recipientName,
        message_body: '',
        student_id: null,
        guardian_id: item.guardianId,
        sent_by_user_id: null,
        status: CommunicationStatus.FAILED,
        trigger: CommunicationTrigger.AUTOMATED,
        metadata: {
          fee_generation_id: feeGenerationId,
          reason: SKIPPED_NO_SMS,
          student_ids: studentIdsByGuardian.get(item.guardianId) ?? [],
        },
      });
    }

    // Rows are saved FAILED/ENQUEUE_FAILED above and a replay re-claims them, so throwing
    // lets BullMQ retry the whole job instead of dropping those guardians' notices.
    if (enqueueFailures > 0) {
      throw new Error(`${enqueueFailures} fee-notification log(s) could not be enqueued`);
    }
  }

  /**
   * Writes the one log row for `referenceKey`. When a prior delivery left
   * an ENQUEUE_FAILED row for that key (`replayable`), the row is claimed
   * in place with a conditional UPDATE instead of inserting a second one:
   * two concurrent deliveries of the same replayed event can both pass the
   * read in `handleFeesGenerated`, but only one of them matches the
   * `status = FAILED AND reason = ENQUEUE_FAILED` predicate. The loser gets
   * `null` and must skip the key entirely.
   */
  private async writeLog(
    tenantId: string,
    replayable: Map<string, string>,
    referenceKey: string,
    values: Omit<Partial<CommunicationLog>, 'id' | 'tenant_id' | 'reference_key'>,
  ): Promise<CommunicationLog | null> {
    const failedId = replayable.get(referenceKey);
    if (failedId === undefined) {
      return this.logRepo.save(
        this.logRepo.create({ ...values, tenant_id: tenantId, reference_key: referenceKey }),
      );
    }
    const claim = await this.logRepo
      .createQueryBuilder()
      .update(CommunicationLog)
      .set(values)
      .where('id = :id', { id: failedId })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .andWhere('status = :status', { status: CommunicationStatus.FAILED })
      .andWhere(`metadata->>'reason' = :reason`, { reason: ENQUEUE_FAILED })
      .execute();
    if (!claim.affected) {
      return null;
    }
    return this.logRepo.findOneByOrFail({ id: failedId, tenant_id: tenantId });
  }

  /** Loads this batch's bills grouped by student, joined with the fee
   * structure name the message needs. Queried via the shared `DataSource`
   * rather than an injected `StudentFee` repository — `FeeModule` does not
   * export `TypeOrmModule`, and this module already reaches other modules'
   * tables the same way (`FeeGenerationsService.findBills`,
   * `AbsenceNoticeService.resolveAbsentees`'s sibling pattern). */
  private async loadBills(tenantId: string, feeGenerationId: string): Promise<BillRow[]> {
    return this.dataSource
      .createQueryBuilder()
      .from('student_fees', 'sf')
      .innerJoin('students', 's', 's.id = sf.student_id')
      .innerJoin('fee_structures', 'fs', 'fs.id = sf.fee_structure_id')
      .where('sf.fee_generation_id = :feeGenerationId', { feeGenerationId })
      .andWhere('s.tenant_id = :tenantId', { tenantId })
      .andWhere('sf.deleted_at IS NULL')
      .select('sf.student_id', 'student_id')
      .addSelect('s.full_name', 'student_full_name')
      .addSelect('fs.name', 'fee_structure_name')
      .addSelect('fs.fee_type', 'fee_type')
      .addSelect('sf.note', 'note')
      .addSelect("to_char(sf.period_start, 'YYYY-MM-DD')", 'period_start')
      .addSelect('sf.total_amount', 'total_amount')
      .getRawMany<BillRow>();
  }
}
