import { localDate } from '../../../common/time';

/** Rows fetched per query while exporting (Epic 8.15 [8.15.11]); the export itself stops at its own row cap. */
export const EXPORT_PAGE_SIZE = 1_000;

interface PagedResult<T> {
  data: T[];
  totalPages: number;
}

/**
 * Walks a paginated list endpoint page by page and yields one export row per
 * item. Because it calls the list's own query, every filter the screen offers
 * applies unchanged and an export can never disagree with the list. Reading
 * stops as soon as the consumer stops asking (the sync export abandons it at
 * its row cap), so a huge school never loads every page into memory.
 */
export async function* pagedRows<T>(
  fetchPage: (page: number, limit: number) => Promise<PagedResult<T>>,
  toRow: (item: T) => unknown[],
): AsyncGenerator<unknown[]> {
  for (let page = 1; ; page++) {
    const result = await fetchPage(page, EXPORT_PAGE_SIZE);
    for (const item of result.data) yield toRow(item);
    if (page >= result.totalPages || result.data.length === 0) return;
  }
}

/** A date or timestamp column as a school-calendar `YYYY-MM-DD` (a `date` column arrives as a string). */
export function exportDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value.slice(0, 10) : localDate(value);
}
