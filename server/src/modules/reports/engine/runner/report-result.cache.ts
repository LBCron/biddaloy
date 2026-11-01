import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';

/** D17: five minutes, then the report runs again. */
export const REPORT_CACHE_TTL_SECONDS = 300;

/**
 * [8.15.22] Short result cache on the shared fail-fast Redis client. The key is the exact query
 * that would run (SQL text, bound values, role): two runs share an entry only when they would send
 * the database the same statement for the same role, so a teacher's narrowed result is never served
 * to an admin. Redis down (D17): a read or write error is logged and the report simply runs.
 * Values must be JSON-safe.
 */
@Injectable()
export class ReportResultCache {
  private readonly logger = new Logger(ReportResultCache.name);

  constructor(@Inject(TENANT_STATUS_REDIS) private readonly redis: Redis) {}

  key(tenantId: string, versionId: string | null, sql: string, params: unknown[], role: string) {
    const digest = createHash('sha256')
      .update(JSON.stringify([sql, params, role]))
      .digest('hex');
    return `tenant:${tenantId}:report:v1:${versionId ?? 'inline'}:${digest}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      return cached ? (JSON.parse(cached) as T) : null;
    } catch (error) {
      this.logger.error(`Report cache read failed for ${key}: ${String(error)}`);
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', REPORT_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`Report cache write failed for ${key}: ${String(error)}`);
    }
  }
}
