// Shared by the events and routine islands (notices.ts predates it and keeps its own copy).
const MIN_SKELETON_MS = 300;
const MAX_WAIT_MS = 1200;

export type L = string | { bn?: string; en?: string } | undefined;
export const text = (v: L, lang: string) =>
  typeof v === 'string' ? v : (lang === 'en' && v?.en) || v?.bn || '';

/** The rows of a same-origin island read, or `undefined` when it failed. Never throws. */
export async function loadRows<T>(path: string): Promise<T[] | undefined> {
  const started = Date.now();
  let rows: T[] | undefined;
  try {
    const res = await fetch(path, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(MAX_WAIT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as T[] | { items?: T[] };
      rows = Array.isArray(body) ? body : (body.items ?? []);
    }
  } catch {
    /* the caller shows its error line */
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
