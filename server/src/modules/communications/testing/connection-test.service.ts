import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isEmail } from 'class-validator';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  countSmsSegments,
} from '@biddaloy/shared';
import {
  ConnectionTestResult,
  TestableCommunicationMedium,
} from '../providers/shared/connection-test.types';
import { isMessageSink } from '../providers/sink/message-sink';
import { CommunicationProviderRegistryService } from '../providers/communication-provider.registry';
import { sendThroughProvider } from '../providers/send-through-provider';
import { ProviderNotConfiguredError } from '../config/provider-not-configured.error';
import type { ConfigSource } from '../config/messaging-config.resolver';
import { CommunicationLog } from '../entities/communication-log.entity';
import { School } from '../../schools/entities/school.entity';
import { SmsCreditService } from '../credits/sms-credit.service';
import { INSUFFICIENT_SMS_CREDIT } from '../credits/insufficient-sms-credit.constants';
import { BD_PHONE_REGEX } from '../../students/dto/students.dto';
import { ConnectionTestResultDto } from './connection-test-result.dto';

/** Who gets the test message, and who asked for it (D28). */
export interface TestMessageRequest {
  sendTo: string;
  userId: string;
}

/** Per-tenant cap on real test sends in any rolling 24h (every one costs a message or a credit). */
export const TEST_SENDS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_TEST_MESSAGE = 'This provider cannot send a test message.';
/** `details.code` of the daily-cap 429, so the UI can tell it from the per-minute throttle's 429. */
export const TEST_SEND_DAILY_CAP = 'TEST_SEND_DAILY_CAP';
/** `details.code` of the bad-address 400, so the UI can tell it from a DTO 400. */
export const INVALID_TEST_ADDRESS = 'INVALID_TEST_ADDRESS';

const insufficientCredit = (required: number, available: number) =>
  new ConflictException({
    message: 'Insufficient SMS credit to send this message.',
    details: { code: INSUFFICIENT_SMS_CREDIT, required, available },
  });

interface TestMessageBody {
  body: string;
  subject?: string;
  /** Platform SMS credit pays for it: SMS, and not the school's own unsaved gateway. */
  metered: boolean;
  /** SMS segments of `body`, set when `metered`: reserved and settled as is. */
  segments?: number;
}

/**
 * #8.7.12: verifies a medium's credentials against the real provider without sending a message —
 * each provider's own `testConnection()` picks its cheapest verification call.
 *
 * `override` is the unsaved form values (same shape as a `communications.<medium>` block), resolved
 * by `MessagingConfigResolver`, the same chain a real send uses: omitted fields come from the
 * school's saved settings, and from the platform env only when the override sets no owned field.
 *
 * Never lets a raw provider error escape: every path returns `ConnectionTestResult`'s sanitized
 * `message`, including `ProviderNotConfiguredError` thrown before any call is made.
 */
@Injectable()
export class ConnectionTestService {
  private readonly logger = new Logger(ConnectionTestService.name);

  constructor(
    private readonly registry: CommunicationProviderRegistryService,
    @InjectRepository(CommunicationLog) private readonly logs: Repository<CommunicationLog>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly smsCredits: SmsCreditService,
  ) {}

  async test(
    tenantId: string,
    medium: TestableCommunicationMedium,
    override?: Record<string, unknown>,
    testMessage?: TestMessageRequest,
  ): Promise<ConnectionTestResultDto> {
    // Epic 87 (D24): on a sink stack nothing real is configured; fixed text, no tenant data read.
    if (isMessageSink()) {
      // With `sendTo` the caller expects a message: say plainly none was sent (nothing is logged).
      return {
        success: true,
        message: testMessage
          ? 'Test site: messages go to the test inbox. No real message was sent.'
          : 'Test site: messages go to the test inbox',
      };
    }
    try {
      const { provider, config, source } = await this.registry.resolveFor(
        medium as CommunicationMedium,
        tenantId,
        // A plain connection test sends nothing, so `sendOnly` fields (an email `from`) are not
        // needed; a test-message send does send, so they still are.
        { override, connectionTestOnly: !testMessage },
      );
      // Refuse before any outbound call: no support, a bad address, the cap or no credit.
      let message: TestMessageBody | undefined;
      if (testMessage) {
        if (!provider.descriptor.supportsTestMessage)
          throw new BadRequestException(NO_TEST_MESSAGE);
        this.assertAddress(medium, testMessage.sendTo);
        // A DB error in the count is the send path's own 500, not "Connection test failed."
        await this.orSendFailed(() => this.assertDailyCap(tenantId));
        message = await this.orSendFailed(() =>
          this.prepareTestMessage(tenantId, medium as CommunicationMedium, source),
        );
      }
      const result = await provider.testConnection(config);
      if (!result.success || !testMessage || !message) return result;
      // Its own catch: a credit/DB failure after a passing connection test is not "Connection test failed."
      const sent = await this.orSendFailed(() =>
        this.sendTestMessage(
          tenantId,
          medium as CommunicationMedium,
          provider,
          config,
          source,
          testMessage,
          message,
        ),
      );
      return { ...result, testMessage: sent };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Only ProviderNotConfiguredError carries an actionable, secret-free message. Anything
      // else (a network error that escaped a provider) may echo a key or URL: fixed text (Rules 23/24).
      return {
        success: false,
        message:
          err instanceof ProviderNotConfiguredError ? err.message : 'Connection test failed.',
      };
    }
  }

  /** A credit/DB failure on the send path is its own fixed 500, never "Connection test failed." */
  private async orSendFailed<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException('The test message could not be sent.');
    }
  }

  /**
   * Rolling-24h cap on real test sends per tenant, counted from the logs the sends themselves wrote.
   * Called twice: once early, so a capped school gets its 429 before any outbound call, and once
   * inside `claimTestSend`'s lock, which is the check that holds under concurrency (#3326).
   */
  private async assertDailyCap(
    tenantId: string,
    logs: Repository<CommunicationLog> = this.logs,
  ): Promise<void> {
    const used = await logs
      .createQueryBuilder('l')
      .where('l.tenant_id = :tenantId', { tenantId })
      .andWhere(`l.metadata->>'test' = 'true'`)
      .andWhere('l.created_at > :since', { since: new Date(Date.now() - DAY_MS) })
      .getCount();
    if (used >= TEST_SENDS_PER_DAY) {
      throw new HttpException(
        {
          message: 'Too many test messages in the last 24 hours. Try again later.',
          details: { code: TEST_SEND_DAILY_CAP },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private assertAddress(medium: TestableCommunicationMedium, sendTo: string): void {
    const ok =
      medium === CommunicationMedium.SMS
        ? BD_PHONE_REGEX.test(sendTo)
        : medium === CommunicationMedium.EMAIL && isEmail(sendTo);
    if (!ok) {
      throw new BadRequestException({
        message: 'Enter a valid number or address for this channel.',
        details: { code: INVALID_TEST_ADDRESS },
      });
    }
  }

  /**
   * The message text, and a credit check before the vendor's connection call: a school with no
   * credit gets its 409 without an outbound call. The real reservation still happens at send time.
   * Metered = platform credit pays: SMS on a PLATFORM-metered school, unless the config came only
   * from the override (`source: 'override'`, the school's own unsaved gateway). An override that
   * mixes with the school's saved gateway resolves as `source: 'tenant'` and is metered, the same
   * as a saved own gateway on a PLATFORM school.
   */
  private async prepareTestMessage(
    tenantId: string,
    medium: CommunicationMedium,
    source: ConfigSource | undefined,
  ): Promise<TestMessageBody> {
    const school = await this.schools.findOne({ where: { id: tenantId }, select: ['id', 'name'] });
    const body = `Biddaloy test message from ${school?.name ?? 'your school'} — সব ঠিক আছে / all good`;
    const subject = medium === CommunicationMedium.EMAIL ? 'Biddaloy test message' : undefined;
    const metered =
      medium === CommunicationMedium.SMS &&
      source !== 'override' &&
      (await this.smsCredits.isMetered(tenantId));
    if (!metered) return { body, subject, metered };
    const segments = countSmsSegments(body).segments;
    const { available } = await this.smsCredits.getBalance(tenantId);
    if (available < segments) throw insufficientCredit(segments, available);
    return { body, subject, metered, segments };
  }

  /**
   * #3326: lock, count and insert the test row in one short transaction, before the send. The row
   * is the claim: a second request counts it while this one is still at the vendor. The lock is
   * per tenant and is never held across the vendor call (no pool connection waits on a vendor).
   * QUEUED is safe for a row with no BullMQ job: nothing re-dispatches QUEUED rows (only a job
   * does). A claim still QUEUED after an hour was stranded (crash, failed final save): the credit
   * reconcile lists it as TEST_CLAIM_STRANDED for a human (held, never released by itself).
   */
  private claimTestSend(
    tenantId: string,
    medium: CommunicationMedium,
    req: TestMessageRequest,
    body: string,
    subject: string | undefined,
    batchId: string | undefined,
  ): Promise<CommunicationLog> {
    return this.logs.manager.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`test-send:${tenantId}`]);
      const repo = m.getRepository(CommunicationLog);
      await this.assertDailyCap(tenantId, repo);
      return repo.save(
        repo.create({
          tenant_id: tenantId,
          medium,
          recipient_address: req.sendTo,
          recipient_name: 'Test',
          message_body: body,
          subject: subject ?? null,
          sent_by_user_id: req.userId,
          status: CommunicationStatus.QUEUED,
          trigger: CommunicationTrigger.MANUAL,
          metadata: { test: true, ...(batchId ? { batch_id: batchId } : {}) },
        }),
      );
    });
  }

  /** Nothing was sent (no credit, or the reservation failed): the claim must not use up the cap. */
  private async dropClaim(tenantId: string, logId: string): Promise<void> {
    // ponytail: best effort; a leftover QUEUED row only costs one of the day's 20 test sends.
    await this.logs.delete({ id: logId, tenant_id: tenantId }).catch(() => undefined);
  }

  /**
   * Sends straight through the resolved (possibly unsaved) config, not the queue: the queue worker
   * re-reads SAVED settings, and unsaved secrets must never sit in Redis. Writes one terminal log
   * row like any message, and settles credit the way the worker does.
   *
   * ponytail: reserve/log/settle mirrors CommunicationsProcessor.settleSmsCredit and
   * CommunicationsService.enqueue. Not extracted: the worker's copy is tied to a BullMQ job and
   * mutates its own log + Sentry tags, so a shared helper would be a wide change. Fold in if a third
   * caller appears.
   *
   * The UI keeps one Idempotency-Key per attempt and a new one after a reply: a reused key replays
   * the stored response (no second send), which is meant for a retry after a lost reply.
   * Credit reserved by an AMBIGUOUS send stays reserved, as in the worker: the row says
   * `credit: 'UNSETTLED'` with its `batch_id`, and ops get the same `needs_reconciliation` signal.
   */
  private async sendTestMessage(
    tenantId: string,
    medium: CommunicationMedium,
    provider: Parameters<typeof sendThroughProvider>[0],
    config: unknown,
    source: ConfigSource,
    req: TestMessageRequest,
    { body, subject, metered, segments }: TestMessageBody,
  ) {
    const batchId = metered && segments !== undefined ? randomUUID() : undefined;
    const claim = await this.claimTestSend(tenantId, medium, req, body, subject, batchId);
    // Metered SMS: reserve first, exactly as CommunicationsService.enqueue does. `metered` was
    // already decided in prepareTestMessage, so this does not read the settings again.
    let reservation: { batchId: string; segments: number } | undefined;
    if (batchId && segments !== undefined) {
      const res = await this.smsCredits
        .reserve(tenantId, segments, `batch:${batchId}`, { type: 'batch', id: batchId })
        .catch(async (err: unknown) => {
          await this.dropClaim(tenantId, claim.id);
          throw err;
        });
      if (!res.ok) {
        await this.dropClaim(tenantId, claim.id);
        throw insufficientCredit(segments, res.available);
      }
      reservation = { batchId, segments };
    }

    const result = await sendThroughProvider(
      provider,
      { to: req.sendTo, body, subject },
      config as never,
      source,
    );
    // AMBIGUOUS (the provider threw): the message may have gone out, so the credit stays reserved.
    const unsettled = reservation && !result.success && result.outcome !== 'REJECTED';
    const status = result.success ? CommunicationStatus.SENT : CommunicationStatus.FAILED;
    let log: CommunicationLog;
    try {
      log = await this.logs.save(
        this.logs.create({
          ...claim,
          status,
          provider_message_id: result.success ? result.providerMessageId : null,
          metadata: {
            test: true,
            ...(result.segments !== undefined ? { segments: result.segments } : {}),
            // D23: which company sent it, so Check status asks the same one (as the worker does).
            ...(result.provider ? { provider: result.provider } : {}),
            // #3350: and whose account, so Check status asks the same one.
            ...(result.source ? { source: result.source } : {}),
            ...(result.success ? {} : { error: result.error }),
            ...(reservation ? { batch_id: reservation.batchId } : {}),
            ...(unsettled ? { credit: 'UNSETTLED' } : {}),
          },
        }),
      );
    } catch (err) {
      if (!result.success && result.outcome === 'REJECTED') {
        // Nothing went out: give the reservation back and the cap slot; a retry may send.
        await this.dropClaim(tenantId, claim.id);
        if (reservation) {
          await this.smsCredits.releaseForLog(
            tenantId,
            reservation.batchId,
            reservation.segments,
            reservation.batchId,
          );
        }
        throw new InternalServerErrorException('The test message could not be recorded.');
      }
      // #3326: the message may have gone out. Answer its outcome (200), never a 500: an error frees
      // the Idempotency-Key and the same-key retry would send again. The claim row stays QUEUED (it
      // still counts toward the cap) and any credit stays reserved: alert ops, ids only (Rule 13).
      const tags = {
        communication_log_id: claim.id,
        tenant_id: tenantId,
        ...(reservation ? { batch_id: reservation.batchId } : {}),
        needs_reconciliation: 'true',
      };
      this.logger.error({ msg: 'test send outcome not recorded; log row left QUEUED', ...tags });
      Sentry.withScope((scope) => {
        scope.setTags(tags);
        Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
      return { logId: claim.id, status };
    }

    // AMBIGUOUS never settles: the reservation waits for reconciliation, same as the worker's
    // flagAmbiguousSettlement. Ids only in the log and tags, never the recipient or body (Rule 13).
    if (reservation && unsettled) {
      const tags = {
        communication_log_id: log.id,
        tenant_id: tenantId,
        batch_id: reservation.batchId,
        medium,
        needs_reconciliation: 'true',
      };
      this.logger.warn({ msg: 'test sms send outcome ambiguous — credit left reserved', ...tags });
      Sentry.withScope((scope) => {
        scope.setTags(tags);
        Sentry.captureMessage('test sms send outcome ambiguous — needs reconciliation', 'warning');
      });
    }
    if (reservation && !unsettled) {
      try {
        await this.smsCredits.settlePart(
          tenantId,
          `batch:${reservation.batchId}`,
          `log:${log.id}`,
          reservation.segments,
          result.success ? 'DEBIT' : 'RELEASE',
        );
        log.metadata = { ...log.metadata, credit: result.success ? 'DEBITED' : 'RELEASED' };
      } catch (err) {
        // Same signal as the worker's failed settlement: the reservation is stranded until ops
        // reconcile it, and the runbook finds it by `needs_reconciliation`. Ids only (Rule 13).
        const tags = {
          communication_log_id: log.id,
          tenant_id: tenantId,
          batch_id: reservation.batchId,
          medium,
          needs_reconciliation: 'true',
        };
        this.logger.error({ msg: 'test sms credit settlement failed', ...tags });
        Sentry.withScope((scope) => {
          scope.setTags(tags);
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
        log.metadata = { ...log.metadata, credit: 'UNSETTLED' };
      }
      // The debit already happened; the metadata is best-effort, but a lost write is logged.
      await this.logs.save(log).catch((err: unknown) => {
        this.logger.error({
          msg: 'test sms credit marker not saved',
          communication_log_id: log.id,
          tenant_id: tenantId,
          batch_id: reservation.batchId,
          credit: log.metadata?.credit,
          error: err instanceof Error ? err.name : 'error',
        });
      });
    }
    return { logId: log.id, status: log.status };
  }
}
