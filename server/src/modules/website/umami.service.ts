import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { Repository } from 'typeorm';
import { SchoolSite } from './entities/school-site.entity';
import { UmamiClient } from './umami.client';

/** [40.4.08] One Umami website per school, created on first publish. Never blocks the site (D42). */
@Injectable()
export class UmamiService {
  private readonly logger = new Logger(UmamiService.name);

  constructor(
    @InjectRepository(SchoolSite) private readonly sites: Repository<SchoolSite>,
    private readonly client: UmamiClient,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Returns null when Umami is off or down: the site publishes without analytics. Never throws.
   * No DB transaction is held across the HTTP call: a short Redis lock (NX, 30 s) lets one publish
   * create the Umami site; a concurrent one returns null and the next publish picks the id up.
   * Redis down: no lock, and the `umami_website_id IS NULL` write below decides (a rare duplicate
   * Umami site is possible then, never a duplicate id).
   */
  async ensureWebsite(tenantId: string): Promise<string | null> {
    if (!this.client.isConfigured()) return null;
    const lockKey = `site:umami-create:${tenantId}`;
    let locked = false;
    try {
      const site = await this.sites.findOne({ where: { tenant_id: tenantId } });
      if (!site) return null;
      if (site.umami_website_id) return site.umami_website_id;
      try {
        locked = (await this.redis.set(lockKey, '1', 'EX', 30, 'NX')) === 'OK';
        if (!locked) return null;
      } catch {
        // Redis down: go on without the lock
      }
      const root = process.env.SITE_ROOT_DOMAIN?.trim().toLowerCase();
      const id = await this.client.createWebsite(
        site.subdomain,
        site.custom_domain ?? (root ? `${site.subdomain}.${root}` : site.subdomain),
      );
      const res = await this.sites
        .createQueryBuilder()
        .update(SchoolSite)
        .set({ umami_website_id: id })
        .where('tenant_id = :tenantId AND umami_website_id IS NULL', { tenantId })
        .execute();
      if (res.affected) return id;
      return (
        (await this.sites.findOne({ where: { tenant_id: tenantId } }))?.umami_website_id ?? null
      );
    } catch {
      this.logger.warn('Umami website creation failed; site publishes without analytics');
      return null;
    } finally {
      if (locked) await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  async monthlyStats(tenantId: string, now = new Date()) {
    try {
      const site = await this.sites.findOne({ where: { tenant_id: tenantId } });
      if (!site?.umami_website_id || !this.client.isConfigured()) {
        return { available: false as const };
      }
      const from = new Date(now.getTime() - 30 * 86_400_000);
      const s = await this.client.stats(site.umami_website_id, from.getTime(), now.getTime());
      return { available: true as const, ...s, from: from.toISOString(), to: now.toISOString() };
    } catch {
      return { available: false as const };
    }
  }
}
