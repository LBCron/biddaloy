import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { SiteIslandKind } from '@biddaloy/shared';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';

export const SITE_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const SITE_FEED_TTL_SECONDS = 60;
/**
 * Feed keys with a fixed name, so one DEL covers them. `routine:<section>` is per class section
 * and is left to its 60 s expiry rather than scanned for.
 */
const FEED_KEYS = [
  ...Object.values(SiteIslandKind),
  'teachers',
  'teachers:home',
  'blog',
  'fees',
  'admissions',
];
/** At most one error log per this window, so a Redis outage does not flood the log. */
const LOG_EVERY_MS = 60_000;

/**
 * Published-site cache on the shared fail-fast Redis client. Content keys carry the site
 * `version`, so a publish makes the old keys unreachable (they expire on their own); feeds
 * change without a publish, so they live 60 s under their own key (one per `SiteIslandKind`).
 * Redis down (D32, D42): the loader runs and the page is still served. Never a 500.
 * Cached values must be JSON-safe.
 */
@Injectable()
export class SiteCacheService {
  private readonly logger = new Logger(SiteCacheService.name);
  private lastLogged = 0;

  constructor(@Inject(TENANT_STATUS_REDIS) private readonly redis: Redis) {}

  contentKey(tenantId: string, version: number, kind: string): string {
    return `site:${tenantId}:${version}:${kind}`;
  }

  feedKey(tenantId: string, kind: string): string {
    return `site:${tenantId}:feed:${kind}`;
  }

  getOrLoad<T>(tenantId: string, version: number, kind: string, load: () => Promise<T>) {
    return this.through(this.contentKey(tenantId, version, kind), SITE_CACHE_TTL_SECONDS, load);
  }

  getOrLoadFeed<T>(tenantId: string, kind: string, load: () => Promise<T>) {
    return this.through(this.feedKey(tenantId, kind), SITE_FEED_TTL_SECONDS, load);
  }

  /**
   * Drops the tenant's feed keys. Content keys need no delete: they carry `version`, so a
   * publish already makes the old ones unreachable (they expire in 24 h). The feed names are
   * a fixed list, so this is one DEL, never a SCAN of the shared Redis.
   */
  async invalidate(tenantId: string): Promise<void> {
    try {
      await this.redis.del(...FEED_KEYS.map((k) => this.feedKey(tenantId, k)));
    } catch (error) {
      this.logOnce(`invalidate failed: ${String(error)}`);
    }
  }

  private async through<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch (error) {
      this.logOnce(`read failed: ${String(error)}`);
    }
    const value = await load();
    if (value === undefined) return value;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      this.logOnce(`write failed: ${String(error)}`);
    }
    return value;
  }

  private logOnce(message: string): void {
    const now = Date.now();
    if (now - this.lastLogged < LOG_EVERY_MS) return;
    this.lastLogged = now;
    this.logger.error(`Site cache ${message}`);
  }
}
