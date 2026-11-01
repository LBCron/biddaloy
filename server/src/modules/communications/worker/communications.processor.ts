import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import {
  ACCEPTED_STATUSES,
  CommunicationLog,
  isTerminalStatus,
  PUSH_MEDIUM,
} from '../entities/communication-log.entity';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { CommunicationProviderRegistryService } from '../providers/communication-provider.registry';
import { recordBatchOutcome, BatchOutcome } from '../reminder-batch-counters';
import { COMMUNICATIONS_QUEUE } from '../communications.constants';
import { TenantStatusService } from '../../schools/tenant-status.service';
import { SmsCreditService } from '../credits/sms-credit.service';
import { Guardian } from '../../students/entities/guardian.entity';
import { PushService } from '../../push/push.service';
import { claimQueuedLog } from './log-claim';

interface SendJobData {
  logId: string;
  // [15.6.5/#548] `batchId` mirrors the log's own `reminder_batch_id` for a
  // job that hasn't hit the DB yet; `segments` is set only for SMS jobs,
  // since only SMS touches the credit ledger. [15.6.6/#549] settles per log
  // (`settlePart`, keyed `log:<logId>`) using both fields once the provider
  // result is known.
  batchId?: string;
  segments?: number;
}

/**
 * Consumer half of the communications module. Deliberately depends on
 * nothing outside this folder except the CommunicationLog repo and Redis
 * (via BullMQ) — see the plan's "Extraction recipe" for why: this class,
 * `providers/`, and `entities/communication-log.entity.ts` are the exact
 * set of files that would move into a standalone notification service.
 *
 * Retries are at-least-once, not exactly-once: a crash between a
 * provider's successful send and this method recording it could resend on
 * the next attempt (the log's status guard at the top of `process` catches
 * a *replay after that save landed*, but not a crash *before* it commits).
 * Full send-idempotency would need provider-side dedup keys, which aren't
 * uniformly available across these gateways, so this narrow window is an
 * accepted tradeoff rather than something this module solves. `settle`
 * saving the log and recording the batch outcome in one transaction is what
 * keeps that window from also being able to strand a batch in PROCESSING —
 * either both commit, or neither does and the retry goes through the
 * normal path again.
 */
@Processor(COMMUNICATIONS_QUEUE)
export class CommunicationsProcessor extends WorkerHost {
  private readonly logger = new Logger(CommunicationsProcessor.name);

  constructor(
    @InjectRepository(CommunicationLog)
    private readonly repo: Repository<CommunicationLog>,
    @InjectRepository(Guardian)
    private readonly guardianRepo: Repository<Guardian>,
    private readonly providerRegistry: CommunicationProviderRegistryService,
    private readonly tenantStatus: TenantStatusService,
    private readonly smsCredits: SmsCreditService,
    private readonly pushService: PushService,
  ) {
    super();
  }

  /**
   * #555: routine automated notifications try push before their preferred
   * channel. "Routine" = `CommunicationTrigger.AUTOMATED` — the only
   * automated trigger this dispatcher sees today (attendance-absence
   * notices via `absence-notice.scheduler.ts`); `BULK_REMINDER` /
   * `SINGLE_REMINDER` are staff-initiated and stay on their existing path
   * unchanged, `ACCOUNT_ACCESS` sends (OTP/invite/reset) are never
   * routine-suppressible. Opt-out is already authoritative upstream — a
   * guardian who opted out never gets a QUEUED log at all (see
   * `reminder-recipients.util.ts#partitionByOptOut`), so this method never
   * has to check it again.
   *
   * Returns `true` when push delivered (the log has already been rewritten
   * to a terminal PUSH log and settled) — the caller must stop, not fall
   * through to the preferred-channel provider. Returns `false` for every
   * other case (no linked user, no subscriptions, or 0 endpoints
   * accepted), leaving `log` untouched so the existing dispatch continues
   * exactly as it did before this method existed.
   */
  private async tryPushFirst(job: Job<SendJobData>, log: CommunicationLog): Promise<boolean> {
    if (log.trigger !== CommunicationTrigger.AUTOMATED) {
      return false;
    }
    return (await this.pushToGuardian(job, log)) === true;
  }

  /**
   * The push attempt itself, shared by `tryPushFirst` (AUTOMATED, falls
   * through to SMS on false) and the [84.1.3] arrival branch (push only,
   * false = FAILED). Same contract as `tryPushFirst`'s return value.
   */
  private async pushToGuardian(
    job: Job<SendJobData>,
    log: CommunicationLog,
  ): Promise<boolean | 'TRANSIENT'> {
    if (!log.guardian_id) {
      return false;
    }

    const guardian = await this.guardianRepo.findOne({
      where: { id: log.guardian_id, tenant_id: log.tenant_id },
    });
    if (!guardian?.user_id) {
      return false;
    }

    const result = await this.pushService.sendToUser(guardian.user_id, log.tenant_id, {
      type: 'reminder',
      title: log.subject ?? 'Notification',
      body: log.message_body,
      url: '/',
    });

    // A push acceptance IS the delivery attempt — no paid duplicate on the
    // preferred channel. `accepted === 0` (no live subscriptions, or every
    // endpoint came back transient/pruned) falls through unchanged.
    if (result.accepted < 1) {
      // Nothing accepted but an endpoint failed transiently: not the same as "no device".
      return result.transient > 0 ? 'TRANSIENT' : false;
    }

    // Read BEFORE `log.medium` is rewritten to PUSH below: a metered SMS job
    // (fee / payment / calendar notices are AUTOMATED and carry batchId +
    // segments) reserved credit for an SMS that push now replaces.
    const settleable = this.isSettleableSmsBatchJob(job, log);

    log.medium = PUSH_MEDIUM;
    // No endpoint, no secret — just which user, so this log can never leak
    // a push subscription's endpoint/keys into an audit trail.
    log.recipient_address = `push:${guardian.user_id}`;
    log.status = CommunicationStatus.SENT;
    log.metadata = {
      ...log.metadata,
      accepted: result.accepted,
      transient: result.transient,
      pruned: result.pruned,
    };
    await this.settle(log, 'success');
    // Push replaced the SMS, so no SMS went out: give this log's share of the
    // batch reservation back instead of leaving it reserved forever (#1317).
    if (settleable) {
      await this.settleSmsCredit(job, log, 'RELEASE');
    }
    return true;
  }

  /**
   * [15.6.6/#549] Whether this job's log should settle a per-log slice of
   * a batch SMS credit reservation. Checking `job.data.batchId` +
   * `medium === SMS` (rather than re-calling `SmsCreditService.isMetered`)
   * is the cheaper of the two correct checks the issue offered: the
   * RESERVE only ever exists because #548's bulk send already checked
   * `isMetered` before reserving, so a truthy `batchId` on an SMS job
   * *is* proof metering was on for this tenant at reserve time — no extra
   * DB round trip needed here. `segments` must also be present since it's
   * the unit count `settlePart` moves.
   */
  private isSettleableSmsBatchJob(job: Job<SendJobData>, log: CommunicationLog): boolean {
    return (
      log.medium === CommunicationMedium.SMS &&
      typeof job.data.batchId === 'string' &&
      job.data.batchId.length > 0 &&
      typeof job.data.segments === 'number'
    );
  }

  /**
   * [15.6.6/#549] Peels this log's `segments` off its batch's RESERVE.
   * Runs AFTER the provider call and the log/batch-counter `settle()`
   * transaction above have already committed — settlement is deliberately
   * outside that transaction so a credit-ledger failure can never roll
   * back (or block) a send that already happened.
   *
   * `settlePart` is idempotent on `log:<logId>:settle`, so a retried job
   * (stalled-job recovery, a redelivered event) settles at most once —
   * see the class doc's note on the send-duplication window this does
   * NOT close.
   *
   * A `settlePart` failure must not throw: this runs after the log is
   * already terminal, so throwing here would surface as an unhandled
   * job error and could trigger BullMQ retry machinery that re-sends the
   * SMS for a job whose provider call already succeeded. Instead it's
   * logged and the log is left with `metadata.credit = 'UNSETTLED'`,
   * exactly like the AMBIGUOUS path — both converge on manual
   * reconciliation.
   */
  private async settleSmsCredit(
    job: Job<SendJobData>,
    log: CommunicationLog,
    outcome: 'DEBIT' | 'RELEASE',
  ): Promise<void> {
    try {
      await this.smsCredits.settlePart(
        log.tenant_id,
        `batch:${job.data.batchId}`,
        `log:${log.id}`,
        job.data.segments as number,
        outcome,
      );
      log.metadata = {
        ...log.metadata,
        credit: outcome === 'DEBIT' ? 'DEBITED' : 'RELEASED',
      };
      await this.repo.save(log);
    } catch (err) {
      // Same reconciliation Sentry signal as flagAmbiguousSettlement — a
      // failed settlement leaves reserved credit stranded exactly like an
      // AMBIGUOUS outcome does, and the reconciliation runbook finds both
      // through `needs_reconciliation`. The nestjs-pino error log alone
      // doesn't reach Sentry.
      const tags: Record<string, string> = {
        queue: COMMUNICATIONS_QUEUE,
        job_name: job.name,
        communication_log_id: log.id,
        tenant_id: log.tenant_id,
        medium: log.medium,
        needs_reconciliation: 'true',
      };
      this.logger.error({
        msg: 'sms credit settlement failed',
        ...tags,
        batch_id: job.data.batchId,
        settle_outcome: outcome,
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.withScope((scope) => {
        scope.setTags(tags);
        Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
      log.metadata = { ...log.metadata, credit: 'UNSETTLED' };
      await this.repo.save(log);
    }
  }

  /**
   * [15.6.6/#549] AMBIGUOUS never settles — the reservation stays as-is
   * pending reconciliation. Flags the log and reuses the 15.1.4
   * queue-failure telemetry shape (structured log + Sentry tags, ids
   * only, never message bodies/recipients) so `needs_reconciliation`
   * shows up next to the same `communications job failed/stalled` events
   * ops already watches, instead of inventing a second reporting path.
   */
  private flagAmbiguousSettlement(job: Job<SendJobData>, log: CommunicationLog): void {
    log.metadata = { ...log.metadata, credit: 'UNSETTLED' };
    const tags: Record<string, string> = {
      queue: COMMUNICATIONS_QUEUE,
      job_name: job.name,
      communication_log_id: log.id,
      tenant_id: log.tenant_id,
      medium: log.medium,
      needs_reconciliation: 'true',
    };
    this.logger.warn({
      msg: 'sms send outcome ambiguous — credit reservation left pending',
      ...tags,
    });
    Sentry.withScope((scope) => {
      scope.setTags(tags);
      Sentry.captureMessage('sms send outcome ambiguous — needs reconciliation', 'warning');
    });
  }

  /**
   * Attributes a log's terminal outcome to its batch, if it has one.
   *
   * Only reached once the log will not be retried again — an intermediate
   * failure throws instead, so a message that eventually succeeds is
   * counted once, as a success.
   *
   * Runs the log save and the batch counter update in one transaction. If
   * they ran separately, a crash between them would leave a terminal log
   * whose outcome was never recorded — and the replay guard in `process`
   * would then skip it forever on retry, since it only checks whether the
   * log is already terminal, not whether its batch was updated. One
   * transaction means either both commit, or the log stays non-terminal
   * and a retry goes through the normal path again.
   */
  private async settle(log: CommunicationLog, outcome: BatchOutcome): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      await manager.save(log);
      if (log.reminder_batch_id) {
        await recordBatchOutcome(manager, log.reminder_batch_id, outcome);
      }
    });
  }

  async process(job: Job<SendJobData>): Promise<void> {
    const log = await this.repo.findOneOrFail({ where: { id: job.data.logId } });

    // A BullMQ job can be reprocessed after it already reached a terminal
    // state — most commonly the "stalled job" recovery path, where a worker
    // that crashed or missed a lock-renewal deadline after settling the log
    // gets its job picked up again. Resending here would duplicate the
    // message to the guardian and double-count a batch that already
    // recorded this outcome, so a log that's already terminal (SENT/FAILED, or
    // DELIVERED/READ from Check status) is treated as done rather than reprocessed.
    // This runs before the suspension
    // check below on purpose: a replayed SENT log for a since-suspended
    // tenant must stay SENT, not be rewritten to FAILED and settled twice.
    if (isTerminalStatus(log.status)) {
      // A worker can commit settle() and die before settleSmsCredit runs.
      // A terminal log with no recorded credit disposition still owns a
      // slice of its batch RESERVE, so finish that slice here instead of
      // leaving the units reserved forever. A FAILED log whose provider
      // outcome was AMBIGUOUS already carries credit: 'UNSETTLED' from
      // flagAmbiguousSettlement, so it's excluded here on purpose — that
      // reservation is pending reconciliation, not a release.
      const credit = (log.metadata as { credit?: string } | null)?.credit;
      if (!credit && this.isSettleableSmsBatchJob(job, log)) {
        // The vendor took it: SENT/DELIVERED/READ, or a FAILED that Check status wrote after the
        // send (only an accepted send stores a vendor id). That is a debit, never a release.
        const accepted = ACCEPTED_STATUSES.includes(log.status) || !!log.provider_message_id;
        await this.settleSmsCredit(job, log, accepted ? 'DEBIT' : 'RELEASE');
      } else if (
        !credit &&
        log.medium === PUSH_MEDIUM &&
        typeof job.data.batchId === 'string' &&
        job.data.batchId.length > 0 &&
        typeof job.data.segments === 'number'
      ) {
        // Push delivered instead of the reserved SMS and the worker died
        // before releasing (see `tryPushFirst`): finish the release.
        // Invariant: this branch does not check that the original medium was SMS. It is
        // safe only because non-SMS jobs never carry a numeric `segments` (fee ~378,
        // invoice listener ~287, calendar ~385, reminders ~679, CommunicationsService.enqueue,
        // ResultSmsService). Keep it that way.
        await this.settleSmsCredit(job, log, 'RELEASE');
      }
      return;
    }

    // Arrival notices race a bounded `queue.add` in ArrivalNoticeService: claim the log
    // atomically before any side effect. Losing means the enqueue-timeout path already
    // failed it (credit released, key freed), so sending now would double-deliver.
    // A retry of this same job re-claims its own claim. Other producers are untouched.
    if (log.trigger === CommunicationTrigger.ARRIVAL_NOTICE) {
      if (!job.id) throw new Error(`Arrival job for log ${log.id} has no id to claim with`);
      const jobId = String(job.id);
      if (!(await claimQueuedLog(this.repo, log.tenant_id, log.id, jobId))) {
        this.logger.warn(`Arrival log ${log.id} not claimable (settled elsewhere); skipping`);
        return;
      }
      log.metadata = { ...log.metadata, claimed_by: jobId };
    }

    // #528: a school can be suspended after work was already queued for it.
    // No provider call, no SMS credit debit for a suspended tenant — settle
    // the log as FAILED and return without throwing so BullMQ does not
    // retry. Work queued before suspension is NOT resumed automatically on
    // reactivation; the admin has to re-send (see docs/architecture/05-communications.md).
    if (!(await this.tenantStatus.isActive(log.tenant_id))) {
      log.status = CommunicationStatus.FAILED;
      log.metadata = { ...log.metadata, reason: 'TENANT_SUSPENDED' };
      await this.settle(log, 'failure');
      // [15.6.6/#549] No provider call happened — release this log's
      // share of the batch reservation rather than leaving it stuck.
      if (this.isSettleableSmsBatchJob(job, log)) {
        await this.settleSmsCredit(job, log, 'RELEASE');
      }
      return;
    }

    // [84.1.3] An arrival notice goes by exactly the channel its row says:
    // PUSH = push only (no device = FAILED, never SMS), SMS = no push attempt.
    if (log.trigger === CommunicationTrigger.ARRIVAL_NOTICE) {
      if (log.medium === PUSH_MEDIUM) {
        const pushed = await this.pushToGuardian(job, log);
        if (pushed === 'TRANSIENT' && job.attemptsMade + 1 < (job.opts.attempts ?? 1)) {
          // Transient endpoint failure: let BullMQ retry; the log stays QUEUED.
          throw new Error(`Transient push failure for arrival notice ${log.id}`);
        }
        if (pushed !== true) {
          log.status = CommunicationStatus.FAILED;
          const exhausted = pushed === 'TRANSIENT';
          log.metadata = {
            ...log.metadata,
            reason: exhausted ? 'PUSH_TRANSIENT_FAILURE' : 'NO_PUSH_DEVICE',
          };
          await this.settle(log, 'failure');
          if (exhausted) {
            // Retries ran out on a device that does exist: not the same as "no device", so make it loud.
            this.reportFailure(
              {
                queue: COMMUNICATIONS_QUEUE,
                job_name: job.name,
                communication_log_id: log.id,
                tenant_id: log.tenant_id,
                medium: log.medium,
                reason: 'PUSH_TRANSIENT_FAILURE',
              },
              new Error(`Push retries exhausted for arrival notice ${log.id}`),
            );
          }
        }
        return;
      }
      if (log.medium !== CommunicationMedium.SMS) {
        log.status = CommunicationStatus.FAILED;
        log.metadata = { ...log.metadata, reason: 'ARRIVAL_MEDIUM' };
        await this.settle(log, 'failure');
        return;
      }
      // SMS: fall through to the reservation backstop and provider dispatch.
    } else if (await this.tryPushFirst(job, log)) {
      return;
    }

    // [#2216] Backstop: a metered tenant's SMS must carry a reservation. Any
    // producer (current or future) that forgot to reserve is failed here, not
    // sent on the platform's gateway account. No throw, so no retry.
    if (
      log.medium === CommunicationMedium.SMS &&
      !this.isSettleableSmsBatchJob(job, log) &&
      (await this.smsCredits.isMetered(log.tenant_id))
    ) {
      log.status = CommunicationStatus.FAILED;
      log.metadata = { ...log.metadata, reason: 'UNRESERVED_SMS' };
      await this.settle(log, 'failure');
      // Reaching here means a producer forgot to reserve — make it loud.
      this.reportFailure(
        {
          queue: COMMUNICATIONS_QUEUE,
          job_name: job.name,
          communication_log_id: log.id,
          tenant_id: log.tenant_id,
          medium: log.medium,
          reason: 'UNRESERVED_SMS',
        },
        new Error(`Unreserved SMS for metered tenant (communication ${log.id})`),
      );
      return;
    }

    // `tryPushFirst` returning false leaves `log.medium` exactly as it was
    // read from the DB — a real `CommunicationMedium`, never `'PUSH'` (that
    // literal is only ever assigned inside `tryPushFirst`'s success branch,
    // which returns true). The cast reflects that, not a new assumption.
    const provider = this.providerRegistry.resolve(log.medium as CommunicationMedium);
    if (!provider) {
      // Not retryable — no deploy in between attempts will make a medium
      // suddenly have a provider.
      log.status = CommunicationStatus.FAILED;
      log.metadata = {
        ...log.metadata,
        error: `No provider registered for medium "${log.medium}"`,
      };
      await this.settle(log, 'failure');
      if (this.isSettleableSmsBatchJob(job, log)) {
        await this.settleSmsCredit(job, log, 'RELEASE');
      }
      return;
    }

    const templateName = (log.metadata as { template_name?: string } | null)?.template_name;
    const templateLanguage = (log.metadata as { template_language?: string } | null)
      ?.template_language;
    const templateParams = (log.metadata as { template_params?: string[] } | null)?.template_params;

    // Providers are contractually not supposed to throw (see
    // CommunicationProvider) — this catch is defense-in-depth so a
    // provider bug still resolves to a normal failure result instead of
    // an unhandled rejection.
    let result;
    try {
      result = await provider.send(
        {
          to: log.recipient_address,
          body: log.message_body,
          subject: log.subject ?? undefined,
          templateName,
          templateLanguage,
          templateParams,
        },
        log.tenant_id,
      );
    } catch (err) {
      // A provider that throws instead of returning a result never told us
      // whether the message went out — AMBIGUOUS, same as the network-error
      // branch each provider's own catch block maps to.
      result = {
        success: false,
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
        outcome: 'AMBIGUOUS' as const,
      };
    }

    // [15.6.1] SMS-only — `result.segments` comes from the shared
    // `countSmsSegments`; every other provider leaves it `undefined`, so
    // `metadata.segments` is only ever set for SMS.
    const sendMetadata = {
      ...(result.segments !== undefined ? { segments: result.segments } : {}),
      // [97.4.01] D23: which company sent it, so check-status asks the same one (all media).
      ...('provider' in result && result.provider ? { provider: result.provider } : {}),
      // #3350: and whose account, so check-status does not read a draft the send ignored.
      ...('source' in result && result.source ? { source: result.source } : {}),
    };
    const settleable = this.isSettleableSmsBatchJob(job, log);

    if (result.success) {
      log.status = CommunicationStatus.SENT;
      log.provider_message_id = result.providerMessageId;
      log.metadata = { ...log.metadata, raw: result.raw, ...sendMetadata };
      await this.settle(log, 'success');
      // [15.6.6/#549] Settlement runs AFTER the provider call and the
      // settle() transaction, and outside both — a credit-ledger hiccup
      // must never roll back (or delay recording) a send that already
      // happened. ACCEPTED -> DEBIT.
      if (settleable) {
        await this.settleSmsCredit(job, log, 'DEBIT');
      }
      return;
    }

    log.metadata = { ...log.metadata, error: result.error, raw: result.raw, ...sendMetadata };

    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
    // `retryable === false` means the provider itself says retrying can
    // never help (e.g. ProviderNotConfiguredError) — settle FAILED on the
    // first attempt instead of burning the rest of the queue's backoff
    // budget on a failure that will be identical every time.
    if (isFinalAttempt || result.retryable === false) {
      log.status = CommunicationStatus.FAILED;
      // AMBIGUOUS is flagged for reconciliation and written into metadata
      // *before* `settle()` so it lands in the same transactional save as
      // the FAILED status — no reservation to touch, so nothing runs after.
      if (settleable && result.outcome === 'AMBIGUOUS') {
        this.flagAmbiguousSettlement(job, log);
      }
      await this.settle(log, 'failure');
      // BullMQ only fires `failed` when the processor throws — a terminal
      // failure recorded here still returns normally, so this handler is
      // the only place that reports it (`onFailed` never sees this job).
      this.reportFailure(
        {
          queue: COMMUNICATIONS_QUEUE,
          job_name: job.name,
          communication_log_id: log.id,
          tenant_id: log.tenant_id,
          medium: log.medium,
        },
        new Error(result.error ?? `Provider failed to send communication ${log.id}`),
      );
      // REJECTED -> RELEASE, run after settle()/its transaction like the
      // DEBIT path above.
      if (settleable && result.outcome === 'REJECTED') {
        await this.settleSmsCredit(job, log, 'RELEASE');
      }
      return;
    }

    // Keep the row QUEUED with the latest failure recorded, then throw so
    // BullMQ's configured attempts/backoff actually retries the job —
    // returning normally here would mark the job "completed" even though
    // the send failed.
    await this.repo.save(log);
    throw new Error(result.error ?? `Provider failed to send communication ${log.id}`);
  }

  /**
   * [15.1.4] Tags a failed/stalled BullMQ event with ids only — never
   * `job.data`/log body — so Sentry's PII allowlist (`common/sentry.ts`)
   * isn't relied on as the only backstop for a queue-specific payload it
   * has no visibility into.
   */
  private async buildTags(job: Job<SendJobData>): Promise<Record<string, string>> {
    const tags: Record<string, string> = {
      queue: COMMUNICATIONS_QUEUE,
      job_name: job.name,
      communication_log_id: job.data.logId,
    };
    // Best-effort: the log may already be gone (hard-deleted) by the time a
    // stalled/failed event fires, or the lookup itself can reject (DB
    // hiccup) — either way tenant/medium are a nice-to-have, not a
    // precondition for reporting the failure itself.
    const log = await this.repo.findOne({ where: { id: job.data.logId } }).catch(() => null);
    if (log) {
      tags.tenant_id = log.tenant_id;
      tags.medium = log.medium;
    }
    return tags;
  }

  private reportFailure(tags: Record<string, string>, err: Error): void {
    this.logger.error({
      msg: 'communications job failed permanently',
      ...tags,
      error_class: err?.constructor?.name,
    });
    Sentry.withScope((scope) => {
      scope.setTags(tags);
      Sentry.captureException(err);
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<SendJobData> | undefined, err: Error): Promise<void> {
    if (!job) {
      return;
    }
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade >= maxAttempts;
    if (!isFinalAttempt) {
      return;
    }
    const tags = await this.buildTags(job);
    this.reportFailure(tags, err);
  }

  @OnWorkerEvent('stalled')
  async onStalled(jobId: string): Promise<void> {
    // The queue job id (`jobId`) is not the communication log id — enqueue
    // callers only ever store that in `SendJobData.logId`. Resolve the
    // actual BullMQ job first so the log lookup (and thus tenant_id/medium)
    // targets the right row instead of silently missing it.
    const job = await Promise.resolve()
      .then(() => Job.fromId<SendJobData>(this.worker, jobId))
      .catch(() => undefined);
    const logId = job?.data.logId ?? jobId;
    const tags: Record<string, string> = {
      queue: COMMUNICATIONS_QUEUE,
      communication_log_id: logId,
    };
    const log = await this.repo.findOne({ where: { id: logId } }).catch(() => null);
    if (log) {
      tags.tenant_id = log.tenant_id;
      tags.medium = log.medium;
    }
    this.logger.error({ msg: 'communications job stalled', ...tags });
    Sentry.withScope((scope) => {
      scope.setTags(tags);
      Sentry.captureMessage('communications job stalled', 'warning');
    });
  }
}
