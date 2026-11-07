import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SiteCustomDomainStatus as Status } from '@biddaloy/shared';
import { SchoolSite } from './entities/school-site.entity';
import { SiteCacheService } from './public/site-cache.service';
import { SiteConfigService } from './site-config.service';
import {
  CfHostname,
  CloudflareRejectedError,
  CloudflareSaasClient,
  CloudflareUnavailableError,
} from './cloudflare-saas.client';
import type { CustomDomainStatusDto } from './dto/custom-domain.dto';

type Record_ = { type: 'CNAME' | 'TXT'; name: string; value: string };

/** One answer for every refusal: feature off, malformed, reserved, taken, lost a race (Rule 23, D5). */
export const customDomainUnavailable = () =>
  new ConflictException('site.custom_domain_unavailable');
/** Cloudflare is down or slow: the school tries later, its subdomain site is unaffected (D42). */
export const customDomainTryLater = () =>
  new ServiceUnavailableException('site.custom_domain_try_later');

export const PENDING = [Status.PENDING_DNS, Status.PENDING_SSL];
/** PENDING_* for this long without a status change becomes FAILED. */
export const CUSTOM_DOMAIN_FAIL_AFTER_MS = 7 * 86_400_000;
const LOG_EVERY_MS = 60 * 60 * 1000;
const POLL_BATCH = 200;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const hostOf = (url?: string): string | null => {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * Lower-case, ASCII-only FQDN with at least two labels and an alphabetic TLD (so never an IP).
 * IDN and punycode (`xn--`) labels are refused: a look-alike of another school's or the
 * platform's name is not worth supporting. Platform names (the root domain and everything under
 * it, the app hosts) are refused. Returns null for anything refused.
 */
export function normalizeCustomHost(raw: unknown, platformHosts: string[]): string | null {
  if (typeof raw !== 'string') return null;
  const host = raw.trim().toLowerCase();
  if (host.length === 0 || host.length > 253) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l) && !l.startsWith('xn--')))
    return null;
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return null;
  if (platformHosts.some((p) => host === p || host.endsWith(`.${p}`))) return null;
  return host;
}

/** An apex has exactly two labels. ponytail: `school.co.uk` counts as www-style; the hint is advice only. */
export const isApex = (host: string) => host.split('.').length === 2;

/** Cloudflare's two statuses folded into ours. Anything not explicitly active stays pending (fail closed). */
export function mapCfStatus(cf: CfHostname): Status {
  if (['blocked', 'moved', 'deleted', 'pending_deletion'].includes(cf.status)) return Status.FAILED;
  if (cf.status === 'active' && cf.ssl.status === 'active') return Status.ACTIVE;
  if (cf.status === 'active') return Status.PENDING_SSL;
  return Status.PENDING_DNS;
}

export function recordsFor(host: string, cf: CfHostname, fallbackOrigin: string): Record_[] {
  const out: Record_[] = [{ type: 'CNAME', name: host, value: fallbackOrigin }];
  const own = cf.ownership_verification;
  out.push({
    type: 'TXT',
    name: own?.name || `_cf-custom-hostname.${host}`,
    value: own?.value ?? '',
  });
  for (const v of cf.ssl.validation_records ?? []) {
    if (v.txt_name && v.txt_value) out.push({ type: 'TXT', name: v.txt_name, value: v.txt_value });
  }
  return out.filter((r) => r.value !== '');
}

/** [40.4.08] A school's own domain through Cloudflare for SaaS (D5, D23, D35). */
@Injectable()
export class CustomDomainService {
  private readonly logger = new Logger(CustomDomainService.name);
  private lastUnavailableLog = 0;

  constructor(
    @InjectRepository(SchoolSite) private readonly sites: Repository<SchoolSite>,
    private readonly cf: CloudflareSaasClient,
    private readonly config: SiteConfigService,
    private readonly cache: SiteCacheService,
  ) {}

  private root(): string | null {
    return process.env.SITE_ROOT_DOMAIN?.trim().toLowerCase() || null;
  }

  isEnabled(): boolean {
    return this.cf.isConfigured() && this.root() !== null;
  }

  private fallbackOrigin(): string {
    return process.env.CF_SAAS_FALLBACK_ORIGIN?.trim().toLowerCase() || `sites.${this.root()}`;
  }

  private platformHosts(): string[] {
    return [
      this.root(),
      this.fallbackOrigin(),
      hostOf(process.env.APP_BASE_URL),
      hostOf(process.env.PUBLIC_APP_URL),
    ].filter((h): h is string => !!h);
  }

  private assertEnabled() {
    if (!this.isEnabled()) throw customDomainUnavailable();
  }

  /** Any write to the site row bumps `version` (D32) and drops the public cache. */
  private bump = { version: () => 'version + 1' };

  toDto(site: SchoolSite | null): CustomDomainStatusDto {
    const host = site?.custom_domain ?? null;
    return {
      host,
      status: host ? site!.custom_domain_status : null,
      records: host ? (site!.custom_domain_records ?? []) : [],
      lastCheckedAt: site?.custom_domain_checked_at?.toISOString() ?? null,
      hintKey: host && isApex(host) ? 'apex_needs_flattening' : null,
    };
  }

  async status(tenantId: string): Promise<CustomDomainStatusDto> {
    this.assertEnabled();
    return this.toDto(await this.sites.findOne({ where: { tenant_id: tenantId } }));
  }

  async set(tenantId: string, rawHost: unknown): Promise<CustomDomainStatusDto> {
    this.assertEnabled();
    const host = normalizeCustomHost(rawHost, this.platformHosts());
    if (!host) throw customDomainUnavailable();
    await this.config.get(tenantId); // first call creates the row
    const current = await this.sites.findOneOrFail({ where: { tenant_id: tenantId } });
    if (current.custom_domain === host) return this.toDto(current); // same request again
    if (current.custom_domain) await this.remove(tenantId); // replace: old hostname goes first

    // Claim the name in our own table first: the unique index decides a race between two schools
    // before anything is created at Cloudflare. Another school's claim and a malformed value answer alike.
    const now = new Date();
    try {
      await this.sites.update(
        { tenant_id: tenantId },
        {
          custom_domain: host,
          custom_domain_status: Status.PENDING_DNS,
          custom_domain_since: now,
          custom_domain_checked_at: null,
          custom_domain_records: null,
          custom_domain_external_id: null,
        },
      );
    } catch (e) {
      if ((e as { driverError?: { code?: string } }).driverError?.code === '23505') {
        throw customDomainUnavailable();
      }
      throw e;
    }

    let created: CfHostname;
    try {
      created = await this.cf.create(host);
    } catch (e) {
      await this.clear(tenantId, host);
      if (e instanceof CloudflareRejectedError) throw customDomainUnavailable();
      this.logger.warn('Cloudflare create failed; custom domain not set');
      throw customDomainTryLater();
    }
    const res = await this.sites
      .createQueryBuilder()
      .update(SchoolSite)
      .set({
        custom_domain_external_id: created.id,
        custom_domain_records: recordsFor(host, created, this.fallbackOrigin()),
        ...this.bump,
      })
      .where('tenant_id = :tenantId AND custom_domain = :host', { tenantId, host })
      .execute();
    if (!res.affected) {
      // Removed in the meantime: do not leave the hostname at Cloudflare.
      await this.cf.remove(created.id).catch(() => undefined);
      throw customDomainUnavailable();
    }
    await this.cache.invalidate(tenantId);
    return this.status(tenantId);
  }

  /** Cloudflare first: if it cannot be reached the columns stay, so nothing is orphaned there. */
  async remove(tenantId: string): Promise<void> {
    this.assertEnabled();
    const site = await this.sites.findOne({ where: { tenant_id: tenantId } });
    if (!site?.custom_domain) return;
    if (site.custom_domain_external_id) {
      try {
        await this.cf.remove(site.custom_domain_external_id);
      } catch {
        throw customDomainTryLater();
      }
    }
    await this.clear(tenantId, site.custom_domain);
    await this.cache.invalidate(tenantId);
  }

  private async clear(tenantId: string, host: string) {
    await this.sites
      .createQueryBuilder()
      .update(SchoolSite)
      .set({
        custom_domain: null,
        custom_domain_status: null,
        custom_domain_external_id: null,
        custom_domain_records: null,
        custom_domain_since: null,
        custom_domain_checked_at: null,
        ...this.bump,
      })
      .where('tenant_id = :tenantId AND custom_domain = :host', { tenantId, host })
      .execute();
  }

  /** One poll for this school now (rate limited at the route). */
  async recheck(tenantId: string, now = new Date()): Promise<CustomDomainStatusDto> {
    this.assertEnabled();
    const site = await this.sites.findOne({ where: { tenant_id: tenantId } });
    if (site?.custom_domain && PENDING.includes(site.custom_domain_status as Status)) {
      if (!(await this.pollOne(site, now))) throw customDomainTryLater();
    }
    return this.status(tenantId);
  }

  /**
   * Asks Cloudflare about one pending hostname. Idempotent: the write is guarded on the same
   * tenant, host and a still-pending status, so a removal or a second poll cannot be overwritten.
   * Cloudflare unreachable: nothing changes, one log line an hour (D42), returns false.
   */
  async pollOne(site: SchoolSite, now = new Date()): Promise<boolean> {
    if (!site.custom_domain || !site.custom_domain_external_id) return true;
    let cf: CfHostname | null;
    try {
      cf = await this.cf.get(site.custom_domain_external_id);
    } catch (e) {
      if (now.getTime() - this.lastUnavailableLog >= LOG_EVERY_MS) {
        this.lastUnavailableLog = now.getTime();
        this.logger.warn(
          e instanceof CloudflareUnavailableError
            ? 'Cloudflare custom hostname check unavailable; will retry'
            : 'Cloudflare custom hostname check failed; will retry',
        );
      }
      return false;
    }
    let next = cf ? mapCfStatus(cf) : Status.FAILED;
    const since = site.custom_domain_since ?? now;
    if (
      next !== Status.ACTIVE &&
      next !== Status.FAILED &&
      next === site.custom_domain_status &&
      now.getTime() - since.getTime() > CUSTOM_DOMAIN_FAIL_AFTER_MS
    ) {
      next = Status.FAILED;
    }
    const changed = next !== site.custom_domain_status;
    await this.sites
      .createQueryBuilder()
      .update(SchoolSite)
      .set({
        custom_domain_status: next,
        custom_domain_checked_at: now,
        ...(cf
          ? { custom_domain_records: recordsFor(site.custom_domain, cf, this.fallbackOrigin()) }
          : {}),
        ...(changed ? { custom_domain_since: now, ...this.bump } : {}),
      })
      .where(
        'tenant_id = :tenantId AND custom_domain = :host AND custom_domain_status IN (:...pending)',
        { tenantId: site.tenant_id, host: site.custom_domain, pending: PENDING },
      )
      .execute();
    if (changed) await this.cache.invalidate(site.tenant_id);
    return true;
  }

  /** All pending hostnames, oldest check first, bounded; one failure never stops the rest. */
  async pollPending(now = new Date()): Promise<number> {
    if (!this.isEnabled()) return 0;
    const rows = await this.sites.find({
      where: { custom_domain_status: In(PENDING) },
      order: { custom_domain_checked_at: { direction: 'ASC', nulls: 'FIRST' } },
      take: POLL_BATCH,
    });
    for (const row of rows) {
      try {
        await this.pollOne(row, now);
      } catch {
        this.logger.warn('custom domain poll failed for one school; continuing');
      }
    }
    return rows.length;
  }
}
