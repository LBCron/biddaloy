import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { EncryptionService } from './encryption.service';
import {
  encryptSecretFields,
  decryptSecretFields,
  reencryptSecretFields,
} from './settings-encryption.util';

vi.mock(
  '../../communications/providers/messaging-providers',
  () => import('./testing/messaging-stubs.fixture'),
);

function service(): EncryptionService {
  return new EncryptionService(randomBytes(32));
}

describe('encryptSecretFields', () => {
  it('encrypts every secret field present, leaving non-secret fields untouched', () => {
    const encryption = service();
    const settings = {
      version: 1,
      communications: {
        sms: { provider: 'alpha', alpha: { apiKey: 'sms-key' } },
        whatsapp: { phoneNumberId: '123', accessToken: 'wa-token' },
      },
    };

    const encrypted = encryptSecretFields(settings, encryption);
    const communications = encrypted.communications as any;

    expect(communications.sms.provider).toBe('alpha');
    expect(communications.sms.alpha.apiKey).toMatch(/^gcmv1:/);
    expect(communications.whatsapp.phoneNumberId).toBe('123');
    expect(communications.whatsapp.accessToken).toMatch(/^gcmv1:/);
  });

  it('does not mutate the object it was given', () => {
    const encryption = service();
    const settings = { communications: { whatsapp: { accessToken: 'wa-token' } } };

    encryptSecretFields(settings, encryption);

    expect((settings.communications.whatsapp as any).accessToken).toBe('wa-token');
  });

  it('skips a secret path that is absent, rather than throwing', () => {
    const encryption = service();
    const settings = { version: 1, communications: { sms: { provider: 'alpha' } } };

    expect(() => encryptSecretFields(settings, encryption)).not.toThrow();
  });

  it('skips a secret field that is an empty string, leaving it as-is', () => {
    const encryption = service();
    const settings = { communications: { whatsapp: { accessToken: '' } } };

    const encrypted = encryptSecretFields(settings, encryption);

    expect((encrypted.communications as any).whatsapp.accessToken).toBe('');
  });
});

describe('schema-declared secrets (D31)', () => {
  it('encrypts a secret that exists only in a provider descriptor and round-trips it', () => {
    const encryption = service();
    const original = {
      version: 1,
      communications: { sms: { provider: 'beta', beta: { token: 'tok-1' } } },
    };

    const encrypted = encryptSecretFields(original, encryption);

    expect((encrypted.communications as any).sms.beta.token).toMatch(/^gcmv1:/);
    expect(decryptSecretFields(encrypted, encryption)).toEqual(original);
  });

  it('still encrypts the flat sole-provider secret', () => {
    const encrypted = encryptSecretFields(
      { communications: { whatsapp: { phoneNumberId: '1', accessToken: 'flat-token' } } },
      service(),
    );

    expect((encrypted.communications as any).whatsapp.accessToken).toMatch(/^gcmv1:/);
  });
});

describe('decryptSecretFields', () => {
  it('reverses encryptSecretFields exactly', () => {
    const encryption = service();
    const original = {
      version: 1,
      communications: {
        whatsapp: { phoneNumberId: '123', accessToken: 'wa-token' },
      },
    };

    const roundTripped = decryptSecretFields(encryptSecretFields(original, encryption), encryption);

    expect(roundTripped).toEqual(original);
  });

  it('drops a field that fails to decrypt instead of throwing, leaving unrelated secrets intact', () => {
    const encryption = service();
    const settings = {
      version: 1,
      communications: {
        // Never encrypted at all — a legacy plaintext row.
        whatsapp: { phoneNumberId: '123', accessToken: 'legacy-plaintext-token' },
        sms: { provider: 'alpha', alpha: { apiKey: encryption.encrypt('sms-key') } },
      },
    };

    const decrypted = decryptSecretFields(settings, encryption);
    const communications = decrypted.communications as any;

    expect(communications.whatsapp.accessToken).toBeUndefined();
    expect(communications.sms.alpha.apiKey).toBe('sms-key');
  });

  it('reports the failing path via onError rather than only through the thrown message', () => {
    const encryption = service();
    const settings = { communications: { whatsapp: { accessToken: 'legacy-plaintext-token' } } };
    const onError = vi.fn();

    decryptSecretFields(settings, encryption, onError);

    expect(onError).toHaveBeenCalledWith(expect.anything(), 'communications.whatsapp.accessToken');
  });
});

describe('reencryptSecretFields', () => {
  it('encrypts a legacy plaintext secret for the first time', () => {
    const encryption = service();
    const settings = { communications: { whatsapp: { accessToken: 'legacy-plaintext-token' } } };

    const migrated = reencryptSecretFields(settings, encryption);
    const accessToken = (migrated.communications as any).whatsapp.accessToken;

    expect(accessToken).toMatch(/^gcmv1:/);
    expect(encryption.decrypt(accessToken)).toBe('legacy-plaintext-token');
  });

  it('re-encrypts a value under the current key when it was encrypted under a previous one', () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const oldEncryption = new EncryptionService(oldKey);
    const settings = {
      communications: { whatsapp: { accessToken: oldEncryption.encrypt('rotate-me') } },
    };
    const rotatedEncryption = new EncryptionService(newKey, [oldKey]);

    const migrated = reencryptSecretFields(settings, rotatedEncryption);
    const accessToken = (migrated.communications as any).whatsapp.accessToken;

    expect(new EncryptionService(newKey).decrypt(accessToken)).toBe('rotate-me');
  });

  it('leaves a value untouched and reports it via onSkip when it decrypts under no configured key', () => {
    const abandonedKey = randomBytes(32);
    const orphaned = new EncryptionService(abandonedKey).encrypt('orphaned');
    const settings = { communications: { whatsapp: { accessToken: orphaned } } };
    const currentEncryption = service();
    const onSkip = vi.fn();

    const migrated = reencryptSecretFields(settings, currentEncryption, onSkip);

    expect((migrated.communications as any).whatsapp.accessToken).toBe(orphaned);
    expect(onSkip).toHaveBeenCalledWith(expect.anything(), 'communications.whatsapp.accessToken');
  });

  it('is idempotent — running it again on already-current values still round-trips', () => {
    const encryption = service();
    const settings = { communications: { whatsapp: { accessToken: 'legacy-plaintext-token' } } };

    const once = reencryptSecretFields(settings, encryption);
    const twice = reencryptSecretFields(once, encryption);

    expect(encryption.decrypt((twice.communications as any).whatsapp.accessToken)).toBe(
      'legacy-plaintext-token',
    );
  });

  it('leaves a value already under the current key byte-for-byte unchanged', () => {
    const encryption = service();
    const envelope = encryption.encrypt('already-current');
    const settings = { communications: { whatsapp: { accessToken: envelope } } };

    const migrated = reencryptSecretFields(settings, encryption);

    // Same string, not just an equivalent decryption — a fresh IV here would
    // make the migration script think this school needed migrating when it
    // didn't.
    expect((migrated.communications as any).whatsapp.accessToken).toBe(envelope);
  });
});
