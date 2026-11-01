import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommunicationMedium } from '@biddaloy/shared';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import {
  ConnectionTestService,
  INVALID_TEST_ADDRESS,
  TEST_SENDS_PER_DAY,
  TEST_SEND_DAILY_CAP,
} from './connection-test.service';
import { ProviderNotConfiguredError } from '../config/provider-not-configured.error';

vi.mock('@sentry/node', () => ({
  withScope: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('ConnectionTestService', () => {
  const tenantId = 'tenant-1';
  let registry: { resolveFor: ReturnType<typeof vi.fn> };
  let provider: { testConnection: ReturnType<typeof vi.fn> };
  let service: ConnectionTestService;
  let logs: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
    manager: { transaction: ReturnType<typeof vi.fn> };
  };
  // #3326: the claim row is written inside the locked transaction, through its own repository.
  let claimRepo: { create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let txQuery: ReturnType<typeof vi.fn>;
  let usedToday: number;
  let credits: {
    reserve: ReturnType<typeof vi.fn>;
    settlePart: ReturnType<typeof vi.fn>;
    releaseForLog: ReturnType<typeof vi.fn>;
    isMetered: ReturnType<typeof vi.fn>;
    getBalance: ReturnType<typeof vi.fn>;
  };
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi
      .fn()
      .mockResolvedValue({ success: true, providerMessageId: 'pm-1', outcome: 'ACCEPTED' });
    provider = {
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
      send: sendSpy,
      descriptor: { medium: CommunicationMedium.SMS, name: 'stub-sms', supportsTestMessage: true },
    } as any;
    registry = { resolveFor: vi.fn().mockResolvedValue({ provider, config: { k: 'v' } }) };
    const createQueryBuilder = vi.fn(() => {
      const qb: any = { where: () => qb, andWhere: () => qb, getCount: async () => usedToday };
      return qb;
    });
    claimRepo = {
      create: vi.fn((x) => x),
      save: vi.fn(async (x) => ({ id: 'log-1', ...x })),
    };
    txQuery = vi.fn().mockResolvedValue(undefined);
    logs = {
      create: vi.fn((x) => x),
      save: vi.fn(async (x) => ({ id: 'log-1', ...x })),
      delete: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder,
      manager: {
        transaction: vi.fn(async (fn: (m: unknown) => unknown) =>
          fn({ query: txQuery, getRepository: () => ({ ...claimRepo, createQueryBuilder }) }),
        ),
      },
    };
    usedToday = 0;
    credits = {
      reserve: vi.fn().mockResolvedValue({ ok: true }),
      settlePart: vi.fn().mockResolvedValue(undefined),
      releaseForLog: vi.fn().mockResolvedValue(undefined),
      // Decided once, before the vendor call; the reservation reuses that answer.
      isMetered: vi.fn().mockResolvedValue(false),
      getBalance: vi.fn().mockResolvedValue({ available: 100, reserved: 0 }),
    };
    const schools = { findOne: vi.fn().mockResolvedValue({ id: tenantId, name: 'Green School' }) };
    service = new ConnectionTestService(
      registry as any,
      logs as any,
      schools as any,
      credits as any,
    );
  });

  it.each([
    CommunicationMedium.SMS,
    CommunicationMedium.WHATSAPP,
    CommunicationMedium.EMAIL,
    CommunicationMedium.MESSENGER,
  ])("resolves this tenant's provider for %s and tests the resolved config", async (medium) => {
    const result = await service.test(tenantId, medium as never);

    // Tenant-scoped: the id the caller passed is the id resolved against.
    // connectionTestOnly: a connection test sends nothing, so send-only fields are not needed.
    expect(registry.resolveFor).toHaveBeenCalledWith(medium, tenantId, {
      override: undefined,
      connectionTestOnly: true,
    });
    expect(provider.testConnection).toHaveBeenCalledWith({ k: 'v' });
    expect(result).toEqual({ success: true, message: 'ok' });
  });

  it('passes an unsaved override through to the resolver', async () => {
    const override = { accessToken: 'draft-token' };

    await service.test(tenantId, CommunicationMedium.WHATSAPP, override);

    expect(registry.resolveFor).toHaveBeenCalledWith(CommunicationMedium.WHATSAPP, tenantId, {
      override,
      connectionTestOnly: true,
    });
  });

  it('returns a failure result instead of throwing when the tenant is unconfigured', async () => {
    registry.resolveFor.mockRejectedValue(
      new ProviderNotConfiguredError('WhatsApp', 'configure it'),
    );

    const result = await service.test(tenantId, CommunicationMedium.WHATSAPP);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/configure it/);
    expect(provider.testConnection).not.toHaveBeenCalled();
  });

  describe('send a test message (97.3.04)', () => {
    const req = { sendTo: '01712345678', userId: 'user-1' };

    it('refuses sendTo for a provider without test-message support, before any outbound call', async () => {
      (provider as any).descriptor.supportsTestMessage = false;
      await expect(
        service.test(tenantId, CommunicationMedium.SMS as never, undefined, req),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(provider.testConnection).not.toHaveBeenCalled();
    });

    it('rejects a malformed number with a sentence that does not echo it', async () => {
      const bad = { sendTo: 'not-a-phone-9999', userId: 'user-1' };
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, bad)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(err.getResponse())).not.toContain('9999');
    });

    it('sends nothing when the connection test fails', async () => {
      provider.testConnection.mockResolvedValue({ success: false, message: 'bad key' });
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(result.testMessage).toBeUndefined();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('sends through the resolved override config and logs one test row', async () => {
      const override = { onecodesoft: { apiKey: 'draft' } };
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, override, req);

      // A test message really sends, so send-only fields (an email `from`) are still required.
      expect(registry.resolveFor).toHaveBeenCalledWith(CommunicationMedium.SMS, tenantId, {
        override,
        connectionTestOnly: false,
      });
      // The config that reaches the provider is the resolved one (override already merged in).
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '01712345678',
          body: expect.stringContaining('Green School'),
        }),
        { k: 'v' },
      );
      expect(logs.save).toHaveBeenCalledTimes(1);
      expect(logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: tenantId,
          recipient_name: 'Test',
          sent_by_user_id: 'user-1',
          trigger: 'MANUAL',
          status: 'SENT',
          // Review round 1 on #3347: the sending company, so Check status and the provider
          // filter work on test sends too (D23).
          metadata: expect.objectContaining({ test: true, provider: 'stub-sms' }),
        }),
      );
      expect(result.testMessage).toEqual({ logId: 'log-1', status: 'SENT' });
    });

    // #3350: a test send records whose account it went out on, as the worker does.
    it('records metadata.source from the resolved config', async () => {
      registry.resolveFor.mockResolvedValue({ provider, config: { k: 'v' }, source: 'platform' });

      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);

      expect(logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ provider: 'stub-sms', source: 'platform' }),
        }),
      );
    });

    it('debits a reserved credit on success and releases it on a rejected send', async () => {
      credits.isMetered.mockResolvedValue(true);
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(credits.settlePart).toHaveBeenLastCalledWith(
        tenantId,
        expect.stringMatching(/^batch:/),
        'log:log-1',
        expect.any(Number),
        'DEBIT',
      );

      sendSpy.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'no',
        outcome: 'REJECTED',
      });
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(credits.settlePart).toHaveBeenLastCalledWith(
        tenantId,
        expect.any(String),
        'log:log-1',
        expect.any(Number),
        'RELEASE',
      );
    });

    it('caps real test sends per tenant per day with a fixed 429 sentence, before any outbound call', async () => {
      usedToday = TEST_SENDS_PER_DAY;
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, req)
        .catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(429);
      expect(JSON.stringify(err.getResponse())).not.toContain('01712345678');
      expect(provider.testConnection).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
      usedToday = TEST_SENDS_PER_DAY - 1;
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('maps a credit/DB error after a passing connection test to its own fixed 500, not "Connection test failed."', async () => {
      credits.isMetered.mockResolvedValue(true);
      credits.reserve.mockRejectedValue(new Error('db down host=secret-db'));
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, req)
        .catch((e) => e);
      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect(JSON.stringify(err.getResponse())).toBe(
        JSON.stringify(
          new InternalServerErrorException('The test message could not be sent.').getResponse(),
        ),
      );
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('releases the reservation when the log save fails after a REJECTED send', async () => {
      credits.isMetered.mockResolvedValue(true);
      sendSpy.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'no',
        outcome: 'REJECTED',
      });
      logs.save.mockRejectedValue(new Error('db'));
      await expect(
        service.test(tenantId, CommunicationMedium.SMS as never, undefined, req),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(credits.releaseForLog).toHaveBeenCalledTimes(1);
      // #3326: nothing went out, so the claim row does not keep a cap slot.
      expect(logs.delete).toHaveBeenCalledWith({ id: 'log-1', tenant_id: tenantId });
    });

    // #3326: an error here would free the Idempotency-Key and the retry would send again, so an
    // AMBIGUOUS send that cannot be recorded answers its outcome with the claim row's id.
    it('alerts ops (Sentry, ids only) and keeps the reservation when an AMBIGUOUS send cannot be logged', async () => {
      credits.isMetered.mockResolvedValue(true);
      sendSpy.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'x',
        outcome: 'AMBIGUOUS',
      });
      logs.save.mockRejectedValue(new Error('db'));
      const tags = vi.fn();
      vi.mocked(Sentry.withScope).mockImplementation(((cb: any) => cb({ setTags: tags })) as never);
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(result.testMessage).toEqual({ logId: 'log-1', status: 'FAILED' });
      expect(credits.releaseForLog).not.toHaveBeenCalled();
      expect(tags).toHaveBeenCalledWith(
        expect.objectContaining({ needs_reconciliation: 'true', tenant_id: tenantId }),
      );
      expect(JSON.stringify(tags.mock.calls)).not.toContain('01712345678');
    });

    it('leaves an ambiguous send unsettled and fails 409 when credit is short', async () => {
      credits.isMetered.mockResolvedValue(true);
      sendSpy.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'x',
        outcome: 'AMBIGUOUS',
      });
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(credits.settlePart).not.toHaveBeenCalled();

      credits.reserve.mockResolvedValue({ ok: false, available: 0 });
      await expect(
        service.test(tenantId, CommunicationMedium.SMS as never, undefined, req),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('review round 1 (PR #3325)', () => {
    const req = { sendTo: '01712345678', userId: 'user-1' };

    // Finding 3: the server half of the FAILED outcome the form must show as a failure.
    it('returns testMessage.status FAILED (top-level success stays true) when the gateway rejects', async () => {
      sendSpy.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'no',
        outcome: 'REJECTED',
      });
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(result.success).toBe(true);
      expect(result.testMessage).toEqual({ logId: 'log-1', status: 'FAILED' });
    });

    // Finding 9: a metered school with too little credit gets its 409 before the vendor is called.
    it('checks metered credit before the connection test: 409 and no outbound call', async () => {
      credits.isMetered.mockResolvedValue(true);
      credits.getBalance.mockResolvedValue({ available: 0, reserved: 0 });
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, req)
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().details.code).toBe('INSUFFICIENT_SMS_CREDIT');
      expect(provider.testConnection).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    // Finding 1: an unsaved key of the school's own goes through its own gateway; no platform debit.
    it('never reserves platform credit when the config came from the override (own gateway)', async () => {
      registry.resolveFor.mockResolvedValue({ provider, config: { k: 'v' }, source: 'override' });
      credits.isMetered.mockResolvedValue(true);
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, {}, req);
      expect(result.testMessage?.status).toBe('SENT');
      expect(credits.isMetered).not.toHaveBeenCalled();
      expect(credits.reserve).not.toHaveBeenCalled();
    });

    it('reserves platform credit when the send uses the platform account', async () => {
      registry.resolveFor.mockResolvedValue({ provider, config: { k: 'v' }, source: 'platform' });
      credits.isMetered.mockResolvedValue(true);
      credits.getBalance.mockResolvedValue({ available: 10, reserved: 0 });
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      // Round 2, finding 9: metering is read once (the pre-check), and the reservation key is the
      // batch key settlePart later settles against.
      expect(credits.isMetered).toHaveBeenCalledTimes(1);
      expect(credits.reserve).toHaveBeenCalledTimes(1);
      const [, units, key, ref] = credits.reserve.mock.calls[0];
      expect(key).toBe(`batch:${ref.id}`);
      expect(ref.type).toBe('batch');
      expect(credits.settlePart).toHaveBeenCalledWith(tenantId, key, 'log:log-1', units, 'DEBIT');
    });

    // Finding 8: the daily cap carries its own code, so the UI does not mistake the 3/min throttle for it.
    it('the daily-cap 429 carries details.code TEST_SEND_DAILY_CAP', async () => {
      usedToday = TEST_SENDS_PER_DAY;
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, req)
        .catch((e) => e);
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toEqual({
        // The count is a rolling 24 hours, not a calendar day (review round 3, nit 9).
        message: 'Too many test messages in the last 24 hours. Try again later.',
        details: { code: TEST_SEND_DAILY_CAP },
      });
    });

    // Finding 4: class-validator's isEmail, not a hand-written (ReDoS-prone) pattern.
    it.each(['a@b', 'not an email', 'x@@y.com'])('rejects the email address %s', async (sendTo) => {
      (provider as any).descriptor = {
        medium: CommunicationMedium.EMAIL,
        supportsTestMessage: true,
      };
      await expect(
        service.test(tenantId, CommunicationMedium.EMAIL as never, undefined, {
          sendTo,
          userId: 'u',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a valid email address', async () => {
      const result = await service.test(tenantId, CommunicationMedium.EMAIL as never, undefined, {
        sendTo: 'head@school.example.com',
        userId: 'u',
      });
      expect(result.testMessage?.status).toBe('SENT');
    });
  });

  describe('review round 2 (PR #3325)', () => {
    const req = { sendTo: '01712345678', userId: 'user-1' };

    // Finding 6: the cap count is a DB step on the send path, so its failure is the send's own 500.
    it('maps a DB error in the daily-cap count to the fixed send 500, not "Connection test failed."', async () => {
      logs.createQueryBuilder.mockImplementation(() => {
        const qb: any = {
          where: () => qb,
          andWhere: () => qb,
          getCount: async () => {
            throw new Error('db down host=secret-db');
          },
        };
        return qb;
      });
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, req)
        .catch((e) => e);
      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect(err.message).toBe('The test message could not be sent.');
      expect(provider.testConnection).not.toHaveBeenCalled();
    });

    // Finding 7: an AMBIGUOUS send keeps its reservation, and says so on the row and to ops.
    it('marks an AMBIGUOUS metered send UNSETTLED with its batch id and alerts ops (ids only)', async () => {
      credits.isMetered.mockResolvedValue(true);
      sendSpy.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'x',
        outcome: 'AMBIGUOUS',
      });
      const tags = vi.fn();
      vi.mocked(Sentry.withScope).mockImplementation(((cb: any) => cb({ setTags: tags })) as never);
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);

      const batchId = credits.reserve.mock.calls[0][3].id;
      expect(logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          metadata: expect.objectContaining({ credit: 'UNSETTLED', batch_id: batchId }),
        }),
      );
      expect(credits.settlePart).not.toHaveBeenCalled();
      expect(tags).toHaveBeenCalledWith(
        expect.objectContaining({
          communication_log_id: 'log-1',
          batch_id: batchId,
          needs_reconciliation: 'true',
        }),
      );
      expect(Sentry.captureMessage).toHaveBeenCalled();
      expect(JSON.stringify(tags.mock.calls)).not.toContain('01712345678');
      expect(result.testMessage?.status).toBe('FAILED');
    });

    it('a settled (non-ambiguous) metered send carries no UNSETTLED flag on create', async () => {
      credits.isMetered.mockResolvedValue(true);
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(logs.create.mock.calls[0][0].metadata.credit).toBeUndefined();
    });
  });

  describe('review round 3 (PR #3325)', () => {
    const req = { sendTo: '01712345678', userId: 'user-1' };

    // Finding 3: a failed settlement strands the reservation, like AMBIGUOUS: same ops signal.
    it('flags a failed credit settlement for reconciliation (ids only) and still returns the send', async () => {
      credits.isMetered.mockResolvedValue(true);
      credits.settlePart.mockRejectedValue(new Error('ledger down'));
      const tags = vi.fn();
      vi.mocked(Sentry.withScope).mockImplementation(((cb: any) => cb({ setTags: tags })) as never);
      const error = vi.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      const result = await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);

      const batchId = credits.reserve.mock.calls[0][3].id;
      expect(tags).toHaveBeenCalledWith(
        expect.objectContaining({
          communication_log_id: 'log-1',
          batch_id: batchId,
          needs_reconciliation: 'true',
        }),
      );
      expect(Sentry.captureException).toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ batch_id: batchId, needs_reconciliation: 'true' }),
      );
      expect(logs.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ credit: 'UNSETTLED' }) }),
      );
      expect(JSON.stringify([tags.mock.calls, error.mock.calls])).not.toContain('01712345678');
      expect(result.testMessage?.status).toBe('SENT');
    });

    it('logs a lost credit-marker write (ids only) instead of swallowing it', async () => {
      credits.isMetered.mockResolvedValue(true);
      logs.save
        .mockImplementationOnce(async (x: any) => ({ id: 'log-1', ...x }))
        .mockRejectedValueOnce(new Error('db down'));
      const error = vi.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      const result = await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ communication_log_id: 'log-1', credit: 'DEBITED' }),
      );
      expect(result.testMessage?.status).toBe('SENT');
    });

    // Nit 7: the UI shows "not a valid number" only for this 400, not for a DTO 400.
    it('the bad-address 400 carries details.code INVALID_TEST_ADDRESS', async () => {
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, { ...req, sendTo: '123' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual({
        message: 'Enter a valid number or address for this channel.',
        details: { code: INVALID_TEST_ADDRESS },
      });
    });
  });

  // #3326: the cap is checked again, under a per-tenant lock, while the claim row is inserted.
  // The real concurrency proof (two requests, a latch) is in provider-connection-test.e2e-spec.ts.
  describe('daily-cap claim and a send that cannot be recorded (#3326)', () => {
    const req = { sendTo: '01712345678', userId: 'user-1' };

    it('claims a QUEUED test row inside a per-tenant advisory lock, before the send', async () => {
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(txQuery).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `test-send:${tenantId}`,
      ]);
      expect(claimRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: tenantId,
          status: 'QUEUED',
          metadata: expect.objectContaining({ test: true }),
        }),
      );
      // The final write updates the claim (same id), it does not add a second row.
      expect(logs.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'log-1', status: 'SENT' }),
      );
      expect(claimRepo.save.mock.invocationCallOrder[0]).toBeLessThan(
        sendSpy.mock.invocationCallOrder[0],
      );
    });

    it('a request that passed the early count but finds the cap full under the lock gets the 429 and sends nothing', async () => {
      let counts = 0;
      usedToday = TEST_SENDS_PER_DAY - 1;
      logs.createQueryBuilder.mockImplementation(() => {
        const qb: any = {
          where: () => qb,
          andWhere: () => qb,
          // Early check sees 19; the locked check sees the other request's claim (20).
          getCount: async () => (++counts === 1 ? usedToday : TEST_SENDS_PER_DAY),
        };
        return qb;
      });
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, req)
        .catch((e) => e);
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse().details).toEqual({ code: TEST_SEND_DAILY_CAP });
      expect(claimRepo.save).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('a sent message whose row cannot be recorded answers its outcome (no 500) and alerts ops', async () => {
      logs.save.mockRejectedValue(new Error('db down'));
      const tags = vi.fn();
      vi.mocked(Sentry.withScope).mockImplementation(((cb: any) => cb({ setTags: tags })) as never);
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      // A 200 is stored by the Idempotency interceptor: the same-key retry replays, never resends.
      expect(result.testMessage).toEqual({ logId: 'log-1', status: 'SENT' });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(tags).toHaveBeenCalledWith(
        expect.objectContaining({ communication_log_id: 'log-1', needs_reconciliation: 'true' }),
      );
      expect(JSON.stringify(tags.mock.calls)).not.toContain('01712345678');
    });

    it('drops the claim when credit is short (nothing sent, the cap is not used up)', async () => {
      credits.isMetered.mockResolvedValue(true);
      credits.reserve.mockResolvedValue({ ok: false, available: 0 });
      await expect(
        service.test(tenantId, CommunicationMedium.SMS as never, undefined, req),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(logs.delete).toHaveBeenCalledWith({ id: 'log-1', tenant_id: tenantId });
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('drops the claim when the reservation itself fails', async () => {
      credits.isMetered.mockResolvedValue(true);
      credits.reserve.mockRejectedValue(new Error('ledger down'));
      await expect(
        service.test(tenantId, CommunicationMedium.SMS as never, undefined, req),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(logs.delete).toHaveBeenCalledWith({ id: 'log-1', tenant_id: tenantId });
    });

    it('carries the batch id on the claim row so a stranded row links to its reservation', async () => {
      credits.isMetered.mockResolvedValue(true);
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      const batchId = credits.reserve.mock.calls[0][3].id;
      expect(claimRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { test: true, batch_id: batchId } }),
      );
    });
  });

  it('maps an unexpected throw to fixed text that never echoes its message', async () => {
    registry.resolveFor.mockRejectedValue(new Error('connect ECONNREFUSED key=sk-secret'));
    const result = await service.test(tenantId, CommunicationMedium.SMS as never);
    expect(result).toEqual({ success: false, message: 'Connection test failed.' });
  });

  describe('test inbox (Epic 87, D24)', () => {
    afterEach(() => {
      delete process.env.MESSAGE_SINK;
    });

    it('says no real message was sent when sendTo is given on a sink stack, and sends nothing', async () => {
      process.env.MESSAGE_SINK = 'mailpit';
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, undefined, {
        sendTo: '01712345678',
        userId: 'user-1',
      });
      expect(result).toEqual({
        success: true,
        message: 'Test site: messages go to the test inbox. No real message was sent.',
      });
      expect(sendSpy).not.toHaveBeenCalled();
      expect(logs.save).not.toHaveBeenCalled();
    });

    it.each([
      CommunicationMedium.WHATSAPP,
      CommunicationMedium.EMAIL,
      CommunicationMedium.MESSENGER,
      CommunicationMedium.SMS,
    ])('returns the fixed success text for %s without resolving any config', async (medium) => {
      process.env.MESSAGE_SINK = 'mailpit';

      const result = await service.test(tenantId, medium as never, { accessToken: 'x' });

      expect(result).toEqual({
        success: true,
        message: 'Test site: messages go to the test inbox',
      });
      expect(registry.resolveFor).not.toHaveBeenCalled();
    });
  });
});
