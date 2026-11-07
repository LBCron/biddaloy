import { describe, expect, it, vi } from 'vitest';
import { sendEnquiry, stateAfterWidget } from './enquiry';
import bn from '../i18n/bn.json';
import en from '../i18n/en.json';

const body = { name: 'রহিম', phone: '01712345678', message: 'ভর্তি', captcha_token: 'tok' };
const reply = (status: number, json?: unknown) =>
  vi.fn(
    async () => new Response(json === undefined ? null : JSON.stringify(json), { status }),
  ) as unknown as typeof fetch;

describe('sendEnquiry', () => {
  it('posts JSON to the same-origin island route', async () => {
    const f = reply(201);
    await sendEnquiry(body, f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/_api/island/enquiry');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it.each([
    [201, undefined, 'success'],
    [400, { details: { code: 'CAPTCHA_FAILED' } }, 'captcha'],
    [400, { message: ['phone must match'] }, 'invalid'],
    [404, { message: 'x' }, 'closed'],
    [429, undefined, 'rate'],
    [500, undefined, 'error'],
    [503, undefined, 'error'],
  ])('status %s %j -> %s', async (status, json, state) => {
    expect(await sendEnquiry(body, reply(status, json))).toBe(state);
  });

  it('a dropped network is an error, not a throw', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await sendEnquiry(body, f)).toBe('error');
  });

  it('a 400 with an unreadable body is invalid', async () => {
    const f = vi.fn(async () => new Response('<html>', { status: 400 })) as unknown as typeof fetch;
    expect(await sendEnquiry(body, f)).toBe('invalid');
  });
});

describe('widget failure', () => {
  it('a blocked Turnstile script leaves the form unavailable, with its own sentence', () => {
    expect(stateAfterWidget(false)).toBe('unavailable');
    expect(stateAfterWidget(true)).toBe('idle');
    for (const d of [bn, en] as unknown as { enquiry: Record<string, string> }[]) {
      expect(d.enquiry.nokey).toBeTruthy();
    }
  });
});

describe('enquiry copy', () => {
  it.each(['submitting', 'success', 'captcha', 'invalid', 'closed', 'rate', 'error'])(
    'has a sentence in bn and en for %s',
    (state) => {
      for (const d of [bn, en] as unknown as { enquiry: Record<string, string> }[]) {
        expect(d.enquiry[state]).toBeTruthy();
      }
    },
  );
});
