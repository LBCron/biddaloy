import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
  ) {}

  /** Returns null when Umami is off or down: the site publishes without analytics. Never throws. */
  async ensureWebsite(tenantId: string): Promise<string | null> {
    if (!this.client.isConfigured()) return null;
    try {
      return await this.sites.manager.transaction(async (m) => {
        // One creator per school at a time, so two quick publishes cannot make two Umami sites.
        await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `umami:${tenantId}`,
        ]);
        const site = await m.findOne(SchoolSite, { where: { tenant_id: tenantId } });
        if (!site) return null;
        if (site.umami_website_id) return site.umami_website_id;
        const root = process.env.SITE_ROOT_DOMAIN?.trim().toLowerCase();
        const id = await this.client.createWebsite(
          site.subdomain,
          site.custom_domain ?? (root ? `${site.subdomain}.${root}` : site.subdomain),
        );
        await m.update(SchoolSite, { tenant_id: tenantId }, { umami_website_id: id });
        return id;
      });
    } catch {
      this.logger.warn('Umami website creation failed; site publishes without analytics');
      return null;
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
