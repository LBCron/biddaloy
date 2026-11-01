import '../../schools/schools.service';
import { describe, it, expect, vi } from 'vitest';
import { CommunicationMedium, type TenantSettings } from '@biddaloy/shared';
import { MESSAGING_PROVIDERS } from './messaging-providers';
import { MessagingConfigResolver } from '../config/messaging-config.resolver';
import { TenantSettingsDto } from '../../schools/dto/tenant-settings.dto';
import { problemWith } from '../../schools/settings/messaging-settings.validator';
import { getSecretPaths } from '../../schools/settings/secret-paths.util';
import { buildMessagingProvidersResponse } from '../../schools/settings/messaging-descriptors';

/**
 * D19 proof: "one class + one line". `StubSmsProvider` below is the class; the `vi.mock` is the
 * one line in `MESSAGING_PROVIDERS`. Nothing else in the source tree is touched, yet the resolver,
 * the settings validator, the secret paths and the providers response all know the new vendor.
 */
const { StubSmsProvider } = await vi.hoisted(async () => {
  const { MessagingProvider } = await import('./messaging-provider');
  const { CommunicationMedium: Medium } = await import('@biddaloy/shared');
  class StubSmsProvider extends MessagingProvider<Record<string, string>> {
    readonly envPrefix = 'STUB';
    readonly descriptor = {
      medium: Medium.SMS,
      name: 'stub',
      label: { en: 'Stub SMS', bn: 'স্টাব' },
      capabilities: [],
      supportsTestMessage: false,
      fields: [
        {
          key: 'apiKey',
          label: { en: 'API key', bn: 'কী' },
          kind: 'secret' as const,
          required: true,
        },
        {
          key: 'senderId',
          label: { en: 'Sender', bn: 'প্রেরক' },
          kind: 'text' as const,
          required: false,
        },
      ],
    };
    send() {
      return Promise.resolve({
        success: true,
        providerMessageId: 's1',
        outcome: 'ACCEPTED' as const,
      });
    }
  }
  return { StubSmsProvider };
});

// The "one line": the stub joins the real list.
vi.mock('./messaging-providers', async (importActual) => {
  const actual = await importActual<typeof import('./messaging-providers')>();
  return { MESSAGING_PROVIDERS: [...actual.MESSAGING_PROVIDERS, StubSmsProvider] };
});

const resolverFor = (settings: TenantSettings, env: Record<string, string> = {}) =>
  new MessagingConfigResolver(
    { getDecryptedSettings: async () => settings } as any,
    { getOrLoad: (_id: string, load: () => Promise<unknown>) => load() } as any,
    { get: (k: string) => env[k] } as any,
    MESSAGING_PROVIDERS.map((P) => new (P as any)()),
  );

const stubSettings = (extra: object = {}) =>
  ({
    version: 1,
    communications: {
      sms: { provider: 'stub', stub: { apiKey: 'tenant-key', senderId: 'S' }, ...extra },
    },
  }) as unknown as TenantSettings;

describe('a new vendor is one class + one line', () => {
  it('the resolver picks it from tenant settings', async () => {
    const r = await resolverFor(stubSettings()).resolve(CommunicationMedium.SMS, 't1');
    expect(r.provider.descriptor.name).toBe('stub');
    expect(r.config).toEqual({ apiKey: 'tenant-key', senderId: 'S' });
  });

  it('the resolver picks it from env STUB_API_KEY for a platform-metered school', async () => {
    const settings = {
      version: 1,
      communications: { sms: { provider: 'stub', metering: 'PLATFORM' } },
    } as unknown as TenantSettings;
    // #3338: a school that owns nothing is on the platform account, so SMS_PROVIDER picks the company.
    const r = await resolverFor(settings, {
      SMS_PROVIDER: 'stub',
      STUB_API_KEY: 'platform-key',
    }).resolve(CommunicationMedium.SMS, 't1');
    expect(r.config).toMatchObject({ apiKey: 'platform-key' });
  });

  it('the settings validator accepts its fields and rejects an unknown one', () => {
    expect(problemWith(stubSettings().communications!.sms, CommunicationMedium.SMS)).toBeNull();
    expect(
      problemWith({ provider: 'stub', stub: { apiKey: 'k', nope: 'x' } }, CommunicationMedium.SMS),
    ).not.toBeNull();
  });

  it('its secret is an encrypted/redacted path', () => {
    expect(getSecretPaths(TenantSettingsDto)).toContain('communications.sms.stub.apiKey');
  });

  it('the providers response lists it, selected and configured', () => {
    const sms = buildMessagingProvidersResponse(stubSettings())[CommunicationMedium.SMS];
    expect(sms?.providers.map((d) => d.name)).toContain('stub');
    expect(sms?.selected).toBe('stub');
    expect(sms?.configured).toBe(true);
  });
});
