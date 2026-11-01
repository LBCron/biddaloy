import { EncryptionService, isEncryptedEnvelope } from './encryption.service';
import { getSecretPaths } from './secret-paths.util';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';

/** Walks `segments` from `root`, stopping short (returning `undefined`) at
 * the first missing or non-object parent — a path the caller never
 * touched is exactly the "unaffected sections stay as they are" behaviour
 * `mergeTenantSettings` already relies on elsewhere in this module, not
 * an error. On success, returns the immediate parent object holding the
 * final segment, so the caller can both read and write through one walk
 * instead of two that could in principle disagree with each other. */
function resolveParent(
  root: Record<string, unknown>,
  segments: string[],
): Record<string, unknown> | undefined {
  let cursor: Record<string, unknown> = root;
  for (const key of segments.slice(0, -1)) {
    const next = cursor[key];
    if (next === null || typeof next !== 'object') return undefined;
    cursor = next as Record<string, unknown>;
  }
  return cursor;
}

/** Applies `transform` to whichever of `paths` are present as non-empty
 * strings in `obj`, leaving everything else untouched. Shared by
 * `encryptSecretFields`/`decryptSecretFields`/`reencryptSecretFields`
 * below — what differs between them is which direction `transform` runs
 * and how a failure on one path is handled.
 *
 * Without `onError`, a `transform` failure propagates and aborts the
 * whole object (`encryptSecretFields`'s behaviour — a missing key is a
 * hard configuration error, not a per-field one). With `onError`, the
 * failure is reported through it instead and `obj`'s value for that path
 * is left exactly as `transform` found it — the caller decides via
 * `onError` itself whether that means dropping the field. */
function transformAtPaths(
  obj: Record<string, unknown>,
  paths: string[],
  transform: (value: string, path: string) => string,
  onError?: (error: unknown, path: string, parent: Record<string, unknown>, key: string) => void,
): Record<string, unknown> {
  const result = structuredClone(obj);

  for (const path of paths) {
    const segments = path.split('.');
    const parent = resolveParent(result, segments);
    const lastKey = segments[segments.length - 1];
    const value = parent?.[lastKey];

    if (parent && typeof value === 'string' && value.length > 0) {
      try {
        parent[lastKey] = transform(value, path);
      } catch (error) {
        if (!onError) throw error;
        onError(error, path, parent, lastKey);
      }
    }
  }

  return result;
}

/** Every `@Secret()`-marked field present in `settings` gets encrypted in
 * place; everything else passes through unchanged. Generic over whatever
 * `getSecretPaths(TenantSettingsDto)` finds — see that function's own
 * comment for why this isn't a hardcoded field list. */
export function encryptSecretFields(
  settings: Record<string, unknown>,
  encryption: EncryptionService,
): Record<string, unknown> {
  return transformAtPaths(settings, getSecretPaths(TenantSettingsDto), (plaintext) =>
    encryption.encrypt(plaintext),
  );
}

/** Inverse of `encryptSecretFields` — for trusted internal callers that
 * genuinely need the plaintext (e.g. #8.7.10's per-tenant provider
 * resolver, decrypting in memory only to make an outbound send). Never
 * call this to serve an HTTP response: #8.7.9's settings API masks
 * secrets instead of decrypting them, by design.
 *
 * A single field that fails to decrypt (a stale key, or a legacy
 * plaintext row `yarn settings:reencrypt` hasn't reached yet — see
 * `reencryptSecretFields`) does not take down every other, unrelated
 * secret in `settings`: that field is dropped from the result instead of
 * the whole call throwing, so e.g. one bad WhatsApp token doesn't also
 * disable a school's otherwise-working messaging settings. `onError`,
 * if given, is called with the failing path so a caller can log which
 * school/field needs attention — the thrown error itself never
 * identifies either. */
export function decryptSecretFields(
  settings: Record<string, unknown>,
  encryption: EncryptionService,
  onError?: (error: unknown, path: string) => void,
): Record<string, unknown> {
  return transformAtPaths(
    settings,
    getSecretPaths(TenantSettingsDto),
    (ciphertext) => encryption.decrypt(ciphertext),
    (error, path, parent, key) => {
      delete parent[key];
      onError?.(error, path);
    },
  );
}

/** Brings every secret field in `settings` onto `encryption`'s current
 * key: a legacy plaintext value (predates this feature) is encrypted for
 * the first time, and a value already encrypted under a previous key
 * (`EncryptionService`'s key-rotation doc) is decrypted and re-encrypted
 * under the current one. A value that fails to decrypt under any
 * configured key is left exactly as stored — never dropped, since unlike
 * `decryptSecretFields`'s read path this is the thing persisting back to
 * the database — and reported through `onSkip` so the caller (
 * `server/src/scripts/reencrypt-settings.ts`) can flag it for
 * investigation rather than silently losing it.
 *
 * A value already under the current key passes through byte-for-byte
 * unchanged, rather than being decrypted and re-encrypted with a fresh
 * IV: `encryption.isCurrent` checks this without needing to touch
 * plaintext. That's what makes the migration script's own "did anything
 * actually change" check meaningful — if `encrypt` ran unconditionally on
 * every value, its fresh IV would make every school look migrated on
 * every run, even ones nothing was done to. */
export function reencryptSecretFields(
  settings: Record<string, unknown>,
  encryption: EncryptionService,
  onSkip?: (error: unknown, path: string) => void,
): Record<string, unknown> {
  return transformAtPaths(
    settings,
    getSecretPaths(TenantSettingsDto),
    (value) => {
      if (isEncryptedEnvelope(value)) {
        return encryption.isCurrent(value) ? value : encryption.encrypt(encryption.decrypt(value));
      }
      return encryption.encrypt(value);
    },
    (error, path) => onSkip?.(error, path),
  );
}
