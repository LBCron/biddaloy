import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';
import { CommunicationLog } from './entities/communication-log.entity';
import { CommunicationProviderRegistryService } from './providers/communication-provider.registry';
import { ProviderNotConfiguredError } from './config/provider-not-configured.error';
import { isMessageSink } from './providers/sink/message-sink';
import { ReminderBatchLogDto } from './dto/reminders.dto';
import { logsWithSender, toBatchLogDto } from './reminders.service';
import { SmsCreditService } from './credits/sms-credit.service';

/** D23: one check per log per minute. */
const COOLDOWN_MS = 60_000;

// Rule 23: every "cannot check" path answers this one sentence; none names the company or the log.
export const CANNOT_CHECK_STATUS = 'The delivery status of this message cannot be checked now.';
// Rule 24: the vendor's own error text never reaches the client.
export const STATUS_CHECK_FAILED = 'Could not get the delivery status. Try again in a minute.';

/**
 * [97.4.01] D23: pull the delivery status of one SENT message from the company that sent it.
 *
 * ```mermaid
 * flowchart LR
 *   L[log of this tenant?] -- no --> N[404]
 *   L --> E{SENT, vendor id, metadata.provider,<br/>no check in 60 s, not sink?}
 *   E -- no --> C[409]
 *   E --> R[resolve that provider with the tenant's config] -- unknown / no status capability --> C
 *   R -- another account than the one that sent it --> C
 *   R --> K[claim: checkedAt = now, only if SENT and outside the 60 s wait] -- lost --> C
 *   K --> G[getStatus] -- throws --> B[502, status unchanged, wait already started]
 *   G --> W[metadata.delivery + DELIVERED / FAILED / stays SENT]
 * ```
 */
@Injectable()
export class DeliveryStatusService {
  private readonly logger = new Logger(DeliveryStatusService.name);

  constructor(
    @InjectRepository(CommunicationLog) private readonly repo: Repository<CommunicationLog>,
    private readonly registry: CommunicationProviderRegistryService,
    private readonly smsCredits: SmsCreditService,
  ) {}

  async checkStatus(id: string, tenantId: string, role: string): Promise<ReminderBatchLogDto> {
    const log = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!log) throw new NotFoundException('Communication log not found');

    const meta = (log.metadata ?? {}) as {
      provider?: unknown;
      source?: unknown;
      credit?: unknown;
      segments?: unknown;
      delivery?: { checkedAt?: string };
    };
    const name = typeof meta.provider === 'string' ? meta.provider : null;
    const lastCheck = Date.parse(meta.delivery?.checkedAt ?? '');
    const cannot = () => new ConflictException(CANNOT_CHECK_STATUS);
    if (
      log.status !== CommunicationStatus.SENT ||
      !log.provider_message_id ||
      !name ||
      Date.now() - lastCheck < COOLDOWN_MS ||
      // Sink mode delivered to Mailpit, not a vendor: there is nothing to ask (and demo ids are fake).
      isMessageSink()
    ) {
      throw cannot();
    }

    let resolved;
    try {
      // #3350: ask the account that sent it. Sent on the platform's keys: the platform's account,
      // never a draft the school saved for that company. Otherwise (the school's own account, or
      // an older row with no `source`) the override names the provider only (no field keys), so
      // the tenant's stored config is used.
      resolved = await this.registry.resolveFor(
        log.medium as CommunicationMedium,
        tenantId,
        meta.source === 'platform' ? { platformProvider: name } : { override: { provider: name } },
      );
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) throw cannot();
      throw err;
    }
    const { provider, config, source } = resolved;
    // Review round 2 on #3347: never ask another account about this message. A school that removed
    // its own keys (kept on PLATFORM credit) would otherwise resolve the platform's keys for a row
    // sent on its own account. Compared as "platform" vs "the school's own" (a test send typed in
    // the form records `override`, still the school's account). A row with no `source` (older)
    // keeps the old path.
    const sentOnPlatform = meta.source === 'platform';
    if (typeof meta.source === 'string' && sentOnPlatform !== (source === 'platform')) {
      throw cannot();
    }
    if (
      provider.descriptor.name !== name ||
      !provider.descriptor.capabilities.includes('status') ||
      !provider.getStatus
    ) {
      throw cannot();
    }

    // Claim before the call (review round 1 on #3347): the wait starts even when the vendor fails,
    // and two clicks in the same second cannot both reach the vendor. One tenant-scoped statement.
    // The claim replaces `delivery` with `{checkedAt}` alone: a failed check must not leave an old
    // status next to a new time (it would read "checked now, still PENDING").
    const now = new Date();
    const [, claimed] = (await this.repo.query(
      `UPDATE communication_logs
          SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{delivery}',
                jsonb_build_object('checkedAt', $1::text)
              ),
              updated_at = now()
        WHERE id = $2 AND tenant_id = $3 AND status = 'SENT'
          AND (metadata #>> '{delivery,checkedAt}' IS NULL
               OR (metadata #>> '{delivery,checkedAt}')::timestamptz <= $4::timestamptz)`,
      [now.toISOString(), id, tenantId, new Date(now.getTime() - COOLDOWN_MS).toISOString()],
    )) as [unknown, number];
    if (claimed !== 1) throw cannot();

    let result: Awaited<ReturnType<NonNullable<typeof provider.getStatus>>>;
    try {
      result = await provider.getStatus(log.provider_message_id, config);
    } catch (err) {
      // The class only: the message can carry the vendor URL or key (Rule 13).
      this.logger.warn(`Status check failed with ${err instanceof Error ? err.name : typeof err}`);
      throw new BadGatewayException(STATUS_CHECK_FAILED);
    }

    const delivery = {
      status: result.status,
      ...(result.code ? { code: result.code } : {}),
      checkedAt: now.toISOString(),
    };
    const next =
      result.status === 'DELIVERED'
        ? CommunicationStatus.DELIVERED
        : result.status === 'FAILED'
          ? CommunicationStatus.FAILED
          : CommunicationStatus.SENT;
    // A vendor that does not bill failed SMS gives the school's credit back (#3357), but only for a
    // message sent on the platform's account whose credit was really spent (`credit: 'DEBITED'`),
    // and only once: the flip below is guarded by `status = 'SENT'`, and the refund shares its
    // transaction and carries a per-message key.
    const refundUnits =
      next === CommunicationStatus.FAILED &&
      provider.descriptor.refundsFailedSms === true &&
      meta.source === 'platform' &&
      meta.credit === 'DEBITED' &&
      typeof meta.segments === 'number'
        ? meta.segments
        : 0;
    // One transaction: the row flip, the batch counters and the refund move together, so a
    // reminder batch's counts never disagree with its own log list (#3345) and a refund never
    // exists without the flip that earned it. jsonb merge, so a concurrent metadata write (credit
    // settle) is not lost. Counters change only when this statement flipped the row SENT -> FAILED.
    const affected = await this.repo.manager.transaction(async (m) => {
      const rows = (await m.query(
        `WITH upd AS (
         UPDATE communication_logs
            SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('delivery', $1::jsonb)
                  || CASE WHEN $6::boolean THEN jsonb_build_object('credit', 'REFUNDED') ELSE '{}'::jsonb END,
                status = $2,
                updated_at = now()
          WHERE id = $3 AND tenant_id = $4 AND status = 'SENT'
        RETURNING reminder_batch_id
       ), bump AS (
         UPDATE reminder_batches b
            SET successful_count = b.successful_count - 1,
                failed_count = b.failed_count + 1,
                -- Same rule as recordBatchOutcome: a batch with every recipient settled is
                -- COMPLETED / PARTIALLY_FAILED / FAILED by its counters.
                status = CASE
                  WHEN b.successful_count - 1 + b.failed_count + 1 >= b.total_recipients THEN
                    CASE WHEN b.successful_count - 1 = 0
                      THEN 'FAILED'::"public"."reminder_batches_status_enum"
                      ELSE 'PARTIALLY_FAILED'::"public"."reminder_batches_status_enum"
                    END
                  ELSE b.status
                END,
                updated_at = now()
           FROM upd
          -- successful_count > 0: both counters move together or not at all (no silent drift).
          WHERE b.id = upd.reminder_batch_id AND b.tenant_id = $4 AND $5::boolean
            AND b.successful_count > 0
       )
       SELECT count(*)::int AS n FROM upd`,
        [
          JSON.stringify(delivery),
          next,
          id,
          tenantId,
          next === CommunicationStatus.FAILED,
          refundUnits > 0,
        ],
      )) as { n: number }[];
      const flipped = rows[0]?.n ?? 0;
      if (flipped === 1 && refundUnits > 0) {
        await this.smsCredits.refundForLog(m, tenantId, id, refundUnits);
      }
      return flipped;
    });
    if (affected !== 1) throw cannot();

    return toBatchLogDto(
      await logsWithSender(this.repo)
        .where('log.id = :id AND log.tenant_id = :tenantId', { id, tenantId })
        .getOneOrFail(),
      role,
    );
  }
}
