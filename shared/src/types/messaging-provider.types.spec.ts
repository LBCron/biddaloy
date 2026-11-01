import { describe, expect, expectTypeOf, it } from 'vitest';
import { CommunicationMedium } from '../enums';
import type {
  MessagingProvidersResponse,
  ProviderConfigField,
  ProviderDescriptor,
} from './messaging-provider.types';

const f = (key: string, kind: ProviderConfigField['kind']): ProviderConfigField => ({
  key,
  label: { en: key, bn: key },
  kind,
  required: true,
});
const d = (medium: CommunicationMedium, name: string): ProviderDescriptor => ({
  medium,
  name,
  label: { en: name, bn: name },
  capabilities: ['balance'],
  fields: [f('apiKey', 'secret'), f('url', 'url'), f('from', 'text')],
  supportsTestMessage: true,
});

describe('messaging provider types', () => {
  it('accepts a six-provider fixture and only secret fields are secret', () => {
    const res: MessagingProvidersResponse = {
      [CommunicationMedium.SMS]: {
        providers: ['a', 'b', 'c', 'd'].map((n) => d(CommunicationMedium.SMS, n)),
        configured: true,
        selected: 'a',
      },
      [CommunicationMedium.EMAIL]: { providers: [d(CommunicationMedium.EMAIL, 'smtp')], configured: false, selected: null },
      [CommunicationMedium.WHATSAPP]: { providers: [d(CommunicationMedium.WHATSAPP, 'x')], configured: false, selected: null },
    };
    const all = Object.values(res).flatMap((m) => m!.providers);
    expect(all).toHaveLength(6);
    const secrets = all.flatMap((p) => p.fields).filter((x) => x.kind === 'secret');
    expect(secrets.every((x) => x.key === 'apiKey')).toBe(true);
    expectTypeOf<ProviderConfigField['kind']>().toEqualTypeOf<'text' | 'url' | 'secret'>();
  });
});
