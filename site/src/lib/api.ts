import type { FetchResult } from './types';

const BASE = () =>
  process.env.SITE_API_BASE ?? import.meta.env?.SITE_API_BASE ?? 'http://app:3000/api/v1';

interface Opts {
  preview?: string;
  fetchImpl?: typeof fetch;
  base?: string;
}

/**
 * One read from the public by-host API. Never throws: the caller maps the result to a page.
 * 404 `site.not_found` -> none; network error, timeout, 5xx -> down; 301 -> redirect (D34, D42).
 */
export async function fetchByHost<T>(
  host: string,
  path: string,
  { preview, fetchImpl = fetch, base = BASE() }: Opts = {},
): Promise<FetchResult<T>> {
  const q = preview ? `?preview=${encodeURIComponent(preview)}` : '';
  const url = `${base}/public/site/by-host/${encodeURIComponent(host)}/${path}${q}`;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(2000),
      headers: { accept: 'application/json' },
      redirect: 'manual',
    });
    if (res.status === 301 || res.status === 308) {
      const body = (await res.json().catch(() => null)) as { to?: string } | null;
      const to = body?.to ?? res.headers.get('location');
      return to ? { kind: 'redirect', to } : { kind: 'down' };
    }
    if (res.status === 404) return { kind: 'none' };
    if (!res.ok) return { kind: 'down' };
    return { kind: 'ok', data: (await res.json()) as T };
  } catch {
    return { kind: 'down' };
  }
}
