import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { CommunicationMedium, type TenantSettings } from '@biddaloy/shared';
import { CommunicationsModule } from '../communications.module';
import { MessagingProvider } from './messaging-provider';
import { MESSAGING_PROVIDERS } from './messaging-providers';
import { MessagingConfigResolver } from '../config/messaging-config.resolver';

const build = (P: (typeof MESSAGING_PROVIDERS)[number]) =>
  new (P as unknown as new (r: unknown) => MessagingProvider<unknown>)({});

function resolverFor(settings: TenantSettings) {
  return new MessagingConfigResolver(
    { getDecryptedSettings: vi.fn().mockResolvedValue(settings) } as any,
    { getOrLoad: vi.fn((_id: string, load: () => Promise<unknown>) => load()) } as any,
    { get: vi.fn() } as any,
    MESSAGING_PROVIDERS.map((P) => build(P)),
  );
}

describe('MESSAGING_PROVIDERS', () => {
  it('every provider is registered in CommunicationsModule', () => {
    const registered: unknown[] = Reflect.getMetadata('providers', CommunicationsModule);
    for (const P of MESSAGING_PROVIDERS) expect(registered).toContain(P);
  });

  it('has unique medium:name pairs', () => {
    const keys = MESSAGING_PROVIDERS.map((P) => {
      const { medium, name } = build(P).descriptor;
      return `${medium}:${name}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('each provider either declares balance + getBalance or overrides testConnection', () => {
    for (const P of MESSAGING_PROVIDERS) {
      const p = build(P);
      const viaBalance =
        p.descriptor.capabilities.includes('balance') && typeof p.getBalance === 'function';
      const overridden = P.prototype.testConnection !== MessagingProvider.prototype.testConnection;
      expect(viaBalance || overridden, p.descriptor.name).toBe(true);
    }
  });

  // The descriptor fields must match the keys the resolver actually returns.
  it('descriptor fields match the resolver output keys', async () => {
    const mim = resolverFor({
      version: 1,
      communications: {
        sms: {
          provider: 'mimsms',
          mimsms: { apiKey: 'k', senderId: 's', apiUrl: 'https://m.example' },
        },
      },
    });
    const one = resolverFor({
      version: 1,
      communications: {
        sms: {
          provider: 'onecodesoft',
          onecodesoft: { apiKey: 'k', senderId: 's', apiUrl: 'https://o.example/api' },
        },
      },
    });
    const other = resolverFor({
      version: 1,
      communications: {
        sms: { provider: 'greenweb', greenweb: { apiKey: 'k', apiUrl: 'https://g.example' } },
        whatsapp: { phoneNumberId: 'p', accessToken: 't', apiVersion: 'v21.0' },
        email: { host: 'h.example', port: 587, user: 'u', password: 'pw', from: 'a@x.com' },
        messenger: { pageId: 'pg', accessToken: 't' },
      },
    });
    const resolved: Record<string, object> = {
      mimsms: (await mim.resolve(CommunicationMedium.SMS, 't1')).config,
      onecodesoft: (await one.resolve(CommunicationMedium.SMS, 't3')).config,
      greenweb: (await other.resolve(CommunicationMedium.SMS, 't2')).config,
      'meta-cloud': (await other.resolve(CommunicationMedium.WHATSAPP, 't2')).config,
      smtp: (await other.resolve(CommunicationMedium.EMAIL, 't2')).config,
      'meta-page': (await other.resolve(CommunicationMedium.MESSENGER, 't2')).config,
    };
    for (const P of MESSAGING_PROVIDERS) {
      const { name, fields } = build(P).descriptor;
      const keys = Object.keys(resolved[name]).sort();
      expect(keys, name).toEqual(fields.map((f) => f.key).sort());
    }
    const secrets = new Set(
      MESSAGING_PROVIDERS.flatMap((P) =>
        build(P)
          .descriptor.fields.filter((f) => f.kind === 'secret')
          .map((f) => f.key),
      ),
    );
    expect(secrets).toEqual(new Set(['apiKey', 'accessToken', 'password']));
  });
});
