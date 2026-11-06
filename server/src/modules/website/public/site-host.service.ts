import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SiteCustomDomainStatus } from '@biddaloy/shared';
import { SchoolSite } from '../entities/school-site.entity';

/** A redirect carries its site too, so the caller can check the site is live before answering 301. */
export type ResolvedHost =
  { tenantId: string; site: SchoolSite } | { redirectTo: string; site: SchoolSite } | null;

/** Lower-case, no port. Anything that is not a plausible host name is not looked up at all. */
export function normalizeHost(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/:\d+$/, '');
  return host.length > 0 && host.length <= 253 && /^[a-z0-9.-]+$/.test(host) ? host : null;
}

/**
 * [40.1.04] Host name -> school site (D34). Subdomain of `SITE_ROOT_DOMAIN`, else an ACTIVE
 * custom domain, else a renamed subdomain still inside its 30-day redirect window.
 * Never says why a host did not resolve: the caller answers one 404 for all of them (Rule 23).
 */
@Injectable()
export class SiteHostService {
  constructor(@InjectRepository(SchoolSite) private readonly sites: Repository<SchoolSite>) {}

  private rootDomain(): string | null {
    const root = process.env.SITE_ROOT_DOMAIN?.trim().toLowerCase();
    return root ? root : null;
  }

  async resolve(rawHost: string, now: Date = new Date()): Promise<ResolvedHost> {
    const host = normalizeHost(rawHost);
    if (!host) return null;
    const root = this.rootDomain();

    if (root && host.endsWith(`.${root}`)) {
      const label = host.slice(0, -(root.length + 1));
      if (label.includes('.')) return null;
      const site = await this.sites.findOne({ where: { subdomain: label } });
      if (site) return { tenantId: site.tenant_id, site };
      const old = await this.sites.findOne({ where: { previous_subdomain: label } });
      if (old?.previous_until && old.previous_until > now) {
        return { redirectTo: `${old.subdomain}.${root}`, site: old };
      }
      return null;
    }

    const site = await this.sites.findOne({
      where: { custom_domain: host, custom_domain_status: SiteCustomDomainStatus.ACTIVE },
    });
    return site ? { tenantId: site.tenant_id, site } : null;
  }
}
