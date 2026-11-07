import { Injectable } from '@nestjs/common';
import { fetch } from 'undici';

/** Umami unreachable or answered something unusable. Callers degrade silently (D42). */
export class UmamiUnavailableError extends Error {}

const ID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Umami website API. The host is `UMAMI_API_URL`, operator config, never tenant-influenced; a
 * school only supplies its subdomain/host as JSON body text. Listed in REVIEWED_OUTBOUND.
 */
@Injectable()
export class UmamiClient {
  isConfigured(): boolean {
    return !!process.env.UMAMI_API_URL?.trim() && !!process.env.UMAMI_API_TOKEN?.trim();
  }

  private async call(method: string, path: string, body?: object): Promise<unknown> {
    const base = process.env.UMAMI_API_URL?.trim().replace(/\/+$/, '');
    if (!this.isConfigured() || !base) throw new UmamiUnavailableError('not configured');
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${process.env.UMAMI_API_TOKEN?.trim()}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new UmamiUnavailableError(`status ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      throw e instanceof UmamiUnavailableError ? e : new UmamiUnavailableError('request failed');
    }
  }

  async createWebsite(name: string, domain: string): Promise<string> {
    const r = (await this.call('POST', '/api/websites', { name, domain })) as { id?: unknown };
    if (typeof r?.id !== 'string' || !ID_RE.test(r.id)) throw new UmamiUnavailableError('bad id');
    return r.id;
  }

  async stats(id: string, startAt: number, endAt: number) {
    if (!ID_RE.test(id)) throw new UmamiUnavailableError('bad id');
    const r = (await this.call(
      'GET',
      `/api/websites/${id}/stats?startAt=${startAt}&endAt=${endAt}`,
    )) as { pageviews?: unknown; visitors?: unknown };
    // Umami v2 answers plain numbers, v1 `{ value }`.
    const n = (v: unknown) =>
      typeof v === 'number'
        ? v
        : typeof (v as { value?: unknown })?.value === 'number'
          ? (v as { value: number }).value
          : null;
    const pageviews = n(r?.pageviews);
    const visitors = n(r?.visitors);
    if (pageviews === null || visitors === null) throw new UmamiUnavailableError('bad stats');
    return { pageviews, visitors };
  }
}
