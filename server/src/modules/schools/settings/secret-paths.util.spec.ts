import { describe, it, expect, vi } from 'vitest';
import { getSecretPaths } from './secret-paths.util';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';
import { MESSAGING_PROVIDERS, GammaSms } from './testing/messaging-stubs.fixture';

vi.mock(
  '../../communications/providers/messaging-providers',
  () => import('./testing/messaging-stubs.fixture'),
);

describe('getSecretPaths', () => {
  it('finds every secret across the settings tree: DTO @Secret() paths plus provider-schema secrets', () => {
    const paths = getSecretPaths(TenantSettingsDto).sort();

    // This list is the credential inventory: every path here is encrypted at
    // rest, masked in API responses and redacted in the audit trail. The exact
    // set is asserted so a path that stops being reported cannot go unnoticed.
    // `communications.whatsapp.accessToken` is the flat pre-D6 compat paths: the
    // union of every provider's secret keys on the medium.
    expect(paths).toEqual(
      [
        'communications.sms.apiKey',
        'communications.sms.token',
        'communications.sms.alpha.apiKey',
        'communications.sms.beta.token',
        'communications.whatsapp.solo.accessToken',
        'communications.whatsapp.accessToken',
      ].sort(),
    );
  });

  it('never reports a non-secret field', () => {
    const paths = getSecretPaths(TenantSettingsDto);

    // A non-secret path pulled into secret handling would be encrypted then
    // masked, so a school could never read back its own phone number ID.
    expect(paths).not.toContain('communications.whatsapp.solo.phoneNumberId');
    expect(paths).not.toContain('communications.sms.provider');
    expect(paths).not.toContain('version');
  });

  it('picks up a newly registered provider with no other change', () => {
    MESSAGING_PROVIDERS.push(GammaSms);
    try {
      expect(getSecretPaths(TenantSettingsDto)).toContain('communications.sms.gamma.key');
    } finally {
      MESSAGING_PROVIDERS.pop();
    }
    expect(getSecretPaths(TenantSettingsDto)).not.toContain('communications.sms.gamma.key');
  });
});
