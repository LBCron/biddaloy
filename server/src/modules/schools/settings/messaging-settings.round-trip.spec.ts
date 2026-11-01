import { describe, it, expect, vi } from 'vitest';
import { CommunicationMedium, type TenantSettings } from '@biddaloy/shared';
import { problemWith } from './messaging-settings.validator';
import { MessagingConfigResolver } from '../../communications/config/messaging-config.resolver';
import { ProviderNotConfiguredError } from '../../communications/config/provider-not-configured.error';
import { OnecodesoftProvider } from '../../communications/providers/sms/onecodesoft.provider';

/**
 * Review round 3, item 2: the SMS settings the validator accepts must resolve the way the school
 * meant. Real descriptors (no stub list): the round trip is about OneCodeSoft's real fields.
 */
const SMS = CommunicationMedium.SMS;
const PLATFORM_ENV: Record<string, string> = {
  ONECODESOFT_API_KEY: 'platform-key',
  ONECODESOFT_API_URL: 'https://platform.example/api',
};

/** Validate the block, then resolve a school whose stored SMS settings are exactly that block. */
async function saveThenResolve(sms: Record<string, unknown>) {
  const problem = problemWith(sms, SMS);
  const settings = { version: 1, communications: { sms } } as unknown as TenantSettings;
  const resolver = new MessagingConfigResolver(
    { getDecryptedSettings: vi.fn(async () => settings) } as any,
    { getOrLoad: (_id: string, load: () => Promise<unknown>) => load() } as any,
    { get: (k: string) => PLATFORM_ENV[k] } as any,
    [new OnecodesoftProvider()],
  );
  const resolved = await resolver.resolve(SMS, 't1').catch((e: unknown) => e);
  return { problem, resolved };
}

describe('SMS settings: validator accepts -> resolver result', () => {
  it('PLATFORM-metered OneCodeSoft with no gateway of its own sends on the platform account', async () => {
    const { problem, resolved } = await saveThenResolve({
      provider: 'onecodesoft',
      metering: 'PLATFORM',
    });
    expect(problem).toBeNull();
    expect(resolved).toMatchObject({
      config: { apiKey: 'platform-key', apiUrl: 'https://platform.example/api' },
    });
  });

  it('PLATFORM-metered with an empty block: same, the platform account', async () => {
    const { problem, resolved } = await saveThenResolve({
      provider: 'onecodesoft',
      metering: 'PLATFORM',
      onecodesoft: {},
    });
    expect(problem).toBeNull();
    expect(resolved).toMatchObject({ config: { apiKey: 'platform-key' } });
  });

  // The destination-pairing guard: a school-chosen host never receives the platform's key.
  it('PLATFORM-metered with only its own apiUrl: accepted, but the send fails closed', async () => {
    const { problem, resolved } = await saveThenResolve({
      provider: 'onecodesoft',
      metering: 'PLATFORM',
      onecodesoft: { apiUrl: 'https://attacker.example/api' },
    });
    expect(problem).toBeNull();
    expect(resolved).toBeInstanceOf(ProviderNotConfiguredError);
    expect((resolved as Error).message).toMatch(/never falls back to the platform account/);
    expect((resolved as Error).message).not.toContain('platform-key');
  });

  it('PLATFORM-metered with a half-filled own gateway is rejected at save time', async () => {
    const { problem } = await saveThenResolve({
      provider: 'onecodesoft',
      metering: 'PLATFORM',
      onecodesoft: { apiKey: 'own-key' },
    });
    expect(problem).toMatch(/missing the required field apiUrl/);
  });

  it('a school with its own complete gateway uses its own key, metered or not', async () => {
    for (const metering of ['OFF', 'PLATFORM']) {
      const { problem, resolved } = await saveThenResolve({
        provider: 'onecodesoft',
        metering,
        onecodesoft: { apiKey: 'own-key', apiUrl: 'https://own.example/api' },
      });
      expect(problem).toBeNull();
      expect(resolved).toMatchObject({
        config: { apiKey: 'own-key', apiUrl: 'https://own.example/api' },
      });
    }
  });
});
