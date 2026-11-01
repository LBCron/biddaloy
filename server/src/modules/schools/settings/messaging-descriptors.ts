import { CommunicationMedium } from '@biddaloy/shared';
import type {
  MessagingProvidersResponse,
  ProviderConfigField,
  ProviderDescriptor,
  TenantSettings,
} from '@biddaloy/shared';
import { MESSAGING_PROVIDERS } from '../../communications/providers/messaging-providers';

type HasDescriptor = new () => { readonly descriptor: ProviderDescriptor };
type Block = Record<string, unknown>;

// One descriptor per provider class, built on first use. Keyed by class, so a spec that mocks or
// extends the list still sees its own providers.
const built = new WeakMap<object, ProviderDescriptor>();

/**
 * Descriptors of every registered messaging provider. `descriptor` is a field initializer, so no
 * constructor argument is ever read (D24, cf. `messaging-providers.spec.ts`).
 */
export function messagingDescriptors(): ProviderDescriptor[] {
  return MESSAGING_PROVIDERS.map((P) => {
    let d = built.get(P);
    if (!d) built.set(P, (d = new (P as unknown as HasDescriptor)().descriptor));
    return d;
  });
}

export const descriptorsFor = (medium: CommunicationMedium): ProviderDescriptor[] =>
  messagingDescriptors().filter((d) => d.medium === medium);

/** D6: the medium's sole provider, whose fields may sit flat under `communications.<medium>` (pre-D6 shape). */
export function soleDescriptorFor(medium: CommunicationMedium): ProviderDescriptor | undefined {
  const all = descriptorsFor(medium);
  return all.length === 1 ? all[0] : undefined;
}

export const settingsKeyFor = (medium: CommunicationMedium): string => medium.toLowerCase();

export const isPlainObject = (v: unknown): v is Block =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Dot-paths of every `kind: 'secret'` field of the medium's providers:
 * `<prefix>.<provider>.<field>`, plus the flat `<prefix>.<field>` (legacy shape).
 */
export function messagingSecretPaths(medium: CommunicationMedium, prefix: string): string[] {
  const paths = new Set<string>();
  for (const d of descriptorsFor(medium)) {
    for (const f of d.fields) if (f.kind === 'secret') paths.add(`${prefix}.${d.name}.${f.key}`);
  }
  // ponytail: flat compat paths cover every provider's secret keys; drop with the D6 compat-removal follow-up.
  for (const d of descriptorsFor(medium)) {
    for (const f of d.fields) if (f.kind === 'secret') paths.add(`${prefix}.${f.key}`);
  }
  return [...paths];
}

/**
 * A flat block (pre-D6, sole provider) is lifted into `<sole.name>`; anything
 * else is returned unchanged. Inputs are never mutated.
 */
export function toNestedMedium(block: unknown, medium: CommunicationMedium): Block | undefined {
  if (!isPlainObject(block)) return undefined;
  const sole = soleDescriptorFor(medium);
  if (!sole || Object.hasOwn(block, sole.name)) return block;
  const moved = sole.fields.map((f) => f.key).filter((k) => Object.hasOwn(block, k));
  if (moved.length === 0) return block;
  const nested: Block = {};
  const inner: Block = {};
  for (const k of Object.keys(block)) {
    if (moved.includes(k)) inner[k] = block[k];
    else nested[k] = block[k];
  }
  nested[sole.name] = inner;
  return nested;
}

/** A non-empty string or a finite number. */
export const present = (v: unknown): boolean =>
  (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v));

/** A `url` field is always a destination; other kinds say so on the descriptor (`destination: true`). */
export const isDestinationField = (f: ProviderConfigField): boolean =>
  f.kind === 'url' || f.destination === true;

/**
 * D11: fields that decide whose account a send uses. Other optional fields (apiVersion) are not
 * credentials and resolve independently.
 */
export const isOwnedField = (f: ProviderConfigField): boolean =>
  f.required || f.owned === true || isDestinationField(f);

/**
 * #3338: the platform tier serves this medium: always for media without metering, and for SMS
 * only when it is PLATFORM-metered. Same gate as the resolver's (bar `allowPlatformKeys`).
 */
const onPlatformTier = (medium: CommunicationMedium, block: Block | undefined): boolean =>
  medium !== CommunicationMedium.SMS || block?.metering === 'PLATFORM';

/**
 * #3338, the one ownership rule (validator, resolver, descriptors; the #3339 migration is its SQL
 * twin): the school holds a value in an owned field of company `d`'s own block.
 */
export const ownsBlock = (d: ProviderDescriptor, own: unknown): boolean =>
  isPlainObject(own) && d.fields.some((f) => isOwnedField(f) && present(own[f.key]));

/**
 * #3338: the stored `provider` that still picks the company, else undefined (the platform's
 * `<MEDIUM>_PROVIDER` decides). On the platform tier it counts only while the school owns that
 * company's own block: a draft for another company does not keep a stale name.
 *
 *   { metering: 'PLATFORM', provider: 'a', a: {}, b: { senderId: 'X' } } -> undefined
 *   { metering: 'PLATFORM', provider: 'a', a: { apiKey: 'enc:..' } }      -> 'a'
 */
export function countedStoredProvider(
  block: Block | undefined,
  descriptors: readonly ProviderDescriptor[],
  platformTier: boolean,
): unknown {
  const stored = block?.provider;
  if (!platformTier) return stored;
  const d = descriptors.find((x) => x.name === stored);
  return d && ownsBlock(d, block?.[d.name]) ? stored : undefined;
}

/**
 * D32: schema + selected + configured per medium. Never a value. `configured` is presence only:
 * the selected company's required fields are saved on the school. It does not look at the
 * platform env fallback (`<PREFIX>_<FIELD>`), so a school on the platform account reads false.
 * #3338: on the platform tier a stored `provider` counts only while the school owns that company's
 * own block (`countedStoredProvider`, as in the resolver); otherwise `selected` is null.
 */
export function buildMessagingProvidersResponse(
  settings: TenantSettings,
): MessagingProvidersResponse {
  const response: MessagingProvidersResponse = {};
  for (const medium of Object.values(CommunicationMedium)) {
    const providers = descriptorsFor(medium);
    if (providers.length === 0) continue;
    const comms = settings.communications as Record<string, unknown> | undefined;
    const block = toNestedMedium(comms?.[settingsKeyFor(medium)], medium);
    const stored = countedStoredProvider(block, providers, onPlatformTier(medium, block));
    // A stray `provider` is ignored when the medium has one provider (same rule as the resolver).
    const selected =
      providers.length === 1
        ? providers[0]
        : (providers.find((d) => d.name === stored) ??
          (stored === undefined ? soleDescriptorFor(medium) : undefined));
    const inner = selected ? block?.[selected.name] : undefined;
    const values = isPlainObject(inner) ? inner : undefined;
    response[medium] = {
      providers,
      selected: selected?.name ?? null,
      configured:
        !!selected &&
        !!values &&
        selected.fields.every((f) => !f.required || present(values[f.key])),
    };
  }
  return response;
}

/**
 * Has this school set up WhatsApp (a phone number id, D6 nested or pre-D6 flat)? Same "tenant
 * opted in" meaning as before. Once the phone number id is set the school owns the medium, so the
 * access token must be its own too: the platform token is never borrowed (the send fails closed).
 */
export function whatsappConfigured(settings: TenantSettings): boolean {
  const comms = settings.communications as Record<string, unknown> | undefined;
  const sole = soleDescriptorFor(CommunicationMedium.WHATSAPP);
  const block = toNestedMedium(
    comms?.[settingsKeyFor(CommunicationMedium.WHATSAPP)],
    CommunicationMedium.WHATSAPP,
  );
  const inner = sole ? block?.[sole.name] : undefined;
  return isPlainObject(inner) && present(inner.phoneNumberId);
}
