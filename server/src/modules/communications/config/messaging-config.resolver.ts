import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommunicationMedium, type ProviderConfigField } from '@biddaloy/shared';
import { SchoolsService } from '../../schools/schools.service';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import {
  countedStoredProvider,
  isDestinationField as isDestination,
  isOwnedField as isOwned,
  isPlainObject,
} from '../../schools/settings/messaging-descriptors';
import type { MessagingProvider } from '../providers/messaging-provider';
import { ProviderNotConfiguredError } from './provider-not-configured.error';

/** Every registered `MessagingProvider` instance (built in `CommunicationsModule`). */
export const MESSAGING_PROVIDER_INSTANCES = 'MESSAGING_PROVIDER_INSTANCES';

/** One provider's resolved fields. Absent optional fields are omitted, never `undefined`. */
export type ResolvedConfig = Record<string, string>;

/**
 * Same shape as a `communications.<medium>` settings block — `{ provider?, <name>: {...} }`, or
 * the old flat keys (single-provider media only). Untrusted (the test-connection body): only
 * descriptor field keys are read.
 */
export type MessagingOverride = Record<string, unknown>;

export interface ResolveOptions {
  override?: MessagingOverride;
  /** Account-access sends and platform alerts may use the platform's own SMS keys. */
  allowPlatformKeys?: boolean;
  /**
   * The caller only verifies the connection (`testConnection()`), it sends nothing, so an override
   * with a new destination may leave out `sendOnly` fields (an email `from`). Off by default: a send,
   * including a test message, needs every required field.
   */
  connectionTestOnly?: boolean;
  /**
   * Check status only (D23, #3350): the message was sent on the platform's account
   * (`metadata.source: 'platform'`), so this company is resolved there, from the platform env
   * keys, and the school's saved blocks are not read. Set by server code, never from a request.
   */
  platformProvider?: string;
}

/** Whose account the owned fields came from: the caller's draft, the school's saved settings, or the platform env. */
export type ConfigSource = 'override' | 'tenant' | 'platform';

export interface ResolvedMessaging {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the provider is picked at runtime; its config type is the descriptor's fields
  provider: MessagingProvider<any>;
  config: ResolvedConfig;
  source: ConfigSource;
}

type FieldValues = Record<string, string | null | undefined>;

const notOnCredit =
  'This school has no SMS gateway of its own and is not on prepaid SMS credit. Add a gateway in Settings › SMS, or ask the platform to turn on SMS credit.';

export const envName = (prefix: string, key: string) =>
  `${prefix}_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;

/**
 * string/number -> string; '' and anything else is unset. An explicit null stays null: in an
 * override it means "cleared" (never the stored or platform value, #3331); a stored null is unset
 * like a missing key (#3338).
 */
function coerce(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === 'string') return v === '' ? undefined : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/**
 * D6: the nested `<name>` block, else (old flat shape) the field keys on the medium itself. Only a
 * single-provider medium ever stored the flat shape (SMS was already nested before D6), so a
 * multi-provider medium reads the nested block only, as the validator accepts.
 */
function readBlock(
  src: Record<string, unknown>,
  name: string,
  fields: ProviderConfigField[],
  flatOk: boolean,
) {
  const nested = src[name];
  const from = isPlainObject(nested) ? nested : flatOk ? src : {};
  const out: FieldValues = {};
  for (const f of fields) out[f.key] = coerce(from[f.key]);
  return out;
}

/**
 * The one place that implements "override › tenant settings › platform env" for every medium
 * and provider, driven by the provider's descriptor (D1, D6, D11). No vendor names here.
 *
 * Fields do not fall back independently across trust tiers; a medium's source is decided as a unit:
 *   - override sets a destination field (apiUrl, host, port) to a value other than the stored one
 *     -> the override must carry every
 *     required field itself (bar `sendOnly` ones when `connectionTestOnly`); it never
 *     borrows stored credentials for a caller-chosen target.
 *   - else tenant stored a value in any owned field -> tenant/override only, never the platform
 *     env (a partly filled medium fails closed). A stored null or '' is not a value (#3338): a
 *     school that removed everything is back on the platform account, as the validator says.
 *   - else the override sets any owned field (from, senderId, apiKey) -> same as a destination:
 *     the override carries every required field itself, never mixed with platform env values.
 *   - else platform env, only when `platformOk`. On that tier a stored `provider` counts only
 *     while the school owns that company's own block (#3338, `countedStoredProvider`); otherwise
 *     the platform's `<MEDIUM>_PROVIDER` picks the company, and then the school's saved block for
 *     it (a draft) is not read: the platform picked it, so it is the platform's account. An
 *     override's `provider` always comes first.
 *   - an override null on any field is "cleared": it never falls back to stored or env (#3331).
 * Reads through `TenantSettingsCache`, so a burst of sends costs one decrypt.
 */
@Injectable()
export class MessagingConfigResolver {
  constructor(
    private readonly schools: SchoolsService,
    private readonly settingsCache: TenantSettingsCache,
    private readonly config: ConfigService,
    @Inject(MESSAGING_PROVIDER_INSTANCES)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see ResolvedMessaging
    private readonly providers: MessagingProvider<any>[],
  ) {}

  // null = platform sender (D28): no school settings, so everything falls to the platform env.
  private loadSettings(tenantId: string | null) {
    if (tenantId === null) {
      return Promise.resolve({} as Awaited<ReturnType<SchoolsService['getDecryptedSettings']>>);
    }
    return this.settingsCache.getOrLoad(tenantId, () =>
      this.schools.getDecryptedSettings(tenantId),
    );
  }

  async resolve(
    medium: CommunicationMedium,
    tenantId: string | null,
    opts: ResolveOptions = {},
  ): Promise<ResolvedMessaging> {
    const settings = await this.loadSettings(tenantId);
    const mediumKey = medium.toLowerCase() as 'sms' | 'whatsapp' | 'email' | 'messenger';
    const tenantMedium: Record<string, unknown> = settings.communications?.[mediumKey] ?? {};
    const override = opts.override ?? {};

    // Platform env keys serve PLATFORM-metered SMS schools and account-access sends (D11). The
    // other media have no metering: their env fallback is always on, as before.
    const platformOnly = opts.platformProvider !== undefined;
    const platformOk =
      medium !== CommunicationMedium.SMS ||
      tenantMedium.metering === 'PLATFORM' ||
      opts.allowPlatformKeys === true ||
      platformOnly;
    // An empty/blank env value (deploy/stack.yml `${X:-}`) is unset, so the registry default applies.
    const env = (name: string) => {
      const v = platformOk ? this.config.get<string>(name) : undefined;
      return typeof v === 'string' && v.trim() === '' ? undefined : v;
    };

    const forMedium = this.providers.filter((p) => p.descriptor.medium === medium);
    const flatOk = forMedium.length === 1;
    // #3338: a company name the school stored but holds nothing of (in that company's own block)
    // is not its own account. Multi-provider media are nested only, so `tenantMedium` is the block.
    const storedProvider = coerce(
      countedStoredProvider(
        tenantMedium,
        forMedium.map((p) => p.descriptor),
        platformOk,
      ),
    );
    const overrideProvider = coerce(override.provider);
    // A medium with one provider has nothing to choose: a stray stored/override `provider` key is ignored.
    const selected =
      opts.platformProvider ??
      (flatOk ? forMedium[0].descriptor.name : undefined) ??
      overrideProvider ??
      storedProvider ??
      env(`${medium}_PROVIDER`) ??
      forMedium[0]?.descriptor.name;
    // Review round 1 on #3347: when the platform picked the company, the school's saved draft for
    // it is not its account (a partial one would fail closed, a full one send on its own keys).
    const schoolPicked =
      !platformOnly &&
      (flatOk || !platformOk || overrideProvider != null || storedProvider != null);
    const provider = forMedium.find((p) => p.descriptor.name === selected);
    if (!provider) {
      // Rule 23: the submitted/stored name is never echoed.
      throw new ProviderNotConfiguredError(
        medium,
        "The selected provider is not recognized — choose one from the provider list on this school's settings.",
      );
    }

    const { fields, label } = provider.descriptor;
    const tenant = readBlock(
      schoolPicked ? tenantMedium : {},
      provider.descriptor.name,
      fields,
      flatOk,
    );
    const ov = readBlock(override, provider.descriptor.name, fields, flatOk);
    // A destination equal to the stored one is the school's own target, not a caller-chosen one
    // (the settings form pre-fills it), so it keeps the stored secrets. Any other value is new.
    const overrideSetsDestination = fields.some(
      (f) => isDestination(f) && ov[f.key] != null && ov[f.key] !== tenant[f.key],
    );
    const tenantOwnsIt =
      !overrideSetsDestination && fields.some((f) => isOwned(f) && tenant[f.key] != null);
    // Platform tier only: a caller-chosen sender/account never combines with the platform's keys.
    // Not in the tenant tier, where the form sends the owned text fields and leaves out unchanged
    // secrets, and mixing with the school's own stored values borrows nothing from the platform.
    const overrideOnly =
      overrideSetsDestination ||
      (!tenantOwnsIt && fields.some((f) => isOwned(f) && ov[f.key] != null));

    // A connection test of a new destination needs every required field itself, except send-only
    // ones (from); anything that sends (a real send, a test message) needs them all.
    const skipSendOnly = overrideSetsDestination && opts.connectionTestOnly === true;
    const required = fields.filter((f) => f.required && !(skipSendOnly && f.sendOnly === true));
    const envNames = required.map((f) => envName(provider.envPrefix, f.key)).join('/');
    const requiredKeys = required.map((f) => f.key).join(', ');

    const resolved: ResolvedConfig = {};
    for (const f of fields) {
      const e = env(envName(provider.envPrefix, f.key));
      // #3331: an override null is a field the caller cleared: unset, never stored or env.
      const value =
        ov[f.key] === null
          ? undefined
          : !isOwned(f)
            ? (ov[f.key] ?? tenant[f.key] ?? e)
            : overrideOnly
              ? ov[f.key]
              : tenantOwnsIt
                ? (ov[f.key] ?? tenant[f.key])
                : e;
      if (value) resolved[f.key] = value;
    }

    const missing = required.filter((f) => !resolved[f.key]).map((f) => f.key);
    if (missing.length > 0) {
      throw new ProviderNotConfiguredError(
        label.en,
        overrideSetsDestination
          ? `Testing a new destination requires ${requiredKeys} together (missing: ${missing.join(', ')}) — they aren't filled in from stored settings when the destination changes.`
          : overrideOnly
            ? `Unsaved values must carry ${requiredKeys} themselves (missing: ${missing.join(', ')}) — they are never combined with the platform account.`
            : tenantOwnsIt
              ? `Complete ${requiredKeys} together on this school's settings — a partially-configured medium never falls back to the platform account.`
              : platformOk
                ? `Configure it on this school's settings, or set ${envNames} as a platform-wide fallback.`
                : notOnCredit,
      );
    }
    const source: ConfigSource = overrideOnly ? 'override' : tenantOwnsIt ? 'tenant' : 'platform';
    return { provider, config: resolved, source };
  }
}
