import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GreenwebProvider } from './greenweb.provider';
import {
  assertSafeHttpDestination,
  DestinationBlockedError,
} from '../shared/outbound-destination-guard';
import { fetchPinnedJson, fetchPinnedJsonWithStatus } from '../shared/pinned-http';

// Destination-class validation (real vs. private-network host) is its own
// unit under test in outbound-destination-guard.spec.ts, and does a real
// DNS lookup — stub it out here so these tests stay hermetic and fast.
// `assertSafeHttpDestination` echoes the input URL back as `url` so the
// "tenant-configured apiUrl" test below stays meaningful.
vi.mock('../shared/outbound-destination-guard', () => {
  class OutboundDestinationError extends Error {
    readonly publicMessage = 'This server address cannot be used — check it and try again.';
  }
  class DestinationBlockedError extends OutboundDestinationError {}
  return {
    assertSafeHttpDestination: vi.fn().mockImplementation(async (rawUrl: string) => ({
      url: new URL(rawUrl),
      addresses: [{ address: '203.0.113.5', family: 4 }],
    })),
    OutboundDestinationError,
    DestinationBlockedError,
  };
});

// The connection-pinning mechanics (undici Client/lookup wiring,
// redirect: 'error', client cleanup) are their own unit under test in
// pinned-http.spec.ts — stub it out here so these tests only assert on
// gateway-level behavior (routing through it vs. a bare fetch, request
// shape, response mapping).
// Cases that mock only the body (`fetchPinnedJson`) answer as HTTP 200; the status cases
// (#3320) mock `fetchPinnedJsonWithStatus` directly.
vi.mock('../shared/pinned-http', () => {
  const fetchPinnedJson = vi.fn();
  return {
    fetchPinnedJson,
    fetchPinnedJsonWithStatus: vi.fn(async (...args: unknown[]) => ({
      status: 200,
      body: await fetchPinnedJson(...args),
    })),
  };
});

describe('GreenwebProvider', () => {
  let gateway: GreenwebProvider;
  let fetchMock: ReturnType<typeof vi.fn>;
  let pinnedFetchMock: ReturnType<typeof vi.mocked<typeof fetchPinnedJson>>;

  beforeEach(() => {
    gateway = new GreenwebProvider();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    pinnedFetchMock = vi.mocked(fetchPinnedJson);
    pinnedFetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a GET request with the resolved config and normalized phone number', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', msgid: 'gw-1' });

    const result = await gateway.send(
      { to: '01712345678', body: 'hi' },
      {
        gateway: 'greenweb',
        apiKey: 'key-1',
      },
    );

    const [, url] = pinnedFetchMock.mock.calls[0]!;
    expect(url).toContain('token=key-1');
    expect(url).toContain('to=8801712345678');
    expect(result).toEqual({
      success: true,
      providerMessageId: 'gw-1',
      raw: { status: 'success', msgid: 'gw-1' },
      segments: 1,
      outcome: 'ACCEPTED',
    });
  });

  // [15.6.1] `result.segments` is what `CommunicationsProcessor` writes onto
  // `CommunicationLog.metadata.segments` — asserting it here locks the
  // gateway to the shared `countSmsSegments` calculator instead of the old
  // bare ASCII regex.
  it('reports the exact GSM-7 segment count for a plain-English message', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', msgid: 'gw-3' });

    const result = await gateway.send(
      { to: '01712345678', body: 'Dear guardian, fees are due.' },
      {
        gateway: 'greenweb',
        apiKey: 'key-1',
      },
    );

    expect(result.segments).toBe(1);
    const [, url] = pinnedFetchMock.mock.calls[0]!;
    expect(url).not.toContain('unicode=1');
  });

  it('reports the exact UCS-2 segment count for a Bengali message', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', msgid: 'gw-4' });

    const result = await gateway.send(
      { to: '01712345678', body: 'প্রিয় অভিভাবক, আপনার সন্তানের ফি বকেয়া আছে।' },
      { gateway: 'greenweb', apiKey: 'key-1' },
    );

    expect(result.segments).toBe(1);
    const [, url] = pinnedFetchMock.mock.calls[0]!;
    expect(url).toContain('unicode=1');
  });

  it('uses a tenant-configured apiUrl when given', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', msgid: 'gw-2' });

    await gateway.send(
      { to: '01712345678', body: 'hi' },
      {
        gateway: 'greenweb',
        apiKey: 'key-1',
        apiUrl: 'https://custom.example.com/api.php',
      },
    );

    const [, url] = pinnedFetchMock.mock.calls[0]!;
    expect(url).toMatch(/^https:\/\/custom\.example\.com\/api\.php\?/);
  });

  it('returns success: false with a fixed sentence on API failure, never the vendor text', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'error', error_msg: 'Insufficient balance' });

    const result = await gateway.send(
      { to: '01712345678', body: 'hi' },
      {
        gateway: 'greenweb',
        apiKey: 'key-1',
      },
    );

    expect(result.success).toBe(false);
    // Rule 23: the fixed sentence; the vendor's own text stays only in `raw`.
    expect(result.error).toBe('Greenweb rejected the message.');
    expect(result.raw).toEqual({ status: 'error', error_msg: 'Insufficient balance' });
    expect(result.outcome).toBe('REJECTED');
    expect(result.retryable).toBe(false);
  });

  it('returns success: false instead of throwing on a network error', async () => {
    // Rule 23: a fetch error can carry the request URL (and Greenweb's token in it).
    pinnedFetchMock.mockRejectedValue(new Error('network down https://gw.test/?token=key-1'));

    const result = await gateway.send(
      { to: '01712345678', body: 'hi' },
      {
        gateway: 'greenweb',
        apiKey: 'key-1',
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Could not reach Greenweb; the message may or may not have been sent.',
    );
    expect(result.error).not.toContain('key-1');
    expect(result.retryable).toBeUndefined();
    expect(result.segments).toBe(1);
  });

  // Review round 2 on #3347: a 2xx whose body is not JSON means the vendor answered and may have
  // sent the SMS. It stays AMBIGUOUS (credit held) and is never retried: a retry could send twice.
  it('a 2xx body that is not JSON -> AMBIGUOUS and not retried', async () => {
    pinnedFetchMock.mockRejectedValue(new SyntaxError('Unexpected token < in JSON'));

    const result = await gateway.send(
      { to: '01712345678', body: 'hi' },
      { gateway: 'greenweb', apiKey: 'key-1' },
    );

    expect(result).toMatchObject({ success: false, outcome: 'AMBIGUOUS', retryable: false });
  });

  it('routes through the pinned dispatcher rather than a bare fetch', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', msgid: 'gw-1' });

    await gateway.send({ to: '01712345678', body: 'hi' }, { gateway: 'greenweb', apiKey: 'key-1' });

    expect(pinnedFetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks a destination-blocked failure as non-retryable', async () => {
    vi.mocked(assertSafeHttpDestination).mockRejectedValueOnce(
      new DestinationBlockedError('"10.0.0.5" is a private/reserved address.'),
    );

    const result = await gateway.send(
      { to: '01712345678', body: 'hi' },
      {
        gateway: 'greenweb',
        apiKey: 'key-1',
      },
    );

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    // Review round 2, item 3: the fixed sentence, never the guard's text with the address.
    expect(result.error).toBe('This server address cannot be used — check it and try again.');
    expect(result.error).not.toContain('10.0.0.5');
  });

  // #3320: the HTTP status decides before the body. REJECTED releases the SMS credit; AMBIGUOUS
  // keeps it held (the message may have gone out), so getting these wrong moves money.
  describe('HTTP status (#3320)', () => {
    const config = { gateway: 'greenweb', apiKey: 'key-1' };
    const answer = (status: number, body: unknown) =>
      vi.mocked(fetchPinnedJsonWithStatus).mockResolvedValueOnce({ status, body });

    it('send: 401 -> REJECTED with the API key sentence, not retryable', async () => {
      answer(401, { status: 'error', error_msg: 'Invalid token key-1' });
      const r = await gateway.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({
        success: false,
        outcome: 'REJECTED',
        retryable: false,
        error: 'Greenweb rejected the API key.',
      });
    });

    it('send: 403 -> REJECTED with the API key sentence', async () => {
      answer(403, undefined);
      const r = await gateway.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({ outcome: 'REJECTED', error: 'Greenweb rejected the API key.' });
    });

    it('send: 404 HTML page (no JSON body) -> REJECTED', async () => {
      answer(404, undefined);
      const r = await gateway.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({
        outcome: 'REJECTED',
        retryable: false,
        error: 'Greenweb rejected the message.',
      });
    });

    it('send: 5xx whose JSON says status error -> AMBIGUOUS, never REJECTED (credit stays held)', async () => {
      answer(500, { status: 'error', error_msg: 'Internal error' });
      const r = await gateway.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({
        success: false,
        outcome: 'AMBIGUOUS',
        error: 'Could not reach Greenweb; the message may or may not have been sent.',
      });
      // Review round 1 on #3347: a vendor that may have sent is never sent to again (no double
      // SMS, no double vendor charge). The credit stays held for reconciliation.
      expect(r.retryable).toBe(false);
    });

    it('send: a timeout -> AMBIGUOUS', async () => {
      vi.mocked(fetchPinnedJsonWithStatus).mockRejectedValueOnce(
        new DOMException('timed out', 'TimeoutError'),
      );
      const r = await gateway.send({ to: '01712345678', body: 'hi' }, config);
      expect(r.outcome).toBe('AMBIGUOUS');
    });

    it('testConnection: a 404 (mistyped API address) says to check the address, not the token', async () => {
      answer(404, undefined);
      await expect(gateway.testConnection(config)).resolves.toEqual({
        success: false,
        message: 'Greenweb did not accept the request — check the API address.',
      });
    });

    it('testConnection: 401 still names the token', async () => {
      answer(401, { status: 'error', error_msg: 'Invalid token key-1' });
      await expect(gateway.testConnection(config)).resolves.toEqual({
        success: false,
        message: 'Authentication rejected — check the account token.',
      });
    });

    it('testConnection: 5xx says "could not reach", not "authentication rejected"', async () => {
      answer(502, undefined);
      await expect(gateway.testConnection(config)).resolves.toEqual({
        success: false,
        message: 'Could not reach the Greenweb API.',
      });
    });
  });

  describe('testConnection', () => {
    it('checks the account balance instead of sending an SMS', async () => {
      pinnedFetchMock.mockResolvedValue({ status: 'success', balance: 100 });

      const result = await gateway.testConnection({
        gateway: 'greenweb',
        apiKey: 'super-secret-key',
      });

      const [, url] = pinnedFetchMock.mock.calls[0]!;
      expect(url).toContain('type=balance');
      expect(url).toContain('token=super-secret-key');
      expect(url).not.toContain('to=');
      expect(url).not.toContain('message=');
      expect(result).toEqual({
        success: true,
        message: 'Connected — Greenweb account token verified.',
      });
    });

    it('reports an actionable message on failure, never the raw payload', async () => {
      pinnedFetchMock.mockResolvedValue({
        status: 'error',
        error_msg: 'Invalid token: super-secret-key',
      });

      const result = await gateway.testConnection({
        gateway: 'greenweb',
        apiKey: 'super-secret-key',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Authentication rejected — check the account token.');
      expect(result.message).not.toContain('super-secret-key');
    });

    it('returns success: false instead of throwing on a network error', async () => {
      pinnedFetchMock.mockRejectedValue(new Error('network down'));

      const result = await gateway.testConnection({ gateway: 'greenweb', apiKey: 'key-1' });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not reach the Greenweb API.');
    });

    it('routes through the pinned dispatcher rather than a bare fetch', async () => {
      pinnedFetchMock.mockResolvedValue({ status: 'success', balance: 100 });

      await gateway.testConnection({ gateway: 'greenweb', apiKey: 'key-1' });

      expect(pinnedFetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
