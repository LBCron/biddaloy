import { CommunicationMedium } from '@biddaloy/shared';
import type { ProviderConfigField, ProviderDescriptor } from '@biddaloy/shared';

// Stub providers for specs: `vi.mock('<rel>/communications/providers/messaging-providers',
// () => import('<rel>/schools/settings/testing/messaging-stubs.fixture'))`. Keeps specs free of the
// real providers (and of their import cycle with SchoolsService).
const label = (s: string) => ({ en: s, bn: s });
const f = (
  key: string,
  kind: ProviderConfigField['kind'],
  required: boolean,
): ProviderConfigField => ({
  key,
  label: label(key),
  kind,
  required,
});

const d = (
  medium: CommunicationMedium,
  name: string,
  fields: ProviderConfigField[],
): ProviderDescriptor => ({
  medium,
  name,
  label: label(name),
  capabilities: [],
  fields,
  supportsTestMessage: false,
});

export class AlphaSms {
  readonly descriptor = d(CommunicationMedium.SMS, 'alpha', [
    f('apiKey', 'secret', true),
    f('senderId', 'text', true),
    f('apiUrl', 'url', false),
  ]);
}
export class BetaSms {
  readonly descriptor = d(CommunicationMedium.SMS, 'beta', [f('token', 'secret', true)]);
}
export class GammaSms {
  readonly descriptor = d(CommunicationMedium.SMS, 'gamma', [f('key', 'secret', true)]);
}
export class SoloChat {
  readonly descriptor = d(CommunicationMedium.WHATSAPP, 'solo', [
    f('phoneNumberId', 'text', true),
    f('accessToken', 'secret', true),
    { ...f('port', 'text', false), format: 'port' },
  ]);
}

export const MESSAGING_PROVIDERS: unknown[] = [AlphaSms, BetaSms, SoloChat];
