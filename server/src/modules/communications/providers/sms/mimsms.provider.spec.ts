import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MimsmsProvider } from './mimsms.provider';
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

// send's connection-pinning mechanics (undici Client/lookup wiring,
// redirect: 'error', client cleanup) are their own unit under test in
// pinned-http.spec.ts — stub it out here so these tests only assert on
// gateway-level behavior.
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

describe('MimsmsProvider', () => {
  let gateway: MimsmsProvider;
  let fetchMock: ReturnType<typeof vi.fn>;
  let pinnedFetchMock: ReturnType<typeof vi.mocked<typeof fetchPinnedJson>>;

  beforeEach(() => {
    gateway = new MimsmsProvider();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    pinnedFetchMock = vi.mocked(fetchPinnedJson);
    pinnedFetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a POST request with the resolved config and normalized phone number', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', transaction_id: 'mim-1' });

    const result = await gateway.send(
      { to: '01712345678', body: 'hi' },
      {
        gateway: 'mimsms',
        apiKey: 'key-1',
        senderId: 'sender-1',
      },
    );

    const [, url, init] = pinnedFetchMock.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);

    expect(url).toBe('https://api.mimsms.com/api/SmsSending/SMS');
    expect(init!.method).toBe('POST');
    expect(body.api_key).toBe('key-1');
    expect(body.senderid).toBe('sender-1');
    expect(body.number).toBe('8801712345678');
    expect(result).toEqual({
      success: true,
      providerMessageId: 'mim-1',
      raw: { status: 'success', transaction_id: 'mim-1' },
      segments: 1,
      outcome: 'ACCEPTED',
    });
  });

  // [15.6.1] `result.segments` is what `CommunicationsProcessor` writes onto
  // `CommunicationLog.metadata.segments` — asserting it here locks the
  // gateway to the shared `countSmsSegments` calculator instead of the old
  // bare ASCII regex.
  it('reports the exact GSM-7 segment count for a plain-English message', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', transaction_id: 'mim-2' });

    const result = await gateway.send(
      { to: '01712345678', body: 'Dear guardian, fees are due.' },
      {
        gateway: 'mimsms',
        apiKey: 'key-1',
        senderId: 'sender-1',
      },
    );

    expect(result.segments).toBe(1);
    const [, , init] = pinnedFetchMock.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.type).toBe('text');
  });

  it('reports the exact UCS-2 segment count for a Bengali message', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', transaction_id: 'mim-3' });

    const result = await gateway.send(
      { to: '01712345678', body: 'প্রিয় অভিভাবক, আপনার সন্তানের ফি বকেয়া আছে।' },
      { gateway: 'mimsms', apiKey: 'key-1', senderId: 'sender-1' },
    );

    expect(result.segments).toBe(1);
    const [, , init] = pinnedFetchMock.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.type).toBe('unicode');
  });

  it('uses a tenant-configured apiUrl when given', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success' });

    await gateway.send(
      { to: '01712345678', body: 'hi' },
      {
        gateway: 'mimsms',
        apiKey: 'key-1',
        senderId: 'sender-1',
        apiUrl: 'https://custom.example.com/sms',
      },
    );

    const [, url] = pinnedFetchMock.mock.calls[0]!;
    expect(url).toBe('https://custom.example.com/sms');
  });

  it('returns success: false with a fixed sentence on API failure, never the vendor text', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'error', message: 'Invalid sender id' });

    const result = await gateway.send(
      { to: '01712345678', body: 'hi' },
      {
        gateway: 'mimsms',
        apiKey: 'key-1',
        senderId: 'sender-1',
      },
    );

    expect(result.success).toBe(false);
    // Rule 23: the fixed sentence; the vendor's own text stays only in `raw`.
    expect(result.error).toBe('MimSMS rejected the message.');
    expect(result.raw).toEqual({ status: 'error', message: 'Invalid sender id' });
    expect(result.outcome).toBe('REJECTED');
    expect(result.retryable).toBe(false);
  });

  it('returns success: false instead of throwing on a network error', async () => {
    // Rule 23: a fetch error can carry the request URL (and Greenweb's token in it).
    pinnedFetchMock.mockRejectedValue(new Error('network down https://gw.test/?token=key-1'));

    const result = await gateway.send(
      { to: '01712345678', body: 'hi' },
      {
        gateway: 'mimsms',
        apiKey: 'key-1',
        senderId: 'sender-1',
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Could not reach MimSMS; the message may or may not have been sent.');
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
      { gateway: 'mimsms', apiKey: 'key-1', senderId: 'sender-1' },
    );

    expect(result).toMatchObject({ success: false, outcome: 'AMBIGUOUS', retryable: false });
  });

  it('routes through the pinned dispatcher rather than a bare fetch', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', transaction_id: 'mim-1' });

    await gateway.send(
      { to: '01712345678', body: 'hi' },
      {
        gateway: 'mimsms',
        apiKey: 'key-1',
        senderId: 'sender-1',
      },
    );

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
        gateway: 'mimsms',
        apiKey: 'key-1',
        senderId: 'sender-1',
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
    const config = { gateway: 'mimsms', apiKey: 'key-1', senderId: 'sender-1' };
    const answer = (status: number, body: unknown) =>
      vi.mocked(fetchPinnedJsonWithStatus).mockResolvedValueOnce({ status, body });

    it('send: 401 -> REJECTED with the API key sentence, not retryable', async () => {
      answer(401, { status: 'error', message: 'Invalid api key key-1' });
      const r = await gateway.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({
        success: false,
        outcome: 'REJECTED',
        retryable: false,
        error: 'MimSMS rejected the API key.',
      });
    });

    it('send: 403 -> REJECTED with the API key sentence', async () => {
      answer(403, undefined);
      const r = await gateway.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({ outcome: 'REJECTED', error: 'MimSMS rejected the API key.' });
    });

    it('send: 404 HTML page (no JSON body) -> REJECTED', async () => {
      answer(404, undefined);
      const r = await gateway.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({
        outcome: 'REJECTED',
        retryable: false,
        error: 'MimSMS rejected the message.',
      });
    });

    it('send: 5xx whose JSON says status error -> AMBIGUOUS, never REJECTED (credit stays held)', async () => {
      answer(503, { status: 'error', message: 'Service unavailable' });
      const r = await gateway.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({
        success: false,
        outcome: 'AMBIGUOUS',
        error: 'Could not reach MimSMS; the message may or may not have been sent.',
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
  });

  describe('testConnection', () => {
    const cfg = { gateway: 'mimsms', apiKey: 'super-secret-key', senderId: 'sender-1' };
    const answer = (status: number, body: unknown) =>
      vi.mocked(fetchPinnedJsonWithStatus).mockResolvedValueOnce({ status, body });

    it('checks the account balance instead of sending an SMS', async () => {
      answer(200, { status: 'success', balance: 100 });

      const result = await gateway.testConnection(cfg);

      const [, url, options] = vi.mocked(fetchPinnedJsonWithStatus).mock.calls.at(-1)!;
      expect(url).toBe('https://api.mimsms.com/api/User/Balance?api_key=super-secret-key');
      expect(options?.method).toBe('GET');
      expect(result).toEqual({
        success: true,
        message: 'Connected — MimSMS account credentials verified.',
      });
    });

    it('reports an actionable message on a rejected key, never the raw payload', async () => {
      answer(200, { status: 'error', message: 'Invalid API key: super-secret-key' });

      const result = await gateway.testConnection(cfg);

      expect(result).toEqual({
        success: false,
        message: 'Authentication rejected — check the API key.',
      });
    });

    it.each([401, 403])('maps HTTP %i to an authentication rejection', async (status) => {
      answer(status, { status: 'error' });

      const result = await gateway.testConnection(cfg);

      expect(result.message).toBe('Authentication rejected — check the API key.');
    });

    it('treats a 5xx with a JSON error body as unreachable, not a bad key', async () => {
      answer(500, { status: 'error', message: 'Invalid API key: super-secret-key' });

      const result = await gateway.testConnection(cfg);

      expect(result).toEqual({ success: false, message: 'Could not reach the MimSMS API.' });
    });

    it('treats a 5xx with an HTML body as unreachable', async () => {
      answer(502, '<html>Bad gateway</html>');

      const result = await gateway.testConnection(cfg);

      expect(result.message).toBe('Could not reach the MimSMS API.');
    });

    it('treats a 429 (rate limited, no JSON body) as unreachable, not a bad key', async () => {
      answer(429, undefined);

      const result = await gateway.testConnection(cfg);

      expect(result).toEqual({ success: false, message: 'Could not reach the MimSMS API.' });
    });

    it('returns success: false instead of throwing on a network error or timeout', async () => {
      vi.mocked(fetchPinnedJsonWithStatus).mockRejectedValueOnce(new Error('network down'));

      const result = await gateway.testConnection(cfg);

      expect(result).toEqual({ success: false, message: 'Could not reach the MimSMS API.' });
    });
  });
});
