import { describe, expect, it } from 'vitest';

import { fetchAllPages, MAX_PAGES, mapLimited, PAGE_SIZE } from './-fetch-all';

describe('fetchAllPages', () => {
  it('pages until every row is read', async () => {
    const all = Array.from({ length: 250 }, (_, i) => i);
    const offsets: number[] = [];
    const r = await fetchAllPages((offset) => {
      offsets.push(offset);
      return Promise.resolve({ items: all.slice(offset, offset + PAGE_SIZE), total: all.length });
    });
    expect(r.items).toHaveLength(250);
    expect(r.truncated).toBe(false);
    expect(offsets).toEqual([0, 100, 200]);
  });

  it('stops at the page cap and says the list is cut', async () => {
    let calls = 0;
    const r = await fetchAllPages(() => {
      calls++;
      return Promise.resolve({
        items: Array.from({ length: PAGE_SIZE }, () => 1),
        total: 1_000_000,
      });
    });
    expect(calls).toBe(MAX_PAGES);
    expect(r.truncated).toBe(true);
  });
});

describe('mapLimited', () => {
  it('never runs more than the limit at once and keeps failures as rows', async () => {
    let live = 0;
    let peak = 0;
    const r = await mapLimited([1, 2, 3, 4, 5, 6], 2, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((res) => setTimeout(res, 2));
      live--;
      if (n === 3) throw new Error('x');
      return n;
    });
    expect(peak).toBe(2);
    expect(r.map((x) => ('value' in x ? x.value : 'err'))).toEqual([1, 2, 'err', 4, 5, 6]);
  });
});
