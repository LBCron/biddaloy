import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { MessagingConfigResolver } from '../../communications/config/messaging-config.resolver';
import { MESSAGING_PROVIDERS } from '../../communications/providers/messaging-providers';
import { PlatformAlertsService } from './platform-alerts.service';

type Resolved = { provider: { descriptor: { name: string } }; config: Record<string, string> };

/** The real resolver and registry: only the env is faked. */
const make = (env: Record<string, string>) => {
  const config = { get: (k: string) => env[k] } as never;
  const resolver = new MessagingConfigResolver(
    {} as never,
    {} as never,
    config,
    MESSAGING_PROVIDERS.map((P) => new P()) as never,
  );
  const svc = new PlatformAlertsService({} as never, {} as never, config, resolver, {} as never);
  return svc as unknown as { resolveSms(): Promise<Resolved | undefined>; onModuleInit(): void };
};

describe('platform SMS config through the real resolver', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deprecated key only: the registry default provider', async () => {
    const r = await make({ PLATFORM_SMS_API_KEY: 'k' }).resolveSms();
    expect(r?.provider.descriptor.name).toBe('greenweb');
    expect(r?.config).toEqual({ apiKey: 'k' });
  });

  it('deprecated key with the stack.yml default provider and empty extras', async () => {
    const r = await make({
      SMS_PROVIDER: '',
      PLATFORM_SMS_PROVIDER: 'greenweb',
      PLATFORM_SMS_API_KEY: 'k',
      PLATFORM_SMS_SENDER_ID: '',
      PLATFORM_SMS_API_URL: '',
    }).resolveSms();
    expect(r?.provider.descriptor.name).toBe('greenweb');
  });

  it('mimsms with sender and url, in any letter case', async () => {
    for (const name of ['mimsms', 'MimSMS', ' MIMSMS ']) {
      const r = await make({
        PLATFORM_SMS_PROVIDER: name,
        PLATFORM_SMS_API_KEY: 'k',
        PLATFORM_SMS_SENDER_ID: 's',
        PLATFORM_SMS_API_URL: 'https://gw.example/api',
      }).resolveSms();
      expect(r?.provider.descriptor.name).toBe('mimsms');
      expect(r?.config).toEqual({ apiKey: 'k', senderId: 's', apiUrl: 'https://gw.example/api' });
    }
  });

  it('mimsms without a sender id: not configured, no throw', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const r = await make({
      PLATFORM_SMS_PROVIDER: 'mimsms',
      PLATFORM_SMS_API_KEY: 'secret-k',
    }).resolveSms();
    expect(r).toBeUndefined();
    expect(warn.mock.calls.join('\n')).not.toContain('secret-k');
  });

  it('an unknown deprecated provider name falls back to the registry default', async () => {
    const r = await make({
      SMS_PROVIDER: '',
      PLATFORM_SMS_PROVIDER: 'nope',
      PLATFORM_SMS_API_KEY: 'k',
    }).resolveSms();
    expect(r?.provider.descriptor.name).toBe('greenweb');
  });

  it('SMS_PROVIDER=onecodesoft with its three keys', async () => {
    const r = await make({
      SMS_PROVIDER: 'onecodesoft',
      ONECODESOFT_API_KEY: 'k',
      ONECODESOFT_SENDER_ID: 's',
      ONECODESOFT_API_URL: 'https://gw.example/api',
    }).resolveSms();
    expect(r?.provider.descriptor.name).toBe('onecodesoft');
    expect(r?.config).toEqual({ apiKey: 'k', senderId: 's', apiUrl: 'https://gw.example/api' });
  });

  it('a non-config resolver error is logged generically and returns undefined', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = { get: () => undefined } as never;
    const boom = { resolve: async () => Promise.reject(new Error('db password=hunter2')) };
    const svc = new PlatformAlertsService(
      {} as never,
      {} as never,
      config,
      boom as never,
      {} as never,
    );
    expect(
      await (svc as unknown as { resolveSms(): Promise<unknown> }).resolveSms(),
    ).toBeUndefined();
    expect(warn.mock.calls.join('\n')).not.toContain('hunter2');
  });

  it('boot warning: once, key names only; also when extras are set without the key', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    make({ PLATFORM_SMS_API_KEY: 'secret-k', PLATFORM_SMS_PROVIDER: 'greenweb' }).onModuleInit();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('PLATFORM_SMS_API_KEY');
    expect(String(warn.mock.calls[0][0])).not.toContain('secret-k');
    warn.mockClear();
    make({ PLATFORM_SMS_SENDER_ID: 'sid' }).onModuleInit();
    expect(String(warn.mock.calls[0][0])).toContain('without PLATFORM_SMS_API_KEY');
    warn.mockClear();
    make({ SMS_PROVIDER: 'greenweb', PLATFORM_SMS_API_KEY: 'k' }).onModuleInit();
    expect(warn.mock.calls.map(String)).toEqual([
      'PLATFORM_SMS_* ignored because SMS_PROVIDER is set',
    ]);
    warn.mockClear();
    // stack.yml default alone never warns
    make({ PLATFORM_SMS_PROVIDER: 'greenweb', SMS_PROVIDER: '' }).onModuleInit();
    expect(warn).not.toHaveBeenCalled();
  });
});
