import { describe, expect, it, vi } from 'vitest';
import { EXPORT_PAGE_SIZE, exportDate, pagedRows } from './paged-rows';

const collect = async (gen: AsyncGenerator<unknown[]>) => {
  const out: unknown[][] = [];
  for await (const row of gen) out.push(row);
  return out;
};

describe('pagedRows', () => {
  it('yields the rows of every page in order and asks for the export page size', async () => {
    const pages = [{ data: ['a', 'b'] }, { data: ['c'] }];
    const fetchPage = vi.fn(async (page: number) => ({
      data: pages[page - 1].data,
      totalPages: 2,
    }));

    const rows = await collect(pagedRows(fetchPage, (x) => [x]));

    expect(rows).toEqual([['a'], ['b'], ['c']]);
    expect(fetchPage.mock.calls).toEqual([
      [1, EXPORT_PAGE_SIZE],
      [2, EXPORT_PAGE_SIZE],
    ]);
  });

  it('stops after a single page', async () => {
    const fetchPage = vi.fn(async () => ({ data: ['a'], totalPages: 1 }));
    expect(await collect(pagedRows(fetchPage, (x) => [x]))).toEqual([['a']]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('yields nothing and stops on an empty result', async () => {
    const fetchPage = vi.fn(async () => ({ data: [] as string[], totalPages: 5 }));
    expect(await collect(pagedRows(fetchPage, (x) => [x]))).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('exportDate', () => {
  it('cuts a date-column string to YYYY-MM-DD', () => {
    expect(exportDate('2026-03-04T00:00:00.000Z')).toBe('2026-03-04');
  });

  it('formats a Date as a school-calendar day', () => {
    expect(exportDate(new Date('2026-03-04T06:00:00.000Z'))).toBe('2026-03-04');
  });

  it('is empty for null and undefined', () => {
    expect(exportDate(null)).toBe('');
    expect(exportDate(undefined)).toBe('');
  });
});
