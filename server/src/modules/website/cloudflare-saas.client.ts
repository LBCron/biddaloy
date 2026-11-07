import { Injectable } from '@nestjs/common';
import { fetch } from 'undici';

/** Cloudflare unreachable, slow, or answered something we cannot trust. Callers leave state unchanged. */
export class CloudflareUnavailableError extends Error {}
/** Cloudflare refused this hostname (already exists, not allowed). Never carries Cloudflare's text. */
export class CloudflareRejectedError extends Error {
  /** Cloudflare's own text said the hostname does not exist (read, never passed on). */
  notFound = false;
}

export interface CfHostname {
  id: string;
  /** pending | active | pending_deletion | blocked | moved | deleted */
  status: string;
  ssl: { status: string; validation_records?: { txt_name?: string; txt_value?: string }[] };
  ownership_verification?: { name?: string; value?: string };
}

const HOST = 'https://api.cloudflare.com';
/** Cloudflare ids are 32 hex characters; anything else never reaches a URL path. */
const CF_ID_RE = /^[0-9a-f]{32}$/;
const ZONE_RE = /^[0-9a-f]{32}$/;

/**
 * Cloudflare for SaaS custom hostnames. Constant host `api.cloudflare.com`, token from operator
 * config: no user-influenced URL is ever fetched, so `pinned-http.ts` is not used (Rule 7). The
 * hostname a school types travels in the JSON body only. The token is only ever put in the
 * Authorization header; no error message or log line carries it or Cloudflare's response text.
 */
@Injectable()
export class CloudflareSaasClient {
  isConfigured(): boolean {
    const zone = process.env.CF_ZONE_ID?.trim() ?? '';
    return !!process.env.CF_SAAS_API_TOKEN?.trim() && ZONE_RE.test(zone);
  }

  private async call(method: string, path: string, body?: object): Promise<unknown> {
    const zone = process.env.CF_ZONE_ID?.trim() ?? '';
    if (!this.isConfigured()) throw new CloudflareUnavailableError('not configured');
    let res;
    try {
      res = await fetch(`${HOST}/client/v4/zones/${zone}/custom_hostnames${path}`, {
        method,
        headers: {
          authorization: `Bearer ${process.env.CF_SAAS_API_TOKEN?.trim()}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new CloudflareUnavailableError('request failed');
    }
    if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 403) {
      // 401/403 is an operator problem (bad token): the school can only "try later".
      await res.body?.cancel().catch(() => undefined);
      throw new CloudflareUnavailableError(`status ${res.status}`);
    }
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    type Answer = { success?: boolean; result?: unknown; errors?: { message?: unknown }[] };
    let json: Answer | null = null;
    try {
      json = (await res.json()) as Answer;
    } catch {
      throw new CloudflareUnavailableError('unreadable answer');
    }
    if (!res.ok || json?.success !== true) {
      const err = new CloudflareRejectedError(`status ${res.status}`);
      // Only a flag leaves this file; Cloudflare's wording is never kept or echoed (Rule 23).
      err.notFound = (json?.errors ?? []).some(
        (e) => typeof e?.message === 'string' && /not found|does not exist/i.test(e.message),
      );
      throw err;
    }
    return json.result;
  }

  private parse(result: unknown): CfHostname {
    const r = result as Partial<CfHostname> | null;
    if (!r || typeof r.id !== 'string' || !CF_ID_RE.test(r.id) || typeof r.status !== 'string') {
      throw new CloudflareUnavailableError('unexpected shape');
    }
    return {
      id: r.id,
      status: r.status,
      ssl: { status: r.ssl?.status ?? '', validation_records: r.ssl?.validation_records },
      ownership_verification: r.ownership_verification,
    };
  }

  async create(hostname: string): Promise<CfHostname> {
    const result = await this.call('POST', '', {
      hostname,
      ssl: { method: 'txt', type: 'dv' },
    });
    return this.parse(result);
  }

  /** `null` = Cloudflare no longer knows this id. */
  async get(id: string): Promise<CfHostname | null> {
    if (!CF_ID_RE.test(id)) return null;
    const result = await this.call('GET', `/${id}`);
    return result === null ? null : this.parse(result);
  }

  /** Lookup by name, to adopt a hostname whose create answer we never saw. `null` = none. */
  async findByHostname(hostname: string): Promise<CfHostname | null> {
    const result = await this.call('GET', `?hostname=${encodeURIComponent(hostname)}`);
    const hit = (Array.isArray(result) ? result : []).find(
      (r) => (r as { hostname?: unknown })?.hostname === hostname,
    );
    return hit ? this.parse(hit) : null;
  }

  /** A hostname already gone (404, or a 4xx saying it does not exist) counts as removed. */
  async remove(id: string): Promise<void> {
    if (!CF_ID_RE.test(id)) return;
    try {
      await this.call('DELETE', `/${id}`);
    } catch (e) {
      if (e instanceof CloudflareRejectedError && e.notFound) return;
      throw e;
    }
  }
}
