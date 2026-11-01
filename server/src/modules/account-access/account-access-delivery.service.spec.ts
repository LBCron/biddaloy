import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';
import { AccountAccessDeliveryService, pickChannel } from './account-access-delivery.service';

function fakeLogRepo() {
  let saved: any = null;
  return {
    create: vi.fn((data: any) => ({ id: 'log-1', ...data })),
    save: vi.fn(async (row: any) => {
      saved = { ...saved, ...row };
      return saved;
    }),
    get saved() {
      return saved;
    },
  };
}

describe('AccountAccessDeliveryService', () => {
  let logRepo: ReturnType<typeof fakeLogRepo>;
  let registry: { resolve: ReturnType<typeof vi.fn> };
  let schoolsService: {
    getResolvedSettings: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let service: AccountAccessDeliveryService;

  beforeEach(() => {
    logRepo = fakeLogRepo();
    registry = { resolve: vi.fn() };
    schoolsService = {
      getResolvedSettings: vi.fn().mockResolvedValue({ region: { locale: 'en-US' } }),
      findById: vi.fn().mockResolvedValue({ id: 'tenant-1', name: 'Green Valley School' }),
    };
    service = new AccountAccessDeliveryService(
      logRepo as any,
      registry as any,
      schoolsService as any,
      { get: () => undefined } as any,
    );
  });

  describe('detach', () => {
    /** Echo flag on = test mode (awaits); off = production (setImmediate). */
    const make = (echo: boolean) => {
      const svc = new AccountAccessDeliveryService(
        logRepo as any,
        registry as any,
        schoolsService as any,
        {
          get: (k: string) => (echo && k === 'ACCOUNT_ACCESS_ECHO_SECRETS' ? 'true' : undefined),
        } as any,
      );
      const log = (svc as any).logger;
      return {
        svc,
        error: vi.spyOn(log, 'error').mockImplementation(() => undefined),
        warn: vi.spyOn(log, 'warn').mockImplementation(() => undefined),
      };
    };
    const tick = () => new Promise((r) => setImmediate(r));

    it('returns undefined before the work finishes when echo is off', async () => {
      await expect(make(false).svc.detach('t', () => new Promise(() => {}))).resolves.toBe(
        undefined,
      );
    });

    it('does not await under NODE_ENV=test alone (vitest sets it); only the echo flag does', async () => {
      expect(process.env.NODE_ENV).toBe('test');
      let ran = false;
      await make(false).svc.detach('t', async () => {
        ran = true;
      });
      expect(ran).toBe(false);
      await tick();
      expect(ran).toBe(true);
    });

    it("awaits the work and returns the job's value when echo is on", async () => {
      await expect(
        make(true).svc.detach('t', async () => {
          await Promise.resolve();
          return 42;
        }),
      ).resolves.toBe(42);
    });

    it('logs a rejected job with its flow and stack instead of throwing, in both modes', async () => {
      for (const echo of [true, false]) {
        const { svc, error } = make(echo);
        await expect(
          svc.detach('otp-login', () => Promise.reject(new Error('boom'))),
        ).resolves.toBeUndefined();
        await tick();
        await tick();
        expect(error).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0][0]).toContain('otp-login');
        expect(error.mock.calls[0][1]).toContain('Error: boom');
      }
    });

    it('catches a synchronous throw inside work, so nothing escapes setImmediate', async () => {
      const { svc, error } = make(false);
      const work = (() => {
        throw new Error('sync');
      }) as unknown as () => Promise<void>;
      await svc.detach('t', work);
      await tick();
      await tick();
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('logs the activation-race ConflictException at warn, not error', async () => {
      const { svc, error, warn } = make(true);
      await svc.detach('activation-resend', () => Promise.reject(new ConflictException('race')));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
    });
  });

  it('stores a redacted message_body, never the raw link', async () => {
    const provider = {
      send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p1' }),
    };
    registry.resolve.mockReturnValue(provider);

    await service.deliver({
      tenantId: 'tenant-1',
      medium: CommunicationMedium.EMAIL,
      to: 'user@example.com',
      recipientName: 'Jane Doe',
      kind: 'INVITATION',
      vars: { link: 'https://app.example.com/activate?token=super-secret-raw-token' },
    });

    expect(logRepo.saved.message_body).toContain('••••••');
    expect(logRepo.saved.message_body).not.toContain('super-secret-raw-token');

    // The real, secret-bearing body only ever reaches the provider.
    const [sendParams] = provider.send.mock.calls[0];
    expect(sendParams.body).toContain('super-secret-raw-token');
    expect(sendParams.allowPlatformSms).toBe(true);
  });

  it('marks the log SENT on a successful provider call', async () => {
    const provider = {
      send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p1', provider: 'smtp' }),
    };
    registry.resolve.mockReturnValue(provider);

    const result = await service.deliver({
      tenantId: 'tenant-1',
      medium: CommunicationMedium.EMAIL,
      to: 'user@example.com',
      recipientName: 'Jane Doe',
      kind: 'INVITATION',
      vars: { link: 'https://app.example.com/activate?token=abc' },
    });

    expect(result.status).toBe(CommunicationStatus.SENT);
    expect(logRepo.saved.status).toBe(CommunicationStatus.SENT);
    // #3344: Check status needs the vendor name; nothing else secret rides along.
    expect(logRepo.saved.metadata).toEqual({ kind: 'INVITATION', provider: 'smtp' });
  });

  it('marks the log FAILED when the provider reports failure, without persisting the raw provider error text', async () => {
    // A gateway can echo the request body — including this message's
    // secret-bearing link/OTP — back in its error text, so the stored
    // reason must be a fixed string, never `result.error` verbatim.
    const provider = {
      send: vi.fn().mockResolvedValue({
        success: false,
        error: 'boom: link was https://x/activate?token=SECRET',
        provider: 'onecodesoft',
        source: 'platform',
      }),
    };
    registry.resolve.mockReturnValue(provider);

    const result = await service.deliver({
      tenantId: 'tenant-1',
      medium: CommunicationMedium.SMS,
      to: '+8801700000000',
      recipientName: 'Jane Doe',
      kind: 'OTP',
      vars: { code: '123456' },
    });

    expect(result.status).toBe(CommunicationStatus.FAILED);
    expect(logRepo.saved.metadata.error).toBe('Delivery failed');
    expect(logRepo.saved.metadata.provider).toBe('onecodesoft');
    // The platform account is recorded, so Check status asks it and not the school's own (#3350).
    expect(logRepo.saved.metadata.source).toBe('platform');
    expect(JSON.stringify(logRepo.saved.metadata)).not.toContain('123456');
    // The text the gateway echoed is what Rule 13 is about.
    expect(JSON.stringify(logRepo.saved.metadata)).not.toContain('SECRET');
  });

  it('marks the log FAILED without persisting the raw error text when the provider throws', async () => {
    const provider = {
      send: vi.fn().mockRejectedValue(new Error('boom: link was https://x/activate?token=SECRET')),
    };
    registry.resolve.mockReturnValue(provider);

    const result = await service.deliver({
      tenantId: 'tenant-1',
      medium: CommunicationMedium.SMS,
      to: '+8801700000000',
      recipientName: 'Jane Doe',
      kind: 'OTP',
      vars: { code: '123456' },
    });

    expect(result.status).toBe(CommunicationStatus.FAILED);
    expect(logRepo.saved.metadata.error).toBe('Delivery failed');
  });

  it('marks the log FAILED without throwing when no provider is configured for the medium', async () => {
    registry.resolve.mockReturnValue(undefined);

    const result = await service.deliver({
      tenantId: 'tenant-1',
      medium: CommunicationMedium.SMS,
      to: '+8801700000000',
      recipientName: 'Jane Doe',
      kind: 'OTP',
      vars: { code: '123456' },
    });

    expect(result.status).toBe(CommunicationStatus.FAILED);
    expect(logRepo.saved.status).toBe(CommunicationStatus.FAILED);
  });
});

describe('AccountAccessDeliveryService platform sender (tenantId null, D28)', () => {
  it('says SchoolManager, sends on the platform, and writes no communication log', async () => {
    const logRepo = fakeLogRepo();
    const provider = { send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p' }) };
    const schools = { getResolvedSettings: vi.fn(), findById: vi.fn() };
    const service = new AccountAccessDeliveryService(
      logRepo as any,
      { resolve: vi.fn().mockReturnValue(provider) } as any,
      schools as any,
      { get: () => undefined } as any,
    );

    const result = await service.deliver({
      tenantId: null,
      medium: CommunicationMedium.SMS,
      to: '+8801700000000',
      recipientName: 'Jane',
      kind: 'OTP',
      vars: { code: '123456' },
    });

    const [params, tenantArg] = provider.send.mock.calls[0];
    expect(params.body).toContain('SchoolManager');
    expect(params.allowPlatformSms).toBe(true);
    expect(tenantArg).toBeNull();
    expect(logRepo.save).not.toHaveBeenCalled();
    expect(schools.findById).not.toHaveBeenCalled();
    expect(result).toEqual({ logId: null, status: CommunicationStatus.SENT });
  });

  it('reports FAILED (not throws) when no provider is configured', async () => {
    const service = new AccountAccessDeliveryService(
      fakeLogRepo() as any,
      { resolve: vi.fn().mockReturnValue(undefined) } as any,
      {} as any,
      { get: () => undefined } as any,
    );
    const result = await service.deliver({
      tenantId: null,
      medium: CommunicationMedium.SMS,
      to: '+8801700000000',
      recipientName: 'Jane',
      kind: 'OTP',
      vars: { code: '123456' },
    });
    expect(result).toEqual({ logId: null, status: CommunicationStatus.FAILED });
  });
});

describe('pickChannel', () => {
  it('prefers EMAIL when the user has one', () => {
    expect(pickChannel({ email: 'a@b.com', phone: '01700000000' })).toEqual({
      medium: CommunicationMedium.EMAIL,
      to: 'a@b.com',
    });
  });

  it('falls back to SMS when there is no email', () => {
    expect(pickChannel({ email: null, phone: '01700000000' })).toEqual({
      medium: CommunicationMedium.SMS,
      to: '01700000000',
    });
  });

  it('returns null when there is neither', () => {
    expect(pickChannel({ email: null, phone: null })).toBeNull();
  });
});
