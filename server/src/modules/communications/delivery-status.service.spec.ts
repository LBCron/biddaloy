import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadGatewayException, ConflictException, NotFoundException } from '@nestjs/common';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import {
  CANNOT_CHECK_STATUS,
  DeliveryStatusService,
  STATUS_CHECK_FAILED,
} from './delivery-status.service';
import { ProviderNotConfiguredError } from './config/provider-not-configured.error';

/**
 * [97.4.01] D23: `POST /communications/logs/:id/check-status`. The vendor call itself is covered by
 * each provider's own spec (fetchPinnedJson mocked, e.g. onecodesoft.provider.spec.ts); here the
 * provider is a fake, so every branch of the service is driven without any network.
 */
describe('DeliveryStatusService', () => {
  const TENANT = 'tenant-1';
  const NOW = new Date('2026-10-31T06:00:00.000Z');

  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let reread: Record<string, ReturnType<typeof vi.fn>>;
  let registry: { resolveFor: ReturnType<typeof vi.fn> };
  let provider: { descriptor: any; getStatus?: ReturnType<typeof vi.fn> };
  let credits: { refundForLog: ReturnType<typeof vi.fn> };
  let service: DeliveryStatusService;

  const sentLog = (overrides: Record<string, unknown> = {}) => ({
    id: 'log-1',
    tenant_id: TENANT,
    medium: CommunicationMedium.SMS,
    recipient_address: '01712345678',
    recipient_name: 'Karim',
    status: CommunicationStatus.SENT,
    trigger: CommunicationTrigger.MANUAL,
    student_id: null,
    guardian_id: null,
    provider_message_id: 'vendor-42',
    metadata: { provider: 'stub-sms', segments: 1 },
    message_body: 'Paid. Receipt: https://app.example/i/RawShareToken_123',
    created_at: NOW,
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    provider = {
      descriptor: { medium: CommunicationMedium.SMS, name: 'stub-sms', capabilities: ['status'] },
      getStatus: vi.fn(async () => ({ status: 'DELIVERED' as const, code: '000' })),
    };
    registry = {
      resolveFor: vi.fn(async () => ({ provider, config: { apiKey: 'k' }, source: 'tenant' })),
    };
    repo = {
      findOne: vi.fn(async () => sentLog()),
      // UPDATE ... : TypeORM's postgres driver answers [rows, affectedCount].
      query: vi.fn(async (sql: string) => (sql.includes('WITH upd') ? [{ n: 1 }] : [[], 1])),
    };
    // The re-read after the write: the row with the sender's name only (logsWithSender).
    reread = {
      leftJoin: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOneOrFail: vi.fn(async () => sentLog({ status: CommunicationStatus.DELIVERED })),
    };
    repo.createQueryBuilder = vi.fn(() => reread);
    // The flip runs in a transaction; the unit spec's manager just forwards to the same query mock.
    repo.manager = {
      transaction: vi.fn(async (fn: (m: unknown) => unknown) =>
        fn({ query: (...args: unknown[]) => repo.query(...args) }),
      ),
    } as any;
    credits = { refundForLog: vi.fn(async () => undefined) };
    service = new DeliveryStatusService(repo as any, registry as any, credits as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('loads the log by id AND tenant, so another school’s id is a 404', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.checkStatus('log-1', TENANT, 'ADMIN')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'log-1', tenant_id: TENANT } });
    expect(registry.resolveFor).not.toHaveBeenCalled();
  });

  it('DELIVERED: writes metadata.delivery and sets status DELIVERED, returning the updated row', async () => {
    const result = await service.checkStatus('log-1', TENANT, 'ADMIN');

    // The sending company is chosen by name (metadata.provider) with the tenant's current config.
    expect(registry.resolveFor).toHaveBeenCalledWith(CommunicationMedium.SMS, TENANT, {
      override: { provider: 'stub-sms' },
    });
    expect(provider.getStatus).toHaveBeenCalledWith('vendor-42', { apiKey: 'k' });
    // calls[0] is the claim (checkedAt before the vendor call), calls[1] the result.
    const [sql, params] = repo.query.mock.calls[1];
    // Parameterized, tenant-scoped, and only while the row is still SENT (Rule 4).
    expect(sql).toMatch(/WHERE id = \$3 AND tenant_id = \$4 AND status = 'SENT'/);
    expect(JSON.parse(params[0])).toEqual({
      status: 'DELIVERED',
      code: '000',
      checkedAt: NOW.toISOString(),
    });
    // The last param is "did this flip to FAILED": false, so the batch counters stay.
    // Then: "did this flip to FAILED" and "does it refund", both false for DELIVERED.
    expect(params.slice(1)).toEqual([CommunicationStatus.DELIVERED, 'log-1', TENANT, false, false]);
    expect(result).toMatchObject({ id: 'log-1', status: CommunicationStatus.DELIVERED });
    // Re-read in this tenant, with the sender's name only; the answer masks the share link.
    expect(reread.where).toHaveBeenCalledWith('log.id = :id AND log.tenant_id = :tenantId', {
      id: 'log-1',
      tenantId: TENANT,
    });
    expect(reread.addSelect).toHaveBeenCalledWith(['sender.id', 'sender.full_name']);
    expect(result.message_body).toBe('Paid. Receipt: https://app.example/i/••••••');
  });

  // #3350: a message sent on the platform's keys is checked on the platform's account, never on
  // a draft the school saved for that company (the send ignored that draft).
  it('a row sent on the platform account resolves that company on the platform account', async () => {
    repo.findOne.mockResolvedValue(
      sentLog({ metadata: { provider: 'stub-sms', source: 'platform', segments: 1 } }),
    );
    registry.resolveFor.mockResolvedValue({
      provider,
      config: { apiKey: 'p' },
      source: 'platform',
    });

    await service.checkStatus('log-1', TENANT, 'ADMIN');

    expect(registry.resolveFor).toHaveBeenCalledWith(CommunicationMedium.SMS, TENANT, {
      platformProvider: 'stub-sms',
    });
  });

  it("a row sent on the school's own account keeps the school's stored config", async () => {
    repo.findOne.mockResolvedValue(
      sentLog({ metadata: { provider: 'stub-sms', source: 'tenant', segments: 1 } }),
    );

    await service.checkStatus('log-1', TENANT, 'ADMIN');

    expect(registry.resolveFor).toHaveBeenCalledWith(CommunicationMedium.SMS, TENANT, {
      override: { provider: 'stub-sms' },
    });
  });

  it('FAILED: a final failure sets status FAILED', async () => {
    provider.getStatus!.mockResolvedValue({ status: 'FAILED', code: '1001' });

    await service.checkStatus('log-1', TENANT, 'ADMIN');

    expect(repo.query.mock.calls[1][1][1]).toBe(CommunicationStatus.FAILED);
  });

  // #3357: the refund is a per-vendor setting on the descriptor, off unless a vendor sets it.
  describe('refund of a failed message (#3357)', () => {
    const platformDebited = {
      provider: 'stub-sms',
      source: 'platform',
      credit: 'DEBITED',
      segments: 2,
    };
    const failed = () => provider.getStatus!.mockResolvedValue({ status: 'FAILED', code: '1001' });
    const checkWith = async (metadata: Record<string, unknown>, flag?: boolean) => {
      provider.descriptor.refundsFailedSms = flag;
      // The account that answers is the one the row was sent on (the service refuses a mismatch).
      registry.resolveFor.mockResolvedValue({
        provider,
        config: { apiKey: 'k' },
        source: metadata.source === 'platform' ? 'platform' : 'tenant',
      });
      repo.findOne = vi.fn(async () => sentLog({ metadata }));
      await service.checkStatus('log-1', TENANT, 'ADMIN');
    };

    it('gives the segments back when the vendor does not bill failed SMS', async () => {
      failed();
      await checkWith(platformDebited, true);
      expect(credits.refundForLog).toHaveBeenCalledWith(expect.anything(), TENANT, 'log-1', 2);
      // The row records it, in the same statement as the flip.
      expect(repo.query.mock.calls[1][1][5]).toBe(true);
    });

    it.each([
      ['the vendor setting is off', platformDebited, undefined],
      ['the vendor setting is false', platformDebited, false],
      ['the school paid its own company', { ...platformDebited, source: 'tenant' }, true],
      [
        'no source was recorded (an older row)',
        { provider: 'stub-sms', credit: 'DEBITED', segments: 2 },
        true,
      ],
      ['the credit was never spent', { ...platformDebited, credit: 'RELEASED' }, true],
      ['the segment count is unknown', { ...platformDebited, segments: undefined }, true],
    ])('gives nothing back when %s', async (_why, metadata, flag) => {
      failed();
      await checkWith(metadata as Record<string, unknown>, flag);
      expect(credits.refundForLog).not.toHaveBeenCalled();
      expect(repo.query.mock.calls[1][1][5]).toBe(false);
    });

    it('gives nothing back for a message the vendor delivered', async () => {
      await checkWith(platformDebited, true); // getStatus answers DELIVERED by default
      expect(credits.refundForLog).not.toHaveBeenCalled();
    });

    it('gives nothing back when the row was no longer SENT (a lost race)', async () => {
      failed();
      repo.query.mockResolvedValueOnce([[], 1]).mockResolvedValueOnce([{ n: 0 }]);
      provider.descriptor.refundsFailedSms = true;
      registry.resolveFor.mockResolvedValue({
        provider,
        config: { apiKey: 'k' },
        source: 'platform',
      });
      repo.findOne = vi.fn(async () => sentLog({ metadata: platformDebited }));
      await expect(service.checkStatus('log-1', TENANT, 'ADMIN')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(credits.refundForLog).not.toHaveBeenCalled();
    });
  });

  it('PENDING: status stays SENT but checkedAt is written (starts the one-minute wait)', async () => {
    provider.getStatus!.mockResolvedValue({ status: 'PENDING' });

    await service.checkStatus('log-1', TENANT, 'ADMIN');

    const params = repo.query.mock.calls[1][1];
    expect(JSON.parse(params[0])).toEqual({ status: 'PENDING', checkedAt: NOW.toISOString() });
    expect(params[1]).toBe(CommunicationStatus.SENT);
  });

  it('a provider error is a 502 with a fixed sentence, never the vendor text; status is unchanged', async () => {
    provider.getStatus!.mockRejectedValue(new Error('vendor said: key abc123 at https://x'));

    const err = await service.checkStatus('log-1', TENANT, 'ADMIN').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as BadGatewayException).message).toBe(STATUS_CHECK_FAILED);
    // Only the claim ran: no status write.
    expect(repo.query).toHaveBeenCalledTimes(1);
  });

  // Review round 1 on #3347: the one-minute wait (D23) starts before the vendor call, so a failing
  // vendor is not asked again on every click with a new Idempotency-Key.
  it('claims checkedAt before the vendor call, tenant-scoped and only when outside the wait', async () => {
    provider.getStatus!.mockImplementation(async () => {
      expect(repo.query).toHaveBeenCalledTimes(1);
      return { status: 'PENDING' as const };
    });

    await service.checkStatus('log-1', TENANT, 'ADMIN');

    const [sql, params] = repo.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$2 AND tenant_id = \$3 AND status = 'SENT'/);
    expect(sql).toMatch(/checkedAt/);
    expect(params).toEqual([
      NOW.toISOString(),
      'log-1',
      TENANT,
      new Date(NOW.getTime() - 60_000).toISOString(),
    ]);
  });

  describe('409 with the same fixed sentence (Rule 23), no vendor call', () => {
    async function expectCannotCheck() {
      const err = await service.checkStatus('log-1', TENANT, 'ADMIN').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(CANNOT_CHECK_STATUS);
      expect(provider.getStatus).not.toHaveBeenCalled();
      expect(repo.query).not.toHaveBeenCalled();
    }

    it('when the status is not SENT (already DELIVERED)', async () => {
      repo.findOne.mockResolvedValue(sentLog({ status: CommunicationStatus.DELIVERED }));
      await expectCannotCheck();
    });

    it('when the status is QUEUED', async () => {
      repo.findOne.mockResolvedValue(sentLog({ status: CommunicationStatus.QUEUED }));
      await expectCannotCheck();
    });

    it('when provider_message_id is null', async () => {
      repo.findOne.mockResolvedValue(sentLog({ provider_message_id: null }));
      await expectCannotCheck();
    });

    it('when the log has no metadata.provider (sent before Epic 97)', async () => {
      repo.findOne.mockResolvedValue(sentLog({ metadata: { segments: 1 } }));
      await expectCannotCheck();
    });

    it('when the last check was under 60 s ago', async () => {
      const checkedAt = new Date(NOW.getTime() - 30_000).toISOString();
      repo.findOne.mockResolvedValue(
        sentLog({ metadata: { provider: 'stub-sms', delivery: { status: 'PENDING', checkedAt } } }),
      );
      await expectCannotCheck();
    });

    it('when the provider lacks the status capability', async () => {
      provider.descriptor.capabilities = ['balance'];
      await expectCannotCheck();
    });

    it('when the named provider is unknown (the resolver throws "not configured")', async () => {
      registry.resolveFor.mockRejectedValue(new ProviderNotConfiguredError('SMS', 'unknown'));
      await expectCannotCheck();
    });

    it('when the resolver hands back a different provider than the one that sent it', async () => {
      // A single-provider medium ignores the override name; the sender must still match.
      repo.findOne.mockResolvedValue(sentLog({ metadata: { provider: 'retired-vendor' } }));
      await expectCannotCheck();
    });

    // Review round 2 on #3347: the account that would be asked must be the one that sent it.
    it("when a row sent on the school's own account would be asked on the platform account", async () => {
      repo.findOne.mockResolvedValue(
        sentLog({ metadata: { provider: 'stub-sms', source: 'tenant', segments: 1 } }),
      );
      registry.resolveFor.mockResolvedValue({
        provider,
        config: { apiKey: 'p' },
        source: 'platform',
      });
      await expectCannotCheck();
    });

    it('when a test send typed in the form (override) would be asked on the platform account', async () => {
      repo.findOne.mockResolvedValue(
        sentLog({ metadata: { provider: 'stub-sms', source: 'override', segments: 1 } }),
      );
      registry.resolveFor.mockResolvedValue({
        provider,
        config: { apiKey: 'p' },
        source: 'platform',
      });
      await expectCannotCheck();
    });

    it("when a row sent on the platform account resolves to the school's own account", async () => {
      repo.findOne.mockResolvedValue(
        sentLog({ metadata: { provider: 'stub-sms', source: 'platform', segments: 1 } }),
      );
      await expectCannotCheck();
    });

    it('in MESSAGE_SINK=mailpit mode (nothing really went to a vendor)', async () => {
      vi.stubEnv('MESSAGE_SINK', 'mailpit');
      await expectCannotCheck();
      expect(registry.resolveFor).not.toHaveBeenCalled();
    });

    it('when another check claimed the row first (lost race): no vendor call', async () => {
      repo.query.mockResolvedValue([[], 0]);
      const err = await service.checkStatus('log-1', TENANT, 'ADMIN').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(CANNOT_CHECK_STATUS);
      expect(provider.getStatus).not.toHaveBeenCalled();
    });

    it('when the row changed while the vendor answered', async () => {
      repo.query.mockResolvedValueOnce([[], 1]).mockResolvedValueOnce([{ n: 0 }]);
      const err = await service.checkStatus('log-1', TENANT, 'ADMIN').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(CANNOT_CHECK_STATUS);
    });
  });

  // A test send with typed details records `override`; once saved, the school's own account answers.
  it("a test-send row (override) is checked on the school's own account", async () => {
    repo.findOne.mockResolvedValue(
      sentLog({ metadata: { provider: 'stub-sms', source: 'override', segments: 1 } }),
    );
    await service.checkStatus('log-1', TENANT);
    expect(provider.getStatus).toHaveBeenCalledWith('vendor-42', { apiKey: 'k' });
  });

  it('a row with no source (older) keeps the old path, whatever account resolves', async () => {
    registry.resolveFor.mockResolvedValue({
      provider,
      config: { apiKey: 'p' },
      source: 'platform',
    });
    await service.checkStatus('log-1', TENANT);
    expect(provider.getStatus).toHaveBeenCalledWith('vendor-42', { apiKey: 'p' });
  });

  it('a check older than 60 s may run again', async () => {
    const checkedAt = new Date(NOW.getTime() - 90_000).toISOString();
    repo.findOne.mockResolvedValue(
      sentLog({ metadata: { provider: 'stub-sms', delivery: { status: 'PENDING', checkedAt } } }),
    );

    await service.checkStatus('log-1', TENANT, 'ADMIN');

    expect(provider.getStatus).toHaveBeenCalledTimes(1);
  });
});
