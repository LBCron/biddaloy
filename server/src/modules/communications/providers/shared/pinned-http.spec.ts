import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookup as dnsLookup } from 'node:dns/promises';
import { createPinnedLookup, fetchPinnedJson, fetchPinnedJsonWithStatus } from './pinned-http';
import type { SafeHttpDestination } from './outbound-destination-guard';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

// `vi.mock` factories are hoisted above imports/const declarations, so the
// mocks it returns must themselves be created inside `vi.hoisted` rather
// than referenced from module-scope consts declared below.
const { ClientMock, fetchMock, destroy } = vi.hoisted(() => {
  const destroy = vi.fn().mockResolvedValue(undefined);
  // `pinned-http.ts` calls `new Client(...)` — Vitest 4 only treats a mock
  // implementation as constructible when it's an actual `function`, not an
  // arrow function (arrow functions were never constructible in real JS
  // either; Vitest 3's mock just didn't enforce that).
  const ClientMock = vi.fn().mockImplementation(function ClientMock() {
    return { destroy };
  });
  const fetchMock = vi.fn();
  return { ClientMock, fetchMock, destroy };
});

vi.mock('undici', () => ({
  Client: ClientMock,
  fetch: fetchMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createPinnedLookup', () => {
  const addresses = [
    { address: '203.0.113.5', family: 4 },
    { address: '2001:db8::1', family: 6 },
  ];

  it('answers from the pinned list regardless of the hostname asked about, never touching real DNS', () => {
    const lookup = createPinnedLookup(addresses);
    const callback = vi.fn();

    lookup('totally-unrelated-hostname.example', { family: 4 }, callback);

    expect(callback).toHaveBeenCalledWith(null, '203.0.113.5', 4);
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it('filters by requested family (4)', () => {
    const lookup = createPinnedLookup(addresses);
    const callback = vi.fn();
    lookup('h', { family: 4, all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '203.0.113.5', family: 4 }]);
  });

  it('filters by requested family (6)', () => {
    const lookup = createPinnedLookup(addresses);
    const callback = vi.fn();
    lookup('h', { family: 6, all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '2001:db8::1', family: 6 }]);
  });

  it('accepts the "IPv4"/"IPv6" string family aliases', () => {
    const lookup = createPinnedLookup(addresses);
    const callback = vi.fn();
    lookup('h', { family: 'IPv4', all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '203.0.113.5', family: 4 }]);
  });

  it('returns every pinned address, unfiltered, when family is 0/unspecified and all is requested', () => {
    const lookup = createPinnedLookup(addresses);
    const callback = vi.fn();
    lookup('h', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, addresses);
  });

  it('calls back with an ENOTFOUND error when the requested family has no pinned match', () => {
    const lookup = createPinnedLookup([{ address: '203.0.113.5', family: 4 }]);
    const callback = vi.fn();
    lookup('h', { family: 6 }, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    const [err, address] = callback.mock.calls[0]!;
    expect(err).toMatchObject({ code: 'ENOTFOUND' });
    expect(address).toEqual([]);
    expect(dnsLookup).not.toHaveBeenCalled();
  });
});

describe('fetchPinnedJson', () => {
  function destination(overrides: Partial<SafeHttpDestination> = {}): SafeHttpDestination {
    return {
      url: new URL('https://api.example.com/v1'),
      addresses: [{ address: '203.0.113.5', family: 4 }],
      ...overrides,
    };
  }

  it('builds a Client pinned to the destination origin and fetches with it as the dispatcher', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await fetchPinnedJson(destination(), 'https://api.example.com/v1?token=abc', {
      method: 'GET',
    });

    expect(result).toEqual({ ok: true });
    expect(ClientMock).toHaveBeenCalledWith(
      'https://api.example.com',
      expect.objectContaining({
        connect: expect.objectContaining({ lookup: expect.any(Function) }),
      }),
    );
    const [requestUrl, init] = fetchMock.mock.calls[0]!;
    expect(requestUrl).toBe('https://api.example.com/v1?token=abc');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(init.dispatcher).toEqual({ destroy });
  });

  it('wires the constructed lookup to answer from the destination addresses', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) });

    await fetchPinnedJson(destination(), 'https://api.example.com/v1');

    const [, options] = ClientMock.mock.calls[0]!;
    const callback = vi.fn();
    options.connect.lookup('irrelevant-hostname', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '203.0.113.5', family: 4 }]);
  });

  it('destroys the client after a successful fetch', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) });
    await fetchPinnedJson(destination(), 'https://api.example.com/v1');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the client even when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(fetchPinnedJson(destination(), 'https://api.example.com/v1')).rejects.toThrow(
      'network down',
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the client even when .json() rejects', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error('bad json')),
    });
    await expect(fetchPinnedJson(destination(), 'https://api.example.com/v1')).rejects.toThrow(
      'bad json',
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects a requestUrl whose origin differs from the validated destination, before touching Client or fetch', async () => {
    await expect(fetchPinnedJson(destination(), 'https://attacker.example.com/v1')).rejects.toThrow(
      /origin/,
    );
    expect(ClientMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still throws when an error page (non-2xx) is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
    });
    await expect(fetchPinnedJson(destination(), 'https://api.example.com/v1')).rejects.toThrow();
  });
});

// #3320: the SMS providers decide on the HTTP status before the body (401 vs 5xx move credit).
describe('fetchPinnedJsonWithStatus', () => {
  const destination: SafeHttpDestination = {
    url: new URL('https://api.example.com/v1'),
    addresses: [{ address: '203.0.113.5', family: 4 }],
  };

  it('returns the status with the parsed body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ message: 'Unauthenticated.' }),
    });
    await expect(
      fetchPinnedJsonWithStatus(destination, 'https://api.example.com/v1'),
    ).resolves.toEqual({ status: 401, body: { message: 'Unauthenticated.' } });
  });

  it('an error page that is not JSON (404 HTML) still returns its status, body undefined', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
    });
    await expect(
      fetchPinnedJsonWithStatus(destination, 'https://api.example.com/v1'),
    ).resolves.toEqual({ status: 404, body: undefined });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('a 2xx whose body is not JSON still throws (the send may have gone out: never read as a refusal)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('bad json')),
    });
    await expect(
      fetchPinnedJsonWithStatus(destination, 'https://api.example.com/v1'),
    ).rejects.toThrow('bad json');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the same origin check and pinning as fetchPinnedJson', async () => {
    await expect(
      fetchPinnedJsonWithStatus(destination, 'https://attacker.example.com/v1'),
    ).rejects.toThrow(/origin/);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) });
    await fetchPinnedJsonWithStatus(destination, 'https://api.example.com/v1', { method: 'GET' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(init.dispatcher).toEqual({ destroy });
  });
});
