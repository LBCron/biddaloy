/**
 * [70.5.3] Reads a list to the end, one server page (100, Rule 5) at a time. Stops at
 * `MAX_PAGES` so a runaway total can never loop forever; `truncated` then says the list is cut.
 */
export const PAGE_SIZE = 100;
export const MAX_PAGES = 50; // 5,000 rows, far above one class

export interface AllPages<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

export async function fetchAllPages<T>(
  fetchPage: (offset: number) => Promise<{ items: T[]; total: number }>,
): Promise<AllPages<T>> {
  const items: T[] = [];
  let total = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await fetchPage(i * PAGE_SIZE);
    total = page.total;
    items.push(...page.items);
    if (page.items.length === 0 || items.length >= total) break;
  }
  return { items, total, truncated: items.length < total };
}

/**
 * Runs `task` over `list` with at most `limit` in flight. Never rejects: a failed item is
 * reported as `{ error }` so one bad item cannot drop the rest.
 */
export async function mapLimited<I, O>(
  list: readonly I[],
  limit: number,
  task: (item: I) => Promise<O>,
): Promise<Array<{ value: O } | { error: unknown }>> {
  const out: Array<{ value: O } | { error: unknown }> = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      try {
        out[i] = { value: await task(list[i] as I) };
      } catch (error) {
        out[i] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}
