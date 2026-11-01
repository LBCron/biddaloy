import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { BadGatewayException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';
import { CommunicationLog } from './entities/communication-log.entity';
import { DeliveryStatusService } from './delivery-status.service';
import { SmsCreditService } from './credits/sms-credit.service';
import { SmsCreditBalance } from './credits/entities/sms-credit-balance.entity';
import { SmsCreditLedger } from './credits/entities/sms-credit-ledger.entity';

/**
 * [97.4.01] D23 check-status against the real schema: the jsonb merge keeps the other metadata
 * keys, status flips only when final, a provider error leaves the row as it was, the sink never
 * reaches a vendor, and one school cannot touch another's log. The provider is a fake (no network);
 * the vendor call itself is covered by each provider's spec with fetchPinnedJson mocked.
 */
describe('DeliveryStatusService (integration)', () => {
  let dataSource: DataSource;
  let service: DeliveryStatusService;
  let tenantA: string;
  let tenantB: string;
  const getStatus = vi.fn();
  // `refundsFailedSms` is the per-vendor setting (#3357); a test flips it on the shared descriptor.
  const descriptor: Record<string, unknown> = {
    medium: CommunicationMedium.SMS,
    name: 'stub-sms',
    capabilities: ['status'],
  };
  // Which account answers; a test that checks a platform-sent row says 'platform'.
  let resolvedSource: 'tenant' | 'platform' = 'tenant';
  const registry = {
    resolveFor: vi.fn(async () => ({
      provider: { descriptor, getStatus },
      config: { apiKey: 'k' },
      source: resolvedSource,
    })),
  };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(getDataSourceToken());
    // The real credit service on the real tables; only `isMetered` needs the schools service.
    const credits = new SmsCreditService(
      module.get(getRepositoryToken(SmsCreditBalance)),
      module.get(getRepositoryToken(SmsCreditLedger)),
      dataSource,
      {} as any,
    );
    service = new DeliveryStatusService(
      module.get(getRepositoryToken(CommunicationLog)),
      registry as any,
      credits,
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function makeSchool(name: string): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), $1, 'dlv-int-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
      [name],
    );
    return id;
  }

  async function addSentLog(
    tenantId: string,
    metadata: object,
    batchId: string | null = null,
  ): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO communication_logs
         (tenant_id, medium, recipient_address, recipient_name, message_body, status, provider_message_id, metadata, reminder_batch_id, created_at, updated_at)
       VALUES ($1, 'SMS', '01700000000', 'Test', 'hi', 'SENT', 'vendor-1', $2, $3, NOW(), NOW()) RETURNING id`,
      [tenantId, JSON.stringify(metadata), batchId],
    );
    return id;
  }

  /** A finished batch of `total` recipients that all counted as sent (the worker's view). */
  async function addBatch(tenantId: string, total: number): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO reminder_batches (tenant_id, batch_name, status, total_recipients, successful_count, failed_count, initiated_by_user_id)
       VALUES ($1, 'b', 'COMPLETED', $2, $2, 0, (SELECT id FROM users LIMIT 1)) RETURNING id`,
      [tenantId, total],
    );
    return id;
  }

  const counts = async (batchId: string) =>
    (
      await dataSource.query(
        `SELECT successful_count, failed_count, status FROM reminder_batches WHERE id = $1`,
        [batchId],
      )
    )[0] as { successful_count: number; failed_count: number; status: string };

  const row = async (id: string) =>
    (
      await dataSource.query(`SELECT status, metadata FROM communication_logs WHERE id = $1`, [id])
    )[0] as { status: string; metadata: Record<string, any> };

  beforeEach(async () => {
    getStatus.mockReset();
    tenantA = await makeSchool('Dlv Int A');
    tenantB = await makeSchool('Dlv Int B');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await dataSource.query(`DELETE FROM communication_logs WHERE tenant_id IN ($1, $2)`, [
      tenantA,
      tenantB,
    ]);
    await dataSource.query(`DELETE FROM "schools" WHERE id IN ($1, $2)`, [tenantA, tenantB]);
  });

  it('DELIVERED: sets status and merges metadata.delivery, keeping the other keys', async () => {
    const id = await addSentLog(tenantA, { provider: 'stub-sms', segments: 2, credit: 'DEBITED' });
    getStatus.mockResolvedValue({ status: 'DELIVERED', code: '000' });

    const dto = await service.checkStatus(id, tenantA, 'ADMIN');

    expect(dto).toMatchObject({ id, status: CommunicationStatus.DELIVERED, provider: 'stub-sms' });
    const stored = await row(id);
    expect(stored.status).toBe('DELIVERED');
    expect(stored.metadata).toMatchObject({
      provider: 'stub-sms',
      segments: 2,
      credit: 'DEBITED',
      delivery: { status: 'DELIVERED', code: '000', checkedAt: expect.any(String) },
    });
  });

  it('PENDING: stays SENT, writes checkedAt, and a second check inside a minute is a 409', async () => {
    const id = await addSentLog(tenantA, { provider: 'stub-sms' });
    getStatus.mockResolvedValue({ status: 'PENDING' });

    await service.checkStatus(id, tenantA, 'ADMIN');

    const stored = await row(id);
    expect(stored.status).toBe('SENT');
    expect(stored.metadata.delivery).toEqual({ status: 'PENDING', checkedAt: expect.any(String) });
    await expect(service.checkStatus(id, tenantA, 'ADMIN')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  // #3345 (D1): the batch's own counters follow the row, in the same statement; no credit refund.
  it('FAILED on a batch row moves one count from successful to failed, once', async () => {
    const batch = await addBatch(tenantA, 2);
    const id = await addSentLog(tenantA, { provider: 'stub-sms' }, batch);
    await addSentLog(tenantA, { provider: 'stub-sms' }, batch);
    getStatus.mockResolvedValue({ status: 'FAILED', code: '1001' });

    await service.checkStatus(id, tenantA, 'ADMIN');
    // A second click is blocked by the wait (409), so the counters cannot move twice.
    await expect(service.checkStatus(id, tenantA, 'ADMIN')).rejects.toBeInstanceOf(
      ConflictException,
    );

    // 1 of 2 failed: the batch is PARTIALLY_FAILED, not the COMPLETED it was.
    expect(await counts(batch)).toEqual({
      successful_count: 1,
      failed_count: 1,
      status: 'PARTIALLY_FAILED',
    });
  });

  // The status = 'SENT' guard, on its own (not the one-minute wait): a concurrent check that
  // already flipped the row and moved the counters while this one waited on the vendor must leave
  // this one with a 409 and the counters where they are.
  it('a check that loses the race to another check changes nothing', async () => {
    const batch = await addBatch(tenantA, 2);
    const id = await addSentLog(tenantA, { provider: 'stub-sms' }, batch);
    await addSentLog(tenantA, { provider: 'stub-sms' }, batch);
    getStatus.mockImplementation(async () => {
      // The other check finishes first: row FAILED, counters 1/1.
      await dataSource.query(`UPDATE communication_logs SET status = 'FAILED' WHERE id = $1`, [id]);
      await dataSource.query(
        `UPDATE reminder_batches SET successful_count = 1, failed_count = 1, status = 'PARTIALLY_FAILED' WHERE id = $1`,
        [batch],
      );
      return { status: 'FAILED', code: '1001' };
    });

    await expect(service.checkStatus(id, tenantA, 'ADMIN')).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(await counts(batch)).toEqual({
      successful_count: 1,
      failed_count: 1,
      status: 'PARTIALLY_FAILED',
    });
  });

  describe('refund of a failed message (#3357)', () => {
    const available = async (tenantId: string) =>
      Number(
        (
          await dataSource.query(`SELECT available FROM sms_credit_balance WHERE tenant_id = $1`, [
            tenantId,
          ])
        )[0]?.available ?? 0,
      );
    const refunds = async (logId: string) =>
      dataSource.query(
        `SELECT kind, units, reference_type, reference_id FROM sms_credit_ledger WHERE idempotency_key = $1`,
        [`log:${logId}:refund`],
      );
    const platformDebited = {
      provider: 'stub-sms',
      source: 'platform',
      credit: 'DEBITED',
      segments: 2,
    };
    const fund = (tenantId: string, units: number) =>
      dataSource.query(
        `INSERT INTO sms_credit_balance (tenant_id, available, reserved, updated_at) VALUES ($1, $2, 0, now())
         ON CONFLICT (tenant_id) DO UPDATE SET available = $2`,
        [tenantId, units],
      );
    beforeEach(() => {
      resolvedSource = 'platform';
    });
    afterEach(() => {
      delete descriptor.refundsFailedSms;
      resolvedSource = 'tenant';
    });

    it('gives the segments back once, in the same step as the flip', async () => {
      descriptor.refundsFailedSms = true;
      await fund(tenantA, 10);
      const id = await addSentLog(tenantA, platformDebited);
      getStatus.mockResolvedValue({ status: 'FAILED', code: '1001' });

      await service.checkStatus(id, tenantA, 'ADMIN');

      expect(await available(tenantA)).toBe(12);
      expect(await refunds(id)).toEqual([
        { kind: 'GRANT', units: 2, reference_type: 'log', reference_id: id },
      ]);
      expect((await row(id)).metadata.credit).toBe('REFUNDED');
      // A second check is refused (the row is FAILED now), so nothing more comes back.
      await expect(service.checkStatus(id, tenantA, 'ADMIN')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(await available(tenantA)).toBe(12);
    });

    it('gives nothing back when the vendor setting is off', async () => {
      await fund(tenantA, 10);
      const id = await addSentLog(tenantA, platformDebited);
      getStatus.mockResolvedValue({ status: 'FAILED', code: '1001' });

      await service.checkStatus(id, tenantA, 'ADMIN');

      expect(await available(tenantA)).toBe(10);
      expect(await refunds(id)).toEqual([]);
      expect((await row(id)).metadata.credit).toBe('DEBITED');
    });

    it('gives nothing back for a school that paid its own company', async () => {
      descriptor.refundsFailedSms = true;
      await fund(tenantA, 10);
      const id = await addSentLog(tenantA, {
        provider: 'stub-sms',
        credit: 'DEBITED',
        segments: 2,
      });
      getStatus.mockResolvedValue({ status: 'FAILED', code: '1001' });

      await service.checkStatus(id, tenantA, 'ADMIN');

      expect(await available(tenantA)).toBe(10);
    });

    it('a check that loses the race to another check refunds nothing', async () => {
      descriptor.refundsFailedSms = true;
      await fund(tenantA, 10);
      const id = await addSentLog(tenantA, platformDebited);
      getStatus.mockImplementation(async () => {
        // The other check finishes first: row FAILED and its refund already paid.
        await dataSource.query(`UPDATE communication_logs SET status = 'FAILED' WHERE id = $1`, [
          id,
        ]);
        await dataSource.query(
          `UPDATE sms_credit_balance SET available = 12 WHERE tenant_id = $1`,
          [tenantA],
        );
        return { status: 'FAILED', code: '1001' };
      });

      await expect(service.checkStatus(id, tenantA, 'ADMIN')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(await available(tenantA)).toBe(12);
      expect(await refunds(id)).toEqual([]);
    });

    it("never touches another school's balance", async () => {
      descriptor.refundsFailedSms = true;
      await fund(tenantA, 10);
      await fund(tenantB, 7);
      const id = await addSentLog(tenantA, platformDebited);
      getStatus.mockResolvedValue({ status: 'FAILED', code: '1001' });

      await service.checkStatus(id, tenantA, 'ADMIN');

      expect(await available(tenantB)).toBe(7);
    });
  });

  it('FAILED on the only recipient of a batch makes the batch FAILED', async () => {
    const batch = await addBatch(tenantA, 1);
    const id = await addSentLog(tenantA, { provider: 'stub-sms' }, batch);
    getStatus.mockResolvedValue({ status: 'FAILED', code: '1001' });

    await service.checkStatus(id, tenantA, 'ADMIN');

    expect(await counts(batch)).toEqual({
      successful_count: 0,
      failed_count: 1,
      status: 'FAILED',
    });
  });

  it('a batch whose counters cannot move (no successful count left) is left alone', async () => {
    const batch = await addBatch(tenantA, 1);
    await dataSource.query(
      `UPDATE reminder_batches SET successful_count = 0, failed_count = 1, status = 'FAILED' WHERE id = $1`,
      [batch],
    );
    const id = await addSentLog(tenantA, { provider: 'stub-sms' }, batch);
    getStatus.mockResolvedValue({ status: 'FAILED', code: '1001' });

    await service.checkStatus(id, tenantA, 'ADMIN');

    expect(await counts(batch)).toEqual({
      successful_count: 0,
      failed_count: 1,
      status: 'FAILED',
    });
  });

  it('DELIVERED or PENDING on a batch row leaves the counters alone', async () => {
    const batch = await addBatch(tenantA, 2);
    const a = await addSentLog(tenantA, { provider: 'stub-sms' }, batch);
    const b = await addSentLog(tenantA, { provider: 'stub-sms' }, batch);
    getStatus.mockResolvedValueOnce({ status: 'DELIVERED' }).mockResolvedValueOnce({
      status: 'PENDING',
    });

    await service.checkStatus(a, tenantA, 'ADMIN');
    await service.checkStatus(b, tenantA, 'ADMIN');

    expect(await counts(batch)).toEqual({
      successful_count: 2,
      failed_count: 0,
      status: 'COMPLETED',
    });
  });

  it('FAILED: a final vendor failure sets status FAILED', async () => {
    const id = await addSentLog(tenantA, { provider: 'stub-sms' });
    getStatus.mockResolvedValue({ status: 'FAILED', code: '1001' });

    const dto = await service.checkStatus(id, tenantA, 'ADMIN');

    expect((await row(id)).status).toBe('FAILED');
    // #3351: Why it failed shows a reason, never the vendor's own code (Rule 23).
    expect(dto.error).toBe('FAILED');
  });

  // Review round 1 on #3347: a failed check also starts the one-minute wait (D23), so a vendor
  // whose status API is down is not asked again on every click.
  it('a provider error is a 502: status stays SENT, the wait starts, a retry inside it is a 409', async () => {
    const id = await addSentLog(tenantA, { provider: 'stub-sms' });
    getStatus.mockRejectedValue(new Error('raw vendor text'));

    await expect(service.checkStatus(id, tenantA, 'ADMIN')).rejects.toBeInstanceOf(
      BadGatewayException,
    );

    expect(await row(id)).toEqual({
      status: 'SENT',
      metadata: { provider: 'stub-sms', delivery: { checkedAt: expect.any(String) } },
    });
    await expect(service.checkStatus(id, tenantA, 'ADMIN')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('a check after the wait runs again and replaces the earlier delivery status', async () => {
    const old = new Date(Date.now() - 120_000).toISOString();
    const id = await addSentLog(tenantA, {
      provider: 'stub-sms',
      delivery: { status: 'PENDING', checkedAt: old },
    });
    getStatus.mockResolvedValue({ status: 'DELIVERED' });

    await service.checkStatus(id, tenantA, 'ADMIN');

    expect((await row(id)).metadata.delivery).toEqual({
      status: 'DELIVERED',
      checkedAt: expect.any(String),
    });
  });

  // Review round 2 on #3347: a failed check after an earlier answer clears that answer, so the row
  // never reads "checked now, still PENDING" when the vendor did not answer.
  it('a provider error after an earlier answer keeps only the new checkedAt', async () => {
    const old = new Date(Date.now() - 120_000).toISOString();
    const id = await addSentLog(tenantA, {
      provider: 'stub-sms',
      delivery: { status: 'PENDING', checkedAt: old },
    });
    getStatus.mockRejectedValue(new Error('raw vendor text'));

    await expect(service.checkStatus(id, tenantA, 'ADMIN')).rejects.toBeInstanceOf(
      BadGatewayException,
    );

    const delivery = (await row(id)).metadata.delivery;
    expect(delivery).toEqual({ checkedAt: expect.any(String) });
    expect(delivery.checkedAt).not.toBe(old);
  });

  it('another school’s log id is a 404 and nothing is written', async () => {
    const foreign = await addSentLog(tenantB, { provider: 'stub-sms' });

    await expect(service.checkStatus(foreign, tenantA, 'ADMIN')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(getStatus).not.toHaveBeenCalled();
    expect(await row(foreign)).toEqual({ status: 'SENT', metadata: { provider: 'stub-sms' } });
  });

  it('MESSAGE_SINK=mailpit: a seeded SENT row with a vendor id is a 409, no vendor call', async () => {
    vi.stubEnv('MESSAGE_SINK', 'mailpit');
    const id = await addSentLog(tenantA, { provider: 'stub-sms' });

    await expect(service.checkStatus(id, tenantA, 'ADMIN')).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(getStatus).not.toHaveBeenCalled();
    expect((await row(id)).metadata).toEqual({ provider: 'stub-sms' });
  });
});
