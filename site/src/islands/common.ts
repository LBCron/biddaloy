// Shared by the events and routine islands (notices.ts predates it and keeps its own copy).
// The skeleton is in the HTML from the first byte, so a slow answer always shows it; once the
// answer is back it stays at least MIN_SKELETON_MS so it never flashes. The ticket's "1.2 s" is
// that skeleton rule, not a fetch deadline: a slow but healthy answer must still land, so the
// deadline is a separate, longer limit.
export const MIN_SKELETON_MS = 300;
export const FETCH_DEADLINE_MS = 8000;

export type L = string | { bn?: string; en?: string } | undefined;
export const text = (v: L, lang: string) =>
  typeof v === 'string' ? v : (lang === 'en' && v?.en) || v?.bn || '';

/** The rows of a same-origin island read, or `undefined` when it failed or was cancelled. Never throws. */
export async function loadRows<T>(
  path: string,
  cancel?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<T[] | undefined> {
  const started = Date.now();
  let rows: T[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Plain controller + timer: AbortSignal.any / .timeout are missing on older school-site WebViews.
    const ctl = new AbortController();
    timer = setTimeout(() => ctl.abort(), FETCH_DEADLINE_MS);
    if (cancel) {
      if (cancel.aborted) ctl.abort();
      else cancel.addEventListener('abort', () => ctl.abort(), { once: true });
    }
    const res = await fetchImpl(path, {
      headers: { accept: 'application/json' },
      signal: ctl.signal,
    });
    if (res.ok) {
      const body = (await res.json()) as T[] | { items?: T[] };
      rows = Array.isArray(body) ? body : (body.items ?? []);
    }
  } catch {
    /* the caller shows its error line */
  } finally {
    clearTimeout(timer);
  }
  await new Promise((r) => setTimeout(r, Math.max(0, MIN_SKELETON_MS - (Date.now() - started))));
  return rows;
}

/** Swaps the skeleton for the result: `ready` is the list element inside the island. */
export function settle(root: HTMLElement, ready: HTMLElement, message?: string) {
  if (message !== undefined) {
    ready.className = 'ready empty';
    ready.textContent = message;
  }
  root.removeAttribute('data-loading');
  root.setAttribute('aria-busy', 'false');
}
