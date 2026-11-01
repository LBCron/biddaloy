import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommunicationMedium } from '@biddaloy/shared';
import { CommunicationProviderRegistryService } from './communication-provider.registry';
import { MailpitSinkProvider } from './sink/mailpit-sink.provider';
import { ProviderNotConfiguredError } from '../config/provider-not-configured.error';
import { MessagingConfigResolver } from '../config/messaging-config.resolver';
import { GreenwebProvider } from './sms/greenweb.provider';
import { MimsmsProvider } from './sms/mimsms.provider';
import { MetaCloudProvider } from './whatsapp/meta-cloud.provider';
import { SmtpProvider } from './email/smtp.provider';
import { MetaPageProvider } from './messenger/meta-page.provider';

const providers = [
  new GreenwebProvider(),
  new MimsmsProvider(),
  new MetaCloudProvider(),
  new SmtpProvider(),
  new MetaPageProvider(),
];

/** Real resolver over fake settings: each tenant picks its own SMS vendor. */
function registryFor(settingsByTenant: Record<string, unknown>) {
  const resolver = new MessagingConfigResolver(
    { getDecryptedSettings: async (id: string) => settingsByTenant[id] ?? { version: 1 } } as any,
    { getOrLoad: (_id: string, load: () => Promise<unknown>) => load() } as any,
    { get: () => undefined } as any,
    providers,
  );
  return new CommunicationProviderRegistryService(resolver);
}

const sms = (provider: string, block: object) => ({
  version: 1,
  communications: { sms: { provider, [provider]: block } },
});

describe('CommunicationProviderRegistryService', () => {
  afterEach(() => vi.unstubAllEnvs());

  describe('chosen provider per tenant', () => {
    const registry = registryFor({
      'tenant-a': sms('greenweb', { apiKey: 'ga' }),
      'tenant-b': sms('mimsms', { apiKey: 'mb', senderId: 'SB' }),
    });

    it('resolves each tenant to its own SMS provider and config', async () => {
      const a = await registry.resolveFor(CommunicationMedium.SMS, 'tenant-a');
      const b = await registry.resolveFor(CommunicationMedium.SMS, 'tenant-b');

      expect(a.provider.descriptor.name).toBe('greenweb');
      expect(a.config).toEqual({ apiKey: 'ga' });
      expect(b.provider.descriptor.name).toBe('mimsms');
      expect(b.config).toEqual({ apiKey: 'mb', senderId: 'SB' });
    });

    it('send() hands the chosen provider that tenant config and adds the SMS segment count', async () => {
      const spy = vi
        .spyOn(providers[1], 'send')
        .mockResolvedValue({ success: true, providerMessageId: 'm1', outcome: 'ACCEPTED' });

      const result = await registry
        .resolve(CommunicationMedium.SMS)!
        .send({ to: '01712345678', body: 'hello' }, 'tenant-b');

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ body: 'hello' }), {
        apiKey: 'mb',
        senderId: 'SB',
      });
      expect(result).toMatchObject({ success: true, segments: 1 });
      spy.mockRestore();
    });

    it('an unconfigured tenant gets a REJECTED non-retryable result, with segments, never a throw', async () => {
      const result = await registry
        .resolve(CommunicationMedium.SMS)!
        .send({ to: '01712345678', body: 'hello' }, 'tenant-none');

      expect(result).toMatchObject({
        success: false,
        outcome: 'REJECTED',
        retryable: false,
        segments: 1,
      });
      // Our own "not configured" sentence is the one message kept: it tells the admin what to fix.
      expect(result.error).toMatch(/is not configured for this tenant/);
    });

    it('any other error while resolving config is REJECTED (credit released) but still retryable', async () => {
      // A settings-read failure never reached the network: never AMBIGUOUS (that leaves credit held).
      const resolver = { resolve: vi.fn().mockRejectedValue(new Error('db down')) };
      const result = await new CommunicationProviderRegistryService(resolver as any)
        .resolve(CommunicationMedium.SMS)!
        .send({ to: '01712345678', body: 'hello' }, 'tenant-a');

      expect(result).toMatchObject({ success: false, outcome: 'REJECTED', segments: 1 });
      expect(result.retryable).toBeUndefined();
      // Rule 24: a driver's own text never reaches the log; only our fixed sentence does.
      expect(result.error).toBe('The message could not be sent.');
    });

    it('a provider that throws becomes an AMBIGUOUS result', async () => {
      const spy = vi.spyOn(providers[0], 'send').mockRejectedValue(new Error('boom'));

      const result = await registry
        .resolve(CommunicationMedium.SMS)!
        .send({ to: '01712345678', body: 'hello' }, 'tenant-a');

      expect(result).toMatchObject({
        success: false,
        outcome: 'AMBIGUOUS',
        error: 'The message could not be sent.',
      });
      spy.mockRestore();
    });

    it('allowPlatformSms lets a school with no gateway send on platform keys', async () => {
      const resolver = {
        resolve: vi.fn().mockRejectedValue(new ProviderNotConfiguredError('SMS', 'x')),
      };
      const r = new CommunicationProviderRegistryService(resolver as any);

      await r
        .resolve(CommunicationMedium.SMS)!
        .send({ to: 'x', body: 'y', allowPlatformSms: true }, 't');

      expect(resolver.resolve).toHaveBeenCalledWith(CommunicationMedium.SMS, 't', {
        allowPlatformKeys: true,
      });
    });
  });

  // D6 compat: a school saved before the nested shape (flat `whatsapp.accessToken`) still sends end to end.
  it('an old flat-shape WhatsApp tenant still sends through the real provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.9' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const registry = registryFor({
      old: {
        version: 1,
        communications: { whatsapp: { phoneNumberId: '4242', accessToken: 'flat-token' } },
      },
    });

    const result = await registry
      .resolve(CommunicationMedium.WHATSAPP)!
      .send({ to: '01712345678', body: 'hi' }, 'old');
    vi.unstubAllGlobals();

    expect(result).toMatchObject({ success: true, providerMessageId: 'wamid.9' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.facebook.com/v21.0/4242/messages');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer flat-token');
  });

  // Epic 87 / D9: with the sink on, nothing leaves the server, whatever tenant or env config says.
  it('with MESSAGE_SINK=mailpit, every medium resolves to the sink and no config is read', () => {
    vi.stubEnv('MESSAGE_SINK', 'mailpit');
    const resolver = { resolve: vi.fn() };
    const sink = new CommunicationProviderRegistryService(resolver as any);
    for (const medium of [
      CommunicationMedium.SMS,
      CommunicationMedium.WHATSAPP,
      CommunicationMedium.EMAIL,
      CommunicationMedium.MESSENGER,
    ]) {
      expect(sink.resolve(medium)).toBeInstanceOf(MailpitSinkProvider);
    }
    expect(sink.resolve(CommunicationMedium.PHONE_CALL)).toBeUndefined();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('with MESSAGE_SINK unset, the real providers are used', () => {
    vi.stubEnv('MESSAGE_SINK', '');
    expect(registryFor({}).resolve(CommunicationMedium.SMS)).not.toBeInstanceOf(
      MailpitSinkProvider,
    );
  });

  it('DEMO_MODE=true alone no longer swaps providers', () => {
    vi.stubEnv('MESSAGE_SINK', '');
    vi.stubEnv('DEMO_MODE', 'true');
    expect(registryFor({}).resolve(CommunicationMedium.SMS)).not.toBeInstanceOf(
      MailpitSinkProvider,
    );
  });

  it('returns undefined for a medium with no registered provider', () => {
    expect(registryFor({}).resolve(CommunicationMedium.PHONE_CALL)).toBeUndefined();
  });
});
