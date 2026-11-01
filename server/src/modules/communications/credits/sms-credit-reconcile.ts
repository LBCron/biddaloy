import { DataSource, Repository } from 'typeorm';
import { CommunicationStatus, CommunicationTrigger, countSmsSegments } from '@biddaloy/shared';
import { ACCEPTED_STATUSES, CommunicationLog } from '../entities/communication-log.entity';
import { SmsCreditLedger, SmsCreditLedgerKind } from './entities/sms-credit-ledger.entity';
import type { SmsCreditService } from './sms-credit.service';

/**
 * [#1317] Operator-only reconciliation of SMS credit reservations stranded
 * by the old key mismatch (reserve key without the `batch:` prefix that the
 * worker settles under). Not registered in any Nest module: nothing runs on
 * import or boot; `scripts/reconcile-sms-credit.ts` is the only entry point.
 *
 * Every ledger/balance write goes through `SmsCreditService.settlePart`
 * using the same `log:<id>` part key the worker would have used, so a re-run
 * or a late worker run is a no-op. This file never writes the ledger or
 * balance itself.
 */

export type ReconcileSource =
  'FEE_NOTIFY' | 'PAYMENT_NOTIFY' | 'INVOICE_SEND' | 'RESULT_SMS' | 'UNKNOWN';

export type ReconcileAction =
  'DEBIT' | 'RELEASE' | 'MANUAL_REVIEW' | 'ALREADY_SETTLED' | 'IN_FLIGHT' | 'ERROR';

export interface ReconcileRow {
  tenantId: string;
  reserveLedgerId: string;
  source: ReconcileSource;
  logId: string | null;
  units: number;
  action: ReconcileAction;
  reason: string;
}

export interface ReconcileTenantReport {
  tenantId: string;
  strandedReserves: number;
  settledReserves: number;
  rows: ReconcileRow[];
}

export const RECONCILE_REASON = 'reconcile #1317';

const INVOICE_LINK_MS = 5 * 60_000;

function sourceOf(key: string): ReconcileSource {
  if (key.startsWith('fee-notify:')) return 'FEE_NOTIFY';
  if (key.startsWith('payment-notify:')) return 'PAYMENT_NOTIFY';
  if (key.startsWith('invoice-send:')) return 'INVOICE_SEND';
  if (key.startsWith('exam-result-sms:')) return 'RESULT_SMS';
  return 'UNKNOWN';
}

function errClass(err: unknown): string {
  return err instanceof Error ? err.constructor.name : 'Error';
}

function meta(log: CommunicationLog): Record<string, any> {
  return log.metadata ?? {};
}

function unitsOf(log: CommunicationLog): number {
  return countSmsSegments(log.message_body).segments;
}

export async function reconcileStrandedSmsCredit(
  dataSource: DataSource,
  credits: Pick<SmsCreditService, 'settlePart'>,
  opts: {
    apply: boolean;
    tenantId?: string;
    /** Called as soon as each tenant finishes, so an operator sees progress. */
    onTenantDone?: (report: ReconcileTenantReport) => void;
  },
): Promise<ReconcileTenantReport[]> {
  const tenantIds = opts.tenantId
    ? [opts.tenantId]
    : (
        (await dataSource.query(
          `SELECT DISTINCT tenant_id FROM sms_credit_ledger
            WHERE kind = 'RESERVE'
              AND (idempotency_key NOT LIKE 'batch:%'
                   OR idempotency_key LIKE 'batch:fee-notify:%'
                   OR idempotency_key LIKE 'batch:payment-notify:%'
                   OR created_at < now() - interval '24 hours')
            ORDER BY tenant_id`,
        )) as Array<{ tenant_id: string }>
      ).map((r) => r.tenant_id);

  const reports: ReconcileTenantReport[] = [];
  for (const tenantId of tenantIds) {
    const rep = await reconcileTenant(dataSource, credits, tenantId, opts.apply);
    reports.push(rep);
    opts.onTenantDone?.(rep);
  }
  return reports;
}

async function reconcileTenant(
  dataSource: DataSource,
  credits: Pick<SmsCreditService, 'settlePart'>,
  tenantId: string,
  apply: boolean,
): Promise<ReconcileTenantReport> {
  const ledgerRepo = dataSource.getRepository(SmsCreditLedger);
  const logRepo = dataSource.getRepository(CommunicationLog);
  const report: ReconcileTenantReport = {
    tenantId,
    strandedReserves: 0,
    settledReserves: 0,
    rows: [],
  };

  const legacy = (await ledgerRepo
    .createQueryBuilder('l')
    .where('l.tenant_id = :tenantId', { tenantId })
    .andWhere('l.kind = :kind', { kind: SmsCreditLedgerKind.RESERVE })
    .andWhere(`l.idempotency_key NOT LIKE 'batch:%'`)
    .orderBy('l.created_at', 'ASC')
    .addOrderBy('l.id', 'ASC')
    .getMany()) as SmsCreditLedger[];
  report.strandedReserves = legacy.length;
  // Reference ids of shared groups already reported: no member may be re-listed as BATCH_REMAINDER.
  const reportedGroupRefs = new Set<string>();

  const invoiceReserves = legacy.filter((r) => sourceOf(r.idempotency_key) === 'INVOICE_SEND');

  const push = (
    r: SmsCreditLedger,
    logId: string | null,
    units: number,
    action: ReconcileAction,
    reason: string,
  ) =>
    report.rows.push({
      tenantId,
      reserveLedgerId: r.id,
      source: sourceOf(r.idempotency_key),
      logId,
      units,
      action,
      reason,
    });

  for (const r of legacy) {
    try {
      const source = sourceOf(r.idempotency_key);
      const key = r.idempotency_key;

      // A post-fix `batch:` twin shares this reserve's reference_id, which would mix both
      // reservations in settlePart's cap sum.
      if (
        source !== 'RESULT_SMS' &&
        source !== 'UNKNOWN' &&
        (await ledgerRepo.count({
          where: {
            tenant_id: tenantId,
            idempotency_key: `batch:${key}`,
            kind: SmsCreditLedgerKind.RESERVE,
          },
        })) > 0
      ) {
        push(r, null, r.units, 'MANUAL_REVIEW', 'SPLIT_ACROSS_DEPLOY');
        continue;
      }

      // Legacy invoice-send reserves were written as {type:'manual', id: invoiceId}: every
      // guardian's reserve for one invoice shares a reference_id, so settlePart's cap sum would
      // mix them. (Result SMS has one reserve per exam key, so it is never a group.)
      // Never settle those. Report the group's unsettled remainder once, skip it if nothing is left.
      if (r.reference_id !== null) {
        const group = (await ledgerRepo.find({
          where: {
            tenant_id: tenantId,
            kind: SmsCreditLedgerKind.RESERVE,
            reference_id: r.reference_id,
          },
          order: { created_at: 'ASC', id: 'ASC' },
        })) as SmsCreditLedger[];
        if (group.length > 1) {
          const legacyInGroup = group.filter((x) => !x.idempotency_key.startsWith('batch:'));
          if (legacyInGroup[0].id !== r.id) continue; // reported once, on the first legacy reserve
          // Any settlement on this reference counts, whatever its key form (bare-key releases
          // from main's enqueue-failure path included).
          const settled = (await ledgerRepo
            .createQueryBuilder('l')
            .where('l.tenant_id = :tenantId', { tenantId })
            .andWhere('(l.reference_id = :ref OR l.idempotency_key IN (:...bare))', {
              ref: r.reference_id,
              bare: group.map((x) => `${x.idempotency_key}:settle`),
            })
            .andWhere('l.kind IN (:...kinds)', {
              kinds: [SmsCreditLedgerKind.DEBIT, SmsCreditLedgerKind.RELEASE],
            })
            .getMany()) as SmsCreditLedger[];
          const left =
            group.reduce((n, x) => n + x.units, 0) - settled.reduce((n, x) => n + x.units, 0);
          reportedGroupRefs.add(r.reference_id);
          if (left <= 0) report.settledReserves += legacyInGroup.length;
          else push(r, null, left, 'MANUAL_REVIEW', 'SHARED_REFERENCE');
          continue;
        }
      }

      // Remaining units by the same rule as settlePart's per-reservation cap (own reference only).
      let remaining = r.units;
      let prior: SmsCreditLedger[] = [];
      if (r.reference_id !== null) {
        prior = (await ledgerRepo
          .createQueryBuilder('l')
          .where('l.tenant_id = :tenantId', { tenantId })
          .andWhere('l.reference_id = :ref', { ref: r.reference_id })
          .andWhere('l.kind IN (:...kinds)', {
            kinds: [SmsCreditLedgerKind.DEBIT, SmsCreditLedgerKind.RELEASE],
          })
          .getMany()) as SmsCreditLedger[];
        remaining -= prior.reduce((sum, x) => sum + x.units, 0);
      }
      // Legacy whole-reservation `settle()` wrote `<key>:settle` with reference NULL (the
      // enqueue-failure release writes `log:<id>:settle`). Skip it if already counted in `prior`.
      const bareSettle = await ledgerRepo.findOne({
        where: { tenant_id: tenantId, idempotency_key: `${key}:settle` },
      });
      if (bareSettle && !prior.some((x) => x.id === bareSettle.id)) remaining -= bareSettle.units;
      const fullySettled = () => {
        report.settledReserves += 1;
      };

      if (source === 'RESULT_SMS' || source === 'UNKNOWN') {
        if (remaining <= 0) fullySettled();
        else
          push(
            r,
            null,
            remaining,
            'MANUAL_REVIEW',
            source === 'RESULT_SMS' ? 'NO_LOG_LINK' : 'UNKNOWN_KEY',
          );
        continue;
      }

      const logs = await linkedLogs(logRepo, tenantId, r, invoiceReserves);
      if (logs === 'AMBIGUOUS') {
        if (remaining <= 0) fullySettled();
        else push(r, null, remaining, 'MANUAL_REVIEW', 'AMBIGUOUS_LINK');
        continue;
      }

      const settleRows = logs.length
        ? ((await ledgerRepo
            .createQueryBuilder('l')
            .where('l.tenant_id = :tenantId', { tenantId })
            .andWhere('l.idempotency_key IN (:...keys)', {
              keys: logs.map((l) => `log:${l.id}:settle`),
            })
            .getMany()) as SmsCreditLedger[])
        : [];
      const settleByLog = new Map(settleRows.map((x) => [x.idempotency_key, x]));
      if (r.reference_id === null) remaining -= settleRows.reduce((sum, x) => sum + x.units, 0);
      if (remaining <= 0) {
        fullySettled();
        continue;
      }

      let planned = 0; // units we will settle
      let held = 0; // units left for a human / in-flight worker
      for (const log of logs) {
        const m = meta(log);
        if (m.reason === 'SKIPPED_NO_SMS' || m.reason === 'SKIPPED_NO_CREDIT') continue;
        const units = unitsOf(log);
        const settled = settleByLog.get(`log:${log.id}:settle`);

        if (settled) {
          push(r, log.id, settled.units, 'ALREADY_SETTLED', 'ALREADY_SETTLED');
          const credit = settled.kind === SmsCreditLedgerKind.DEBIT ? 'DEBITED' : 'RELEASED';
          if (apply && m.credit !== credit) {
            try {
              await logRepo.update({ id: log.id, tenant_id: tenantId }, {
                metadata: { ...m, credit },
              } as never);
            } catch (err) {
              push(r, log.id, 0, 'ERROR', `METADATA_UPDATE_FAILED:${errClass(err)}`);
            }
          }
          continue;
        }
        if (log.status === CommunicationStatus.QUEUED) {
          held += units;
          push(r, log.id, units, 'IN_FLIGHT', 'IN_FLIGHT');
          continue;
        }
        if (m.reason === 'ENQUEUE_FAILED') {
          held += units;
          push(r, log.id, units, 'MANUAL_REVIEW', 'ENQUEUE_FAILED_REPLAYABLE');
          continue;
        }

        const decision = decide(log, source);
        if (!decision) {
          held += units;
          push(r, log.id, units, 'MANUAL_REVIEW', 'FAILED_OUTCOME_UNKNOWN');
          continue;
        }
        if (planned + units > remaining) {
          held += units;
          push(r, log.id, units, 'MANUAL_REVIEW', 'EXCEEDS_RESERVATION');
          continue;
        }
        planned += units;
        if (!apply) {
          push(r, log.id, units, decision.outcome, decision.reason);
          continue;
        }
        try {
          // Same batch key + `log:<id>` part key the worker uses: replay-safe.
          await credits.settlePart(
            tenantId,
            key,
            `log:${log.id}`,
            units,
            decision.outcome,
            RECONCILE_REASON,
          );
        } catch (err) {
          // error class only: messages embed reserve keys
          planned -= units;
          push(r, log.id, units, 'ERROR', errClass(err));
          continue;
        }
        // Ledger write is done: count it even if the flag update fails (next run repairs it).
        push(r, log.id, units, decision.outcome, decision.reason);
        try {
          await logRepo.update({ id: log.id, tenant_id: tenantId }, {
            metadata: { ...m, credit: decision.outcome === 'DEBIT' ? 'DEBITED' : 'RELEASED' },
          } as never);
        } catch (err) {
          push(r, log.id, 0, 'ERROR', `METADATA_UPDATE_FAILED:${errClass(err)}`);
        }
      }

      const orphan = remaining - planned - held;
      if (orphan > 0) push(r, null, orphan, 'MANUAL_REVIEW', 'ORPHAN_UNITS');
    } catch (err) {
      // One bad reserve must not abort the run: in apply mode earlier rows have already settled.
      push(r, null, 0, 'ERROR', `RESERVE_FAILED:${errClass(err)}`);
    }
  }

  // Post-fix reservations whose listener enqueue failed hold units until a
  // replay; list only, never act (releasing would make the replay free).
  const stuck = (await dataSource.query(
    `SELECT l.id, l.message_body, r.id AS reserve_id, r.idempotency_key AS key
       FROM communication_logs l
       JOIN sms_credit_ledger r
         ON r.tenant_id = l.tenant_id AND r.kind = 'RESERVE'
        AND (r.idempotency_key = 'batch:fee-notify:' || (l.metadata->>'fee_generation_id') || ':sms'
             OR r.idempotency_key = 'batch:' || l.reference_key)
        AND (r.idempotency_key LIKE 'batch:fee-notify:%' OR r.idempotency_key LIKE 'batch:payment-notify:%')
      WHERE l.tenant_id = $1 AND l.medium = 'SMS'
        AND l.metadata->>'reason' = 'ENQUEUE_FAILED'
        AND NOT EXISTS (
          SELECT 1 FROM sms_credit_ledger s
           WHERE s.tenant_id = $1 AND s.idempotency_key = 'log:' || l.id || ':settle')
      ORDER BY l.created_at, l.id`,
    [tenantId],
  )) as Array<{ id: string; message_body: string; reserve_id: string; key: string }>;
  for (const s of stuck) {
    report.rows.push({
      tenantId,
      reserveLedgerId: s.reserve_id,
      source: s.key.startsWith('batch:fee-notify:') ? 'FEE_NOTIFY' : 'PAYMENT_NOTIFY',
      logId: s.id,
      units: countSmsSegments(s.message_body).segments,
      action: 'MANUAL_REVIEW',
      reason: 'ENQUEUE_FAILED_HOLDING_UNITS',
    });
  }

  // #3326 test-send claims: the row is written QUEUED before the vendor call and finished by the
  // same request. One still QUEUED after an hour was stranded (a crash during the vendor call, or
  // the final save failed): the SMS may have gone out, so a human decides. List only, never act.
  // Settled = a `log:<claim id>:settle` row, or the `log:<batch id>:settle` release that the
  // REJECTED + save-failed path writes (`connection-test.service.ts`): either way, nothing is held.
  // `units` is what the reserve holds, not a recount of the body.
  const strandedClaims = (await dataSource.query(
    `SELECT l.id, r.units, r.id AS reserve_id
       FROM communication_logs l
       JOIN sms_credit_ledger r
         ON r.tenant_id = l.tenant_id AND r.kind = 'RESERVE'
        AND r.idempotency_key = 'batch:' || (l.metadata->>'batch_id')
      WHERE l.tenant_id = $1 AND l.medium = 'SMS' AND l.status = 'QUEUED'
        AND l.metadata->>'test' = 'true'
        AND l.created_at < now() - interval '1 hour'
        AND NOT EXISTS (
          SELECT 1 FROM sms_credit_ledger s
           WHERE s.tenant_id = $1
             AND s.idempotency_key IN ('log:' || l.id || ':settle',
                                       'log:' || (l.metadata->>'batch_id') || ':settle'))
      ORDER BY l.created_at, l.id`,
    [tenantId],
  )) as Array<{ id: string; units: string | number; reserve_id: string }>;
  for (const c of strandedClaims) {
    report.rows.push({
      tenantId,
      reserveLedgerId: c.reserve_id,
      source: 'UNKNOWN',
      logId: c.id,
      units: Number(c.units),
      action: 'MANUAL_REVIEW',
      reason: 'TEST_CLAIM_STRANDED',
    });
  }

  // Post-fix `batch:` reserves (any producer) with units left, older than 24h, and no QUEUED SMS
  // log linked to it (window fallback: created in the 24h after the reserve, may be in flight): crash between
  // settle() and release, calendar SMS push-delivered by an old worker, or an old worker handling
  // a new-key job. List only, never act. A QUEUED log suppresses a reserve only if linked to it
  // (fee generation / payment reference_key); other producers carry no link, so for them the
  // narrow window above applies. ponytail: exact per-batch link for those if it hides rows.
  // A test-send claim never suppresses: it is never in flight a day later (listed above).
  // Remaining: by reference_id when set; null-reference reserves (payment, `{type:'log'}`) count
  // the `log:<id>:settle` rows of their own logs (reference_key) plus a bare-key settle.
  const alreadyListed = new Set(report.rows.map((x) => x.reserveLedgerId));
  const remainders = (await dataSource.query(
    `SELECT r.id, r.idempotency_key AS key, r.reference_id AS ref,
            r.units - COALESCE((
              SELECT SUM(s.units) FROM sms_credit_ledger s
               WHERE s.tenant_id = $1 AND s.kind IN ('DEBIT', 'RELEASE')
                 AND CASE WHEN r.reference_id IS NOT NULL
                          THEN s.reference_id = r.reference_id
                          ELSE s.idempotency_key = r.idempotency_key || ':settle'
                            OR s.idempotency_key IN (
                              SELECT 'log:' || l.id || ':settle' FROM communication_logs l
                               WHERE l.tenant_id = $1
                                 AND l.reference_key = substr(r.idempotency_key, 7))
                     END), 0) AS remaining
       FROM sms_credit_ledger r
      WHERE r.tenant_id = $1 AND r.kind = 'RESERVE'
        AND r.idempotency_key LIKE 'batch:%'
        AND r.created_at < now() - interval '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM communication_logs l
           WHERE l.tenant_id = $1 AND l.medium = 'SMS' AND l.status = 'QUEUED'
             AND CASE
                   WHEN r.idempotency_key LIKE 'batch:fee-notify:%'
                     THEN l.metadata->>'fee_generation_id' = split_part(r.idempotency_key, ':', 3)
                   WHEN r.idempotency_key LIKE 'batch:payment-notify:%'
                     THEN l.reference_key = substr(r.idempotency_key, 7)
                   ELSE l.created_at >= r.created_at
                    AND l.created_at < r.created_at + interval '24 hours'
                    AND (l.metadata->>'test') IS DISTINCT FROM 'true'
                 END)
      ORDER BY r.created_at, r.id`,
    [tenantId],
  )) as Array<{ id: string; key: string; ref: string | null; remaining: string | number }>;
  for (const b of remainders) {
    const left = Number(b.remaining);
    if (left <= 0 || alreadyListed.has(b.id) || (b.ref && reportedGroupRefs.has(b.ref))) continue;
    report.rows.push({
      tenantId,
      reserveLedgerId: b.id,
      source: sourceOf(b.key.slice('batch:'.length)),
      logId: null,
      units: left,
      action: 'MANUAL_REVIEW',
      reason: 'BATCH_REMAINDER',
    });
  }

  return report;
}

function decide(
  log: CommunicationLog,
  source: ReconcileSource,
): { outcome: 'DEBIT' | 'RELEASE'; reason: string } | null {
  const m = meta(log);
  if (ACCEPTED_STATUSES.includes(log.status)) {
    return { outcome: 'DEBIT', reason: 'SENT' };
  }
  if (log.status !== CommunicationStatus.FAILED) return null;
  if (m.reason === 'TENANT_SUSPENDED') return { outcome: 'RELEASE', reason: 'TENANT_SUSPENDED' };
  if (typeof m.error === 'string' && m.error.startsWith('No provider registered')) {
    return { outcome: 'RELEASE', reason: 'NO_PROVIDER' };
  }
  if (source === 'INVOICE_SEND' && m.error === 'Failed to enqueue for delivery') {
    return { outcome: 'RELEASE', reason: 'ENQUEUE_FAILED_MANUAL_SEND' };
  }
  // REJECTED vs AMBIGUOUS cannot be told apart on legacy rows.
  return null;
}

async function linkedLogs(
  logRepo: Repository<CommunicationLog>,
  tenantId: string,
  r: SmsCreditLedger,
  invoiceReserves: SmsCreditLedger[],
): Promise<CommunicationLog[] | 'AMBIGUOUS'> {
  const key = r.idempotency_key;
  const base = () =>
    logRepo
      .createQueryBuilder('log')
      .where('log.tenant_id = :tenantId', { tenantId })
      .andWhere(`log.medium = 'SMS'`);

  if (key.startsWith('fee-notify:')) {
    const genId = key.split(':')[1];
    return base()
      .andWhere(`log.metadata->>'fee_generation_id' = :genId`, { genId })
      .orderBy('log.created_at', 'ASC')
      .addOrderBy('log.id', 'ASC')
      .getMany();
  }
  if (key.startsWith('payment-notify:')) {
    return base()
      .andWhere('log.reference_key = :key', { key })
      .orderBy('log.created_at', 'ASC')
      .addOrderBy('log.id', 'ASC')
      .getMany();
  }

  // INVOICE_SEND. ponytail: time-window link; exact alternative is hashing the
  // `/i/<token>` against `invoice_share_tokens` if AMBIGUOUS_LINK shows up in practice.
  const guardianId = key.split(':')[2];
  const candidates = (await base()
    .andWhere('log.guardian_id = :guardianId', { guardianId })
    .andWhere('log.trigger = :trigger', { trigger: CommunicationTrigger.MANUAL })
    .andWhere(`log.message_body LIKE '%/i/%'`)
    .andWhere('log.created_at >= :from', { from: r.created_at })
    .andWhere('log.created_at < :to', { to: new Date(r.created_at.getTime() + INVOICE_LINK_MS) })
    .orderBy('log.created_at', 'ASC')
    .getMany()) as CommunicationLog[];
  if (candidates.length !== 1) return 'AMBIGUOUS';
  const log = candidates[0];
  const claimedByOther = invoiceReserves.some(
    (o) =>
      o.id !== r.id &&
      o.idempotency_key.split(':')[2] === guardianId &&
      log.created_at >= o.created_at &&
      log.created_at.getTime() < o.created_at.getTime() + INVOICE_LINK_MS,
  );
  return claimedByOther ? 'AMBIGUOUS' : [log];
}
