import { describe, it, expect, vi } from 'vitest';
import { NotImplementedException } from '@nestjs/common';
import { CommunicationMedium, type ProviderDescriptor } from '@biddaloy/shared';
import { MessagingProvider } from './messaging-provider';
import {
  DestinationBlockedError,
  DestinationResolutionError,
} from './shared/outbound-destination-guard';

type Cfg = { k: string };

const descriptor = (capabilities: ProviderDescriptor['capabilities']): ProviderDescriptor => ({
  medium: CommunicationMedium.SMS,
  name: 'fake',
  label: { en: 'Fake SMS', bn: 'ফেক' },
  capabilities,
  fields: [],
  supportsTestMessage: true,
});

class FakeProvider extends MessagingProvider<Cfg> {
  readonly envPrefix = 'FAKE';
  constructor(
    readonly descriptor: ProviderDescriptor,
    balance?: () => Promise<{ amount: number }>,
  ) {
    super();
    if (balance) this.getBalance = balance;
  }
  send() {
    return Promise.resolve({
      success: true,
      providerMessageId: null,
      outcome: 'ACCEPTED' as const,
    });
  }
  // Public hook so the protected helper can be asserted.
  phone(to: string) {
    return this.normalizeBdPhone(to);
  }
}

describe('MessagingProvider default testConnection', () => {
  it('says connected but never shows the balance amount', async () => {
    // The config may be the platform's own account (no school block), so its balance is not shown.
    const p = new FakeProvider(descriptor(['balance']), async () => ({ amount: 42 }));
    const result = await p.testConnection({ k: 'x' });
    expect(result).toEqual({ success: true, message: 'Connected to Fake SMS.' });
    expect(result.message).not.toContain('42');
  });

  it('never echoes vendor text into the failure message (Rule 23)', async () => {
    const p = new FakeProvider(
      descriptor(['balance']),
      vi.fn().mockRejectedValue(new Error('vendor said secret-xyz')),
    );
    const result = await p.testConnection({ k: 'x' });
    expect(result).toEqual({ success: false, message: 'Could not reach Fake SMS.' });
    expect(result.message).not.toContain('secret-xyz');
  });

  it('a blocked destination gets a fixed sentence, never the submitted address', async () => {
    const err = new DestinationBlockedError('"10.0.0.5" is a private/reserved address.');
    const p = new FakeProvider(descriptor(['balance']), vi.fn().mockRejectedValue(err));
    const result = await p.testConnection({ k: 'x' });
    expect(result).toEqual({ success: false, message: err.publicMessage });
    expect(result.message).not.toContain('10.0.0.5');
  });

  it('an unresolvable destination gets its own fixed sentence', async () => {
    const err = new DestinationResolutionError('sms.private.example');
    const p = new FakeProvider(descriptor(['balance']), vi.fn().mockRejectedValue(err));
    const result = await p.testConnection({ k: 'x' });
    expect(result).toEqual({ success: false, message: err.publicMessage });
    expect(result.message).not.toContain('sms.private.example');
  });

  it('throws NotImplemented without the balance capability and no override', async () => {
    const p = new FakeProvider(descriptor([]));
    await expect(p.testConnection({ k: 'x' })).rejects.toBeInstanceOf(NotImplementedException);
  });
});

describe('MessagingProvider.normalizeBdPhone', () => {
  it('delegates to the shared phone helper', () => {
    expect(new FakeProvider(descriptor([])).phone('01712345678')).toBe('8801712345678');
  });
});
