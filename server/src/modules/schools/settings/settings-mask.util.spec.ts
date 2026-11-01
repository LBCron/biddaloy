import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { EncryptionService } from './encryption.service';
import { maskSecretFields } from './settings-mask.util';

vi.mock(
  '../../communications/providers/messaging-providers',
  () => import('./testing/messaging-stubs.fixture'),
);

function service(): EncryptionService {
  return new EncryptionService(randomBytes(32));
}

describe('maskSecretFields', () => {
  it('replaces a configured secret with { configured: true, hint } — last 4 characters, never the plaintext', () => {
    const encryption = service();
    const envelope = encryption.encrypt('super-secret-whatsapp-token');
    const settings = {
      version: 1,
      communications: {
        whatsapp: { phoneNumberId: '123', accessToken: envelope },
      },
    };

    const masked = maskSecretFields(settings, encryption);
    const whatsapp = (masked.communications as Record<string, unknown>).whatsapp as Record<
      string,
      unknown
    >;

    expect(whatsapp.phoneNumberId).toBe('123');
    expect(whatsapp.accessToken).toEqual({ configured: true, hint: '••••oken' });
    expect(JSON.stringify(masked)).not.toContain('super-secret-whatsapp-token');
  });

  it('represents a cleared (explicit null) secret as { configured: false }, same as one that was never set', () => {
    const encryption = service();
    const settings = {
      version: 1,
      communications: { whatsapp: { phoneNumberId: '123', accessToken: null } },
    };

    const masked = maskSecretFields(settings, encryption);
    const whatsapp = (masked.communications as Record<string, unknown>).whatsapp as Record<
      string,
      unknown
    >;

    expect(whatsapp.accessToken).toEqual({ configured: false });
  });

  it('masks a cleared nested schema secret as { configured: false }', () => {
    const masked = maskSecretFields(
      { communications: { sms: { provider: 'beta', beta: { token: null } } } },
      service(),
    );

    expect((masked.communications as any).sms.beta.token).toEqual({ configured: false });
  });

  it('leaves a never-configured medium absent rather than synthesizing a placeholder', () => {
    const encryption = service();
    const settings = { version: 1, communications: { sms: { provider: 'alpha' } } };

    const masked = maskSecretFields(settings, encryption);
    const communications = masked.communications as Record<string, unknown>;

    expect('whatsapp' in communications).toBe(false);
  });

  it('masks every secret field independently across multiple mediums', () => {
    const encryption = service();
    const settings = {
      version: 1,
      communications: {
        whatsapp: { phoneNumberId: '1', accessToken: encryption.encrypt('wa-secret-1234') },
        sms: {
          provider: 'alpha',
          alpha: { apiKey: encryption.encrypt('sms-secret-0000'), senderId: 'S' },
          beta: { token: encryption.encrypt('beta-secret-5678') },
        },
      },
    };

    const masked = maskSecretFields(settings, encryption);
    const communications = masked.communications as any;

    expect(communications.whatsapp.accessToken).toEqual({ configured: true, hint: '••••1234' });
    expect(communications.sms.beta.token).toEqual({ configured: true, hint: '••••5678' });
    expect(communications.sms.alpha.apiKey).toEqual({ configured: true, hint: '••••0000' });
    // Non-secret fields pass through untouched.
    expect(communications.sms.alpha.senderId).toBe('S');
  });

  it('suppresses the hint for a secret too short to hide anything behind it', () => {
    const encryption = service();
    const settings = {
      version: 1,
      communications: {
        whatsapp: { phoneNumberId: '123', accessToken: encryption.encrypt('ab12') },
      },
    };

    const masked = maskSecretFields(settings, encryption);
    const whatsapp = (masked.communications as Record<string, unknown>).whatsapp as Record<
      string,
      unknown
    >;

    expect(whatsapp.accessToken).toEqual({ configured: true });
    expect(JSON.stringify(masked)).not.toContain('ab12');
  });

  it('reports a field that fails to decrypt as configured with no hint, instead of failing the whole call', () => {
    const encryption = service();
    // Encrypted under a *different* key than the one masking will use —
    // simulates a stranded row after a key rotation, or a cross-environment
    // dump restored with the wrong SETTINGS_ENCRYPTION_KEY.
    const otherKeyEncryption = service();
    const envelope = otherKeyEncryption.encrypt('super-secret-whatsapp-token');
    const settings = {
      version: 1,
      region: { locale: 'en-BD' },
      communications: {
        whatsapp: { phoneNumberId: '123', accessToken: envelope },
      },
    };
    const errors: Array<{ path: string }> = [];

    const masked = maskSecretFields(settings, encryption, (_error, path) => {
      errors.push({ path });
    });
    const whatsapp = (masked.communications as Record<string, unknown>).whatsapp as Record<
      string,
      unknown
    >;

    // The undecryptable field degrades to "configured, no hint" — it
    // genuinely is configured, this call just can't prove a hint for it.
    expect(whatsapp.accessToken).toEqual({ configured: true });
    // A sibling field, and the unrelated region section, survive intact —
    // one bad secret must not 500 the whole settings response.
    expect(whatsapp.phoneNumberId).toBe('123');
    expect(masked.region).toEqual({ locale: 'en-BD' });
    expect(errors).toEqual([{ path: 'communications.whatsapp.accessToken' }]);
  });

  it('does not mutate the object it was given', () => {
    const encryption = service();
    const envelope = encryption.encrypt('secret');
    const settings = { communications: { whatsapp: { accessToken: envelope } } };

    maskSecretFields(settings, encryption);

    expect((settings.communications.whatsapp as any).accessToken).toBe(envelope);
  });
});
