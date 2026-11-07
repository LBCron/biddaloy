import { describe, expect, it, vi } from 'vitest';
import { FETCH_DEADLINE_MS, MIN_SKELETON_MS, loadRows } from './common';

const ok = (rows: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;

describe('loadRows', () => {
  it('the fetch deadline is far longer than the skeleton minimum (a slow answer still lands)', () => {
    expect(FETCH_DEADLINE_MS).toBeGreaterThanOrEqual(5000);
    expect(MIN_SKELETON_MS).toBeLessThan(FETCH_DEADLINE_MS);
  });

  it('reads an array or { items }', async () => {
    expect(await loadRows('/x', undefined, ok([1]))).toEqual([1]);
    expect(await loadRows('/x', undefined, ok({ items: [2] }))).toEqual([2]);
  });

  it('a non-200 or a thrown fetch is undefined, not a throw', async () => {
    const bad = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    expect(await loadRows('/x', undefined, bad)).toBeUndefined();
    const boom = vi.fn(async () => {
      throw new Error('x');
    }) as unknown as typeof fetch;
    expect(await loadRows('/x', undefined, boom)).toBeUndefined();
  });

  it('a cancelled read (newer pick) is undefined and its signal reaches fetch', async () => {
    const c = new AbortController();
    const f = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init.signal!.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const p = loadRows('/x', c.signal, f);
    c.abort();
    expect(await p).toBeUndefined();
  });
});
