import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CommunicationMedium, countSmsSegments } from '@biddaloy/shared';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import { SchoolsService } from '../../schools/schools.service';
import { SmsCreditBalance } from './entities/sms-credit-balance.entity';
import {
  SmsCreditLedger,
  SmsCreditLedgerKind,
  SmsCreditLedgerReferenceType,
} from './entities/sms-credit-ledger.entity';

export interface CreditMovementOptions {
  reason?: string;
  actorUserId?: string;
  idempotencyKey: string;
  /** Runs inside the same transaction as the ledger/balance write, only
   * when this call actually applies a new movement (never on an
   * idempotency-key replay) — so a caller's side effect (e.g. an audit
   * row) commits or rolls back atomically with the movement it describes,
   * instead of possibly landing after a commit that a later crash never
   * lets it repair. */
  onApplied?: (manager: EntityManager) => Promise<void>;
}

export type SettleOutcome = 'DEBIT' | 'RELEASE';

export interface CreditBalance {
  available: number;
  reserved: number;
}

export interface CreditMovementResult extends CreditBalance {
  /** `false` when `idempotencyKey` had already been applied — the balance
   * is current, but no new ledger row was written on this call. Lets a
   * caller (e.g. `SmsCreditsService.grantOrAdjust`) skip auditing a replay
   * as if it were a second movement. */
  applied: boolean;
}

function pgErrorCode(err: unknown): string | undefined {
  return err instanceof QueryFailedError ? (err as unknown as { code?: string }).code : undefined;
}

/** Postgres 23505 — unique_violation. */
function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23505';
}

/** Postgres 23514 — check_violation (the `available >= 0 AND reserved >= 0`
 * constraint on `sms_credit_balance`). */
function isCheckViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23514';
}

/**
 * [15.6.3/#546] The only writer to `sms_credit_ledger`/`sms_credit_balance`
 * (epic #508 D6). One credit == one SMS segment, always an integer (D5) —
 * every `units` argument here is assumed already-counted via the shared
 * `countSmsSegments` helper (#544); this service just moves the numbers.
 *
 * Every mutating method is idempotent on its `idempotencyKey` (or, for
 * `settlePart`, `${logKey}:settle`) and tenant-scoped — callers never pass
 * raw SQL, only a `tenantId` plus plain values.
 */
@Injectable()
export class SmsCreditService {
  private readonly logger = new Logger(SmsCreditService.name);

  constructor(
    @InjectRepository(SmsCreditBalance)
    private readonly balanceRepo: Repository<SmsCreditBalance>,
    @InjectRepository(SmsCreditLedger)
    private readonly ledgerRepo: Repository<SmsCreditLedger>,
    private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
  ) {}

  /** `communications.sms.metering === 'PLATFORM'`. Absent/`OFF` (or no
   * `communications.sms` section at all) reads as unmetered. */
  async isMetered(tenantId: string): Promise<boolean> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    return settings.communications?.sms?.metering === 'PLATFORM';
  }

  async getBalance(tenantId: string): Promise<CreditBalance> {
    return this.readBalance(this.balanceRepo.manager, tenantId);
  }

  /** Tenant-scoped, newest-first page of the ledger — backs #550's
   * `GET /communications/sms-credits`. */
  async listLedger(
    tenantId: string,
    page: number,
    limit: number,
  ): Promise<{ data: SmsCreditLedger[]; total: number }> {
    const [data, total] = await this.ledgerRepo.findAndCount({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  /** Balance + a page of ledger history, in the shape both
   * `GET /communications/sms-credits` (tenant-facing) and
   * `GET /schools/:id/sms-credits` (SUPER_ADMIN, cross-school) return —
   * they differ only in which `tenantId` the caller is allowed to pass. */
  async getCreditsSummary(
    tenantId: string,
    page: number,
    limit: number,
  ): Promise<{
    metering: 'OFF' | 'PLATFORM';
    available: number;
    reserved: number;
    ledger: {
      data: SmsCreditLedger[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const metering = await this.isMetered(tenantId);
    if (!metering) {
      // Contract: OFF always returns the zeroed shape, never a stale
      // balance/ledger a tenant accrued before metering was switched off.
      return {
        metering: 'OFF',
        available: 0,
        reserved: 0,
        ledger: { data: [], total: 0, page, limit, totalPages: 1 },
      };
    }

    const [balance, { data, total }] = await Promise.all([
      this.getBalance(tenantId),
      this.listLedger(tenantId, page, limit),
    ]);

    return {
      metering: 'PLATFORM',
      available: balance.available,
      reserved: balance.reserved,
      ledger: {
        data,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private async readBalance(manager: EntityManager, tenantId: string): Promise<CreditBalance> {
    const row = await manager.findOne(SmsCreditBalance, { where: { tenant_id: tenantId } });
    return { available: row?.available ?? 0, reserved: row?.reserved ?? 0 };
  }

  /** Adds `units` (always positive) to `available`. Idempotent: a repeat
   * `idempotencyKey` is a no-op that just returns the current balance. */
  async grant(
    tenantId: string,
    units: number,
    opts: CreditMovementOptions,
  ): Promise<CreditMovementResult> {
    return this.applyMovement(tenantId, SmsCreditLedgerKind.GRANT, units, units, opts);
  }

  /** Signed manual correction — `signedUnits` can be negative. A correction
   * that would drive `available` below 0 is rejected as a 400 (the DB
   * check constraint is the real guard; this just maps its error). */
  async adjust(
    tenantId: string,
    signedUnits: number,
    opts: CreditMovementOptions,
  ): Promise<CreditMovementResult> {
    return this.applyMovement(tenantId, SmsCreditLedgerKind.ADJUST, signedUnits, signedUnits, opts);
  }

  private async applyMovement(
    tenantId: string,
    kind: SmsCreditLedgerKind,
    ledgerUnits: number,
    availableDelta: number,
    opts: CreditMovementOptions,
  ): Promise<CreditMovementResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(SmsCreditLedger, {
          where: { tenant_id: tenantId, idempotency_key: opts.idempotencyKey },
        });
        if (existing) {
          return { ...(await this.readBalance(manager, tenantId)), applied: false };
        }

        await manager.insert(SmsCreditLedger, {
          tenant_id: tenantId,
          kind,
          units: ledgerUnits,
          reference_type: SmsCreditLedgerReferenceType.MANUAL,
          reference_id: null,
          idempotency_key: opts.idempotencyKey,
          reason: opts.reason ?? null,
          actor_user_id: opts.actorUserId ?? null,
        });

        await manager.query(
          `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved, updated_at)
           VALUES ($1, $2, 0, now())
           ON CONFLICT (tenant_id) DO UPDATE
             SET available = "sms_credit_balance".available + $2, updated_at = now()`,
          [tenantId, availableDelta],
        );

        await opts.onApplied?.(manager);

        return { ...(await this.readBalance(manager, tenantId)), applied: true };
      });
    } catch (err) {
      // Lost a race with a concurrent call carrying the same idempotency
      // key — that call's insert won, this one's transaction (balance
      // change included) rolled back automatically. Current balance is
      // the correct answer, no-op from this caller's point of view.
      if (isUniqueViolation(err)) {
        return { ...(await this.getBalance(tenantId)), applied: false };
      }
      if (isCheckViolation(err)) {
        throw new BadRequestException(
          "Adjustment would drive this school's SMS credit balance below zero.",
        );
      }
      throw err;
    }
  }

  /** [#2216] Reserve under the shared `batch:<batchId>` key (#1317) only when
   * the tenant is metered. Producers that queue SMS call this once per
   * message/batch so no metered SMS reaches a gateway unreserved. */
  async reserveIfMetered(
    tenantId: string,
    units: number,
    batchId: string,
  ): Promise<'UNMETERED' | 'RESERVED' | { insufficient: true; available: number }> {
    if (!(await this.isMetered(tenantId))) return 'UNMETERED';
    const res = await this.reserve(tenantId, units, `batch:${batchId}`, {
      type: 'batch',
      id: batchId,
    });
    return res.ok ? 'RESERVED' : { insufficient: true, available: res.available };
  }

  /** [#2216] For automated one-log-at-a-time producers (absence, homework,
   * admission): returns the extra job data to queue with (`{}` when the log is
   * not SMS or the tenant is unmetered) or `'INSUFFICIENT'` when credit is short.
   * The batch key is the log id, so a retried call is idempotent. */
  async reserveForLog(
    tenantId: string,
    log: { id: string; medium: string; message_body: string },
  ): Promise<{ batchId?: string; segments?: number } | 'INSUFFICIENT'> {
    if (log.medium !== CommunicationMedium.SMS) return {};
    const segments = countSmsSegments(log.message_body).segments;
    const outcome = await this.reserveIfMetered(tenantId, segments, log.id);
    if (outcome === 'UNMETERED') return {};
    if (outcome === 'RESERVED') return { batchId: log.id, segments };
    return 'INSUFFICIENT';
  }

  /** [#2216] Give back a `reserveForLog` reservation when its job was never
   * queued. Never throws: the caller is already handling a failure. */
  async releaseForLog(
    tenantId: string,
    logId: string,
    segments: number,
    batchId: string = logId,
  ): Promise<void> {
    try {
      await this.settlePart(tenantId, `batch:${batchId}`, `log:${logId}`, segments, 'RELEASE');
    } catch (err) {
      this.logger.error({
        msg: 'sms credit release on enqueue failure failed — reservation left stranded',
        communication_log_id: logId,
        tenant_id: tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Atomically moves `units` from `available` to `reserved`. Duplicate
   * `idempotencyKey` returns `{ ok: true }` without touching the balance —
   * it's already reserved. */
  async reserve(
    tenantId: string,
    units: number,
    idempotencyKey: string,
    reference?: { type: 'batch' | 'log' | 'manual'; id: string | null },
  ): Promise<{ ok: true } | { ok: false; available: number }> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(SmsCreditLedger, {
          where: { tenant_id: tenantId, idempotency_key: idempotencyKey },
        });
        if (existing) {
          return { ok: true as const };
        }

        // Postgres via the pg driver returns `[rows, affectedCount]` for a
        // parameterized RETURNING query, not just the row array — checking
        // `rows.length` (not the tuple's own length, which is always 2)
        // is what tells apart "0 rows matched" from "1 row updated".
        const [rows]: [Array<{ available: number }>, number] = await manager.query(
          `UPDATE "sms_credit_balance"
             SET available = available - $2, reserved = reserved + $2, updated_at = now()
             WHERE tenant_id = $1 AND available >= $2
             RETURNING available`,
          [tenantId, units],
        );
        if (rows.length === 0) {
          const balance = await this.readBalance(manager, tenantId);
          return { ok: false as const, available: balance.available };
        }

        await manager.insert(SmsCreditLedger, {
          tenant_id: tenantId,
          kind: SmsCreditLedgerKind.RESERVE,
          units,
          reference_type:
            reference?.type === 'batch'
              ? SmsCreditLedgerReferenceType.BATCH
              : reference?.type === 'log'
                ? SmsCreditLedgerReferenceType.LOG
                : SmsCreditLedgerReferenceType.MANUAL,
          reference_id: reference?.id ?? null,
          idempotency_key: idempotencyKey,
        });
        return { ok: true as const };
      });
    } catch (err) {
      // Same race as applyMovement: another call with this exact key won
      // the ledger insert first, so this one's balance UPDATE was rolled
      // back with the rest of its transaction — already reserved.
      if (isUniqueViolation(err)) {
        return { ok: true as const };
      }
      throw err;
    }
  }

  /** Settles a whole reservation exactly once. `DEBIT` consumes the
   * reserved units; `RELEASE` returns them to `available`. A second call
   * with the same `idempotencyKey` is a no-op. */
  async settle(tenantId: string, idempotencyKey: string, outcome: SettleOutcome): Promise<void> {
    const settleKey = `${idempotencyKey}:settle`;
    await this.dataSource.transaction(async (manager) => {
      const reserveRow = await manager.findOne(SmsCreditLedger, {
        where: {
          tenant_id: tenantId,
          idempotency_key: idempotencyKey,
          kind: SmsCreditLedgerKind.RESERVE,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reserveRow) {
        throw new BadRequestException('No matching SMS credit reservation was found.');
      }

      const alreadySettled = await manager.findOne(SmsCreditLedger, {
        where: { tenant_id: tenantId, idempotency_key: settleKey },
      });
      if (alreadySettled) {
        return;
      }

      await this.moveReservedUnits(manager, tenantId, reserveRow.units, outcome);
      await manager.insert(SmsCreditLedger, {
        tenant_id: tenantId,
        kind: outcome === 'DEBIT' ? SmsCreditLedgerKind.DEBIT : SmsCreditLedgerKind.RELEASE,
        units: reserveRow.units,
        reference_type: SmsCreditLedgerReferenceType.MANUAL,
        reference_id: null,
        idempotency_key: settleKey,
      });
    });
  }

  /** Peels `units` off a batch reservation (identified by `batchKey`, the
   * idempotency key its `reserve` call used) under a per-log idempotency
   * key `${logKey}:settle`. Used by #549 to settle one SMS at a time out
   * of a bulk-reminder batch's single reservation. `units` cannot exceed
   * what's left reserved *for this batch* — the DB check constraint only
   * guards the tenant-wide `reserved` total, which stays non-negative even
   * if this settlement dips into a different batch's reservation, so the
   * batch-level cap below is enforced explicitly: it sums this batch's own
   * prior DEBIT/RELEASE rows (found via `reference_id`, set to the same
   * batch id `reserve` recorded on the RESERVE row) and rejects when that
   * sum plus `units` would exceed the RESERVE row's own `units`. The
   * pessimistic lock on the RESERVE row below serializes concurrent
   * `settlePart` calls for the same batch, so this sum is read
   * consistently without a separate lock of its own. */
  async settlePart(
    tenantId: string,
    batchKey: string,
    logKey: string,
    units: number,
    outcome: SettleOutcome,
    reason?: string,
  ): Promise<void> {
    const settleKey = `${logKey}:settle`;
    try {
      await this.dataSource.transaction(async (manager) => {
        const reserveRow = await manager.findOne(SmsCreditLedger, {
          where: {
            tenant_id: tenantId,
            idempotency_key: batchKey,
            kind: SmsCreditLedgerKind.RESERVE,
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (!reserveRow) {
          throw new BadRequestException('No matching SMS credit reservation was found.');
        }

        const alreadySettled = await manager.findOne(SmsCreditLedger, {
          where: { tenant_id: tenantId, idempotency_key: settleKey },
        });
        if (alreadySettled) {
          return;
        }

        // `reference_id` is only populated when `reserve` was called with a
        // reference (every batch reservation is) — this check is skipped
        // for the rare/legacy reservation with none, since there is then
        // nothing to scope the sum to.
        if (reserveRow.reference_id !== null) {
          const priorSettlements = await manager.find(SmsCreditLedger, {
            where: {
              tenant_id: tenantId,
              reference_type: SmsCreditLedgerReferenceType.BATCH,
              reference_id: reserveRow.reference_id,
              kind: In([SmsCreditLedgerKind.DEBIT, SmsCreditLedgerKind.RELEASE]),
            },
          });
          const alreadySettledUnits = priorSettlements.reduce((sum, row) => sum + row.units, 0);
          if (alreadySettledUnits + units > reserveRow.units) {
            throw new BadRequestException(
              'Settling these units would exceed the remaining reserved SMS credit balance.',
            );
          }
        }

        await this.moveReservedUnits(manager, tenantId, units, outcome);
        await manager.insert(SmsCreditLedger, {
          tenant_id: tenantId,
          kind: outcome === 'DEBIT' ? SmsCreditLedgerKind.DEBIT : SmsCreditLedgerKind.RELEASE,
          units,
          reference_type: SmsCreditLedgerReferenceType.BATCH,
          reference_id: reserveRow.reference_id,
          idempotency_key: settleKey,
          reason: reason ?? null,
        });
      });
    } catch (err) {
      if (isCheckViolation(err)) {
        throw new BadRequestException(
          'Settling these units would exceed the remaining reserved SMS credit balance.',
        );
      }
      throw err;
    }
  }

  /**
   * Gives the credit of one message back to `available`, inside the caller's transaction so it
   * commits or rolls back with the status change that earned it (Check status, a vendor that does
   * not bill failed SMS). Once per message: the idempotency key is the log id, so a repeat is a
   * no-op. Whole units only (Rule 26).
   */
  async refundForLog(
    manager: EntityManager,
    tenantId: string,
    logId: string,
    units: number,
  ): Promise<void> {
    if (!Number.isInteger(units) || units <= 0) return;
    const key = `log:${logId}:refund`;
    const done = await manager.findOne(SmsCreditLedger, {
      where: { tenant_id: tenantId, idempotency_key: key },
    });
    if (done) return;
    await manager.insert(SmsCreditLedger, {
      tenant_id: tenantId,
      kind: SmsCreditLedgerKind.GRANT,
      units,
      reference_type: SmsCreditLedgerReferenceType.LOG,
      reference_id: logId,
      idempotency_key: key,
      reason: 'Vendor reported the SMS failed; credit given back',
    });
    await manager.query(
      `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved, updated_at)
       VALUES ($1, $2, 0, now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET available = "sms_credit_balance".available + $2, updated_at = now()`,
      [tenantId, units],
    );
  }

  private async moveReservedUnits(
    manager: EntityManager,
    tenantId: string,
    units: number,
    outcome: SettleOutcome,
  ): Promise<void> {
    if (outcome === 'DEBIT') {
      await manager.query(
        `UPDATE "sms_credit_balance" SET reserved = reserved - $2, updated_at = now() WHERE tenant_id = $1`,
        [tenantId, units],
      );
    } else {
      await manager.query(
        `UPDATE "sms_credit_balance"
           SET reserved = reserved - $2, available = available + $2, updated_at = now()
           WHERE tenant_id = $1`,
        [tenantId, units],
      );
    }
  }
}
