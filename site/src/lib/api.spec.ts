import { describe, expect, it, vi } from 'vitest';
import { fetchByHost } from './api';

const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers }),
  );
const call = (f: typeof fetch, preview?: string) =>
  fetchByHost('a.example', 'manifest', { fetchImpl: f, base: 'http://api', preview });

describe('fetchByHost', () => {
  it('200 -> ok, with timeout signal and json accept', async () => {
    const f = vi.fn(() => res(200, { x: 1 }));
    expect(await call(f as never)).toEqual({ kind: 'ok', data: { x: 1 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/public/site/by-host/a.example/manifest');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ accept: 'application/json' });
  });
  it('404 -> none', async () =>
    expect(await call((() => res(404, { code: 'site.not_found' })) as never)).toEqual({
      kind: 'none',
    }));
  it('5xx -> down', async () =>
    expect(await call((() => res(500)) as never)).toEqual({ kind: 'down' }));
  it('network error -> down', async () =>
    expect(await call((() => Promise.reject(new Error('boom'))) as never)).toEqual({
      kind: 'down',
    }));
  it('timeout -> down', async () =>
    expect(
      await call((() => Promise.reject(new DOMException('t', 'TimeoutError'))) as never),
    ).toEqual({ kind: 'down' }));
  it('301 -> redirect to body.to or Location', async () => {
    expect(await call((() => res(301, { to: 'new.example' })) as never)).toEqual({
      kind: 'redirect',
      to: 'new.example',
    });
    expect(await call((() => res(301, undefined, { location: 'n2.example' })) as never)).toEqual({
      kind: 'redirect',
      to: 'n2.example',
    });
  });
  it('forwards the preview token', async () => {
    const f = vi.fn(() => res(200, {}));
    await call(f as never, 'tok en');
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain('?preview=tok%20en');
  });
});
