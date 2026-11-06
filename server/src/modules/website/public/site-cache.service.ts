import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';

export const SITE_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const SITE_FEED_TTL_SECONDS = 60;
/** At most one error log per this window, so a Redis outage does not flood the log. */
const LOG_EVERY_MS = 60_000;

/**
 * Published-site cache on the shared fail-fast Redis client. Content keys carry the site
 * `version`, so a publish makes the old keys unreachable (they expire on their own); feeds
 * change without a publish, so they live 60 s under their own key.
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

  /** Deletes every `site:<tenant>:*` key (content and feeds) with SCAN, never KEYS. */
  async invalidate(tenantId: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `site:${tenantId}:*`,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length) await this.redis.del(...keys);
      } while (cursor !== '0');
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
