import { describe, it, expect, vi } from 'vitest';
import { CommunicationMedium } from '@biddaloy/shared';
import { problemWith } from './messaging-settings.validator';

vi.mock(
  '../../communications/providers/messaging-providers',
  () => import('./testing/messaging-stubs.fixture'),
);

const SMS = CommunicationMedium.SMS;
const WA = CommunicationMedium.WHATSAPP;
const okSms = { provider: 'alpha', alpha: { apiKey: 'k', senderId: 's' } };
const okWa = { solo: { phoneNumberId: '1', accessToken: 'x' } };

describe('problemWith', () => {
  it('accepts a valid nested block per provider', () => {
    expect(problemWith(okSms, SMS)).toBeNull();
    expect(problemWith({ provider: 'beta', beta: { token: 't' } }, SMS)).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(problemWith('x', SMS)).toMatch(/must be an object/);
    expect(problemWith([], SMS)).toMatch(/must be an object/);
  });

  it('rejects an unknown provider and a foreign top-level key', () => {
    expect(problemWith({ provider: 'nope', alpha: okSms.alpha }, SMS)).toMatch(/not available/);
    expect(problemWith({ ...okSms, rogue: {} }, SMS)).toMatch(/setting this channel does not use/);
  });

  it('rejects a foreign field key and prototype keys', () => {
    expect(problemWith({ provider: 'alpha', alpha: { ...okSms.alpha, x: '1' } }, SMS)).toMatch(
      /field this company does not use/,
    );
    expect(problemWith({ ...okSms, constructor: {} }, SMS)).not.toBeNull();
    expect(problemWith(JSON.parse('{"__proto__":{"a":1}}'), SMS)).not.toBeNull();
  });

  it('accepts the flat shape for a sole provider and rejects flat + nested', () => {
    expect(problemWith({ phoneNumberId: '1', accessToken: 'x' }, WA)).toBeNull();
    expect(problemWith({ ...okWa, phoneNumberId: '1' }, WA)).toMatch(/mixes the old flat layout/);
  });

  it('needs provider when the medium has several, not when it has one', () => {
    expect(problemWith({ alpha: okSms.alpha }, SMS)).toMatch(/must say which company/);
    expect(problemWith(okWa, WA)).toBeNull();
  });

  it('ignores an incomplete block of a company that is not chosen (a saved draft)', () => {
    // alpha is missing its required senderId, but beta is the chosen company.
    const value = { provider: 'beta', beta: { token: 't' }, alpha: { apiKey: 'k' } };
    expect(problemWith(value, SMS)).toBeNull();
    // Its field shapes are still checked.
    expect(problemWith({ ...value, alpha: { senderId: 5, apiUrl: 7 } }, SMS)).toMatch(
      /must be text/,
    );
  });

  it('needs the chosen provider block', () => {
    expect(problemWith({ provider: 'alpha' }, SMS)).toMatch(/must include the settings/);
  });

  // Review round 3, item 2: a PLATFORM-metered school uses the platform's account, so it saves no
  // gateway of its own. A block it does fill in is its own gateway and must be complete.
  it('PLATFORM metering: no block (or an empty one) is fine; a started block must be complete', () => {
    expect(problemWith({ provider: 'alpha', metering: 'PLATFORM' }, SMS)).toBeNull();
    expect(problemWith({ provider: 'alpha', metering: 'PLATFORM', alpha: {} }, SMS)).toBeNull();
    expect(problemWith({ provider: 'alpha', metering: 'OFF' }, SMS)).toMatch(/must include/);
    expect(
      problemWith({ provider: 'alpha', metering: 'PLATFORM', alpha: { apiKey: 'k' } }, SMS),
    ).toMatch(/missing the required field senderId/);
  });

  it('requires non-secret required fields, not secret ones', () => {
    expect(problemWith({ provider: 'alpha', alpha: { apiKey: 'k' } }, SMS)).toMatch(
      /missing the required field senderId/,
    );
    expect(problemWith({ provider: 'alpha', alpha: { apiKey: 'k', senderId: '' } }, SMS)).toMatch(
      /missing the required field senderId/,
    );
    // omitted required secret = keep the stored one
    expect(problemWith({ provider: 'alpha', alpha: { senderId: 's' } }, SMS)).toBeNull();
  });

  it('secret: null clears, empty string gets the D31 sentence, other types rejected', () => {
    const with_ = (apiKey: unknown) => ({ provider: 'alpha', alpha: { apiKey, senderId: 's' } });
    expect(problemWith(with_(null), SMS)).toBeNull();
    expect(problemWith(with_(''), SMS)).toBe(
      'apiKey must not be empty: leave it out to keep the saved value, or send null to clear it.',
    );
    expect(problemWith(with_(5), SMS)).toBe('apiKey must be text.');
  });

  it('non-secret: number only for text kind', () => {
    const with_ = (k: string, v: unknown) => ({
      provider: 'alpha',
      alpha: { apiKey: 'k', senderId: 's', [k]: v },
    });
    expect(problemWith(with_('apiUrl', 5), SMS)).toBe('apiUrl must be text.');
    expect(problemWith({ solo: { ...okWa.solo, port: 587 } }, WA)).toBeNull();
  });

  // #3331: null is how the form clears a saved optional field (the merge then removes the key).
  // A required field cannot be cleared this way, on the chosen company or a draft.
  it('non-secret null: accepted for an optional field, refused for a required one', () => {
    const alpha = (extra: object) => ({
      provider: 'alpha',
      alpha: { apiKey: 'k', senderId: 's', ...extra },
    });
    expect(problemWith(alpha({ apiUrl: null }), SMS)).toBeNull();
    expect(problemWith({ solo: { ...okWa.solo, port: null } }, WA)).toBeNull();
    expect(problemWith(alpha({ senderId: null }), SMS)).toBe(
      'senderId is required and cannot be cleared.',
    );
    expect(
      problemWith(
        { ...okSms, provider: 'beta', beta: { token: 't' }, alpha: { senderId: null } },
        SMS,
      ),
    ).toBe('senderId is required and cannot be cleared.');
  });

  // #3338: a PLATFORM school removing its own key (null) owns nothing, so the save is accepted
  // (the resolver then sends on the platform account, see messaging-config.resolver.spec).
  it('PLATFORM: a block of nulls owns nothing and is accepted', () => {
    expect(
      problemWith(
        { provider: 'alpha', metering: 'PLATFORM', alpha: { apiKey: null, apiUrl: null } },
        SMS,
      ),
    ).toBeNull();
  });

  // Review round 1 on #3347: the same ownership rule as the resolver and the #3339 migration. Only
  // the chosen company's own block counts; a draft for another company is not checked as complete.
  it('PLATFORM: an empty chosen block next to another company draft owns nothing and is accepted', () => {
    expect(
      problemWith(
        { provider: 'beta', metering: 'PLATFORM', beta: {}, alpha: { senderId: 'DRAFT' } },
        SMS,
      ),
    ).toBeNull();
    // The chosen block started: it must be complete, the draft does not matter.
    expect(
      problemWith(
        { provider: 'alpha', metering: 'PLATFORM', alpha: { apiKey: 'k' }, beta: {} },
        SMS,
      ),
    ).toMatch(/missing the required field senderId/);
  });

  // #3338: a school whose company has a required text field (senderId) can still remove
  // everything it saved, and so get back to the platform account.
  it('remove saved details: provider null with null company blocks is accepted; anything else is not', () => {
    expect(problemWith({ provider: null, alpha: null, beta: null }, SMS)).toBeNull();
    expect(
      problemWith({ provider: null, alpha: null, beta: null, metering: 'PLATFORM' }, SMS),
    ).toBeNull();
    expect(problemWith({ solo: null }, WA)).toBeNull();
    expect(problemWith({ provider: null, alpha: { senderId: 's' } }, SMS)).toBe(
      'removes the saved company, so every other value sent must be null.',
    );
    expect(problemWith({ provider: null, metering: 'X' }, SMS)).toMatch(/OFF or PLATFORM/);
    expect(problemWith({ provider: null, rogue: null }, SMS)).toMatch(/does not use/);
    // A company block null without provider null is not a removal.
    expect(problemWith({ provider: 'alpha', alpha: null }, SMS)).not.toBeNull();
  });

  // Review round 2 on #3347: a removal that leaves a company block saved is not a removal. The
  // merge would delete only `provider`, and the resolver could still send on the saved block.
  it('remove saved details: a removal that leaves out a company block is rejected', () => {
    const missingBlock =
      'removes the saved company, so every company block must be sent as null too.';
    expect(problemWith({ provider: null }, SMS)).toBe(missingBlock);
    expect(problemWith({ provider: null, alpha: null }, SMS)).toBe(missingBlock);
    expect(problemWith({ provider: null, alpha: null, metering: 'PLATFORM' }, SMS)).toBe(
      missingBlock,
    );
  });

  // #3322: a port field must be a real TCP port, or the save would store a config that never sends.
  it('port: 1-65535 digits (string or number) or blank; anything else is rejected', () => {
    const withPort = (port: unknown) => ({ solo: { ...okWa.solo, port } });
    for (const ok of ['587', 465, '1', '65535', '']) {
      expect(problemWith(withPort(ok), WA)).toBeNull();
    }
    for (const bad of ['abc', '70000', 70000, '0', 0, '-1', '58.7', 58.7, ' 587', '1e3']) {
      expect(problemWith(withPort(bad), WA)).toBe('port must be a whole number from 1 to 65535.');
    }
  });

  it('metering: allowed on SMS only, OFF or PLATFORM only', () => {
    expect(problemWith({ ...okSms, metering: 'PLATFORM' }, SMS)).toBeNull();
    expect(problemWith({ ...okSms, metering: 'X' }, SMS)).toMatch(/OFF or PLATFORM/);
    // money rule: a tenant must not switch on platform WhatsApp keys
    expect(problemWith({ ...okWa, metering: 'PLATFORM' }, WA)).toMatch(/does not use/);
  });

  it('never echoes a submitted value or key', () => {
    const bodies = [
      { provider: 'EVIL-123' },
      { 'EVIL-123': {} },
      { provider: 'alpha', alpha: { 'EVIL-123': 'EVIL-123' } },
      { provider: 'alpha', alpha: { apiKey: 'k', senderId: 'EVIL-123', apiUrl: 5 } },
      { provider: 'alpha', metering: 'EVIL-123', alpha: okSms.alpha },
      { phoneNumberId: 'EVIL-123', 'EVIL-123': 1 },
    ];
    for (const body of bodies) {
      for (const m of [SMS, WA]) {
        expect(problemWith(body, m) ?? '').not.toContain('EVIL-123');
      }
    }
  });
});
