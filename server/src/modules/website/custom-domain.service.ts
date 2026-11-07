import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
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

/** Special-use names that never belong to a school (RFC 6761 / 7686 and friends). */
const RESERVED_TLDS = [
  'local',
  'internal',
  'test',
  'localhost',
  'invalid',
  'onion',
  'example',
  'arpa',
];
/**
 * Public suffixes a school cannot own. ponytail: a small list for Bangladesh plus co.uk, not the
 * full Public Suffix List; add a dependency only if schools outside these start to attach domains.
 */
const PUBLIC_SUFFIXES = [
  'edu.bd',
  'com.bd',
  'ac.bd',
  'gov.bd',
  'org.bd',
  'net.bd',
  'mil.bd',
  'co.uk',
];
/** An hourly cap per school on PUT/DELETE: the Cloudflare token is shared by every school. */
const WRITE_CAP_PER_HOUR = 20;
const WRITE_WINDOW_MS = 3_600_000;
/** A PENDING row with no Cloudflare id this old is a crashed create: adopt or release it. */
const STUCK_CLAIM_MS = 15 * 60_000;
/** ACTIVE hosts are asked about once a day. */
const ACTIVE_REPOLL_MS = 86_400_000;

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
  if (RESERVED_TLDS.includes(labels[labels.length - 1])) return null;
  if (PUBLIC_SUFFIXES.includes(host)) return null;
  if (platformHosts.some((p) => host === p || host.endsWith(`.${p}`))) return null;
  return host;
}

/** An apex is two labels, or one label above a listed public suffix (`x.edu.bd`). The hint is advice only. */
export const isApex = (host: string) => {
  const n = host.split('.').length;
  return n === 2 || (n === 3 && PUBLIC_SUFFIXES.some((x) => host.endsWith(`.${x}`)));
};

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
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
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
    // A FAILED hostname is released (host null) but the status stays so the school sees why.
    const failedReleased = !host && site?.custom_domain_status === Status.FAILED;
    return {
      host,
      status: host || failedReleased ? site!.custom_domain_status : null,
      records: host ? (site!.custom_domain_records ?? []) : [],
      lastCheckedAt: site?.custom_domain_checked_at?.toISOString() ?? null,
      hintKey:
        host && isApex(host) ? 'apex_needs_flattening' : failedReleased ? 'failed_released' : null,
    };
  }

  async status(tenantId: string): Promise<CustomDomainStatusDto> {
    this.assertEnabled();
    return this.toDto(await this.sites.findOne({ where: { tenant_id: tenantId } }));
  }

  /**
   * Per-school hourly cap on PUT/DELETE, because one Cloudflare token serves every school.
   * PUT fails CLOSED when Redis is down (503 try later); DELETE fails open so a school can always
   * detach its domain.
   */
  private async chargeWrite(tenantId: string, failClosed: boolean) {
    const key = `site:cd-writes:${tenantId}`;
    try {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.pexpire(key, WRITE_WINDOW_MS);
      if (n > WRITE_CAP_PER_HOUR) {
        throw new HttpException('site.custom_domain_rate_limited', 429);
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.warn('custom domain write cap unavailable (Redis)');
      if (failClosed) throw customDomainTryLater();
    }
  }

  private async heldByOther(tenantId: string, host: string): Promise<boolean> {
    return this.sites
      .createQueryBuilder('s')
      .where('s.custom_domain = :host AND s.tenant_id <> :tenantId', { host, tenantId })
      .getExists();
  }

  private isUnique(e: unknown) {
    return (e as { driverError?: { code?: string } }).driverError?.code === '23505';
  }

  async set(tenantId: string, rawHost: unknown): Promise<CustomDomainStatusDto> {
    this.assertEnabled();
    const host = normalizeCustomHost(rawHost, this.platformHosts());
    if (!host) throw customDomainUnavailable();
    await this.chargeWrite(tenantId, true);
    await this.config.get(tenantId); // first call creates the row
    const current = await this.sites.findOneOrFail({ where: { tenant_id: tenantId } });
    if (current.custom_domain === host) return this.toDto(current); // same request again
    if (await this.heldByOther(tenantId, host)) throw customDomainUnavailable();
    return current.custom_domain ? this.replace(current, host) : this.attach(tenantId, host);
  }

  /**
   * First domain. The name is claimed in our own table first (the unique index decides a race
   * between two schools before Cloudflare is asked), then created at Cloudflare. If the create
   * answer is lost or refused as a duplicate, the hostname is looked up and adopted: our claim
   * row proves it is ours.
   */
  private async attach(tenantId: string, host: string): Promise<CustomDomainStatusDto> {
    let claimed;
    try {
      claimed = await this.sites
        .createQueryBuilder()
        .update(SchoolSite)
        .set({
          custom_domain: host,
          custom_domain_status: Status.PENDING_DNS,
          custom_domain_since: new Date(),
          custom_domain_checked_at: null,
          custom_domain_records: null,
          custom_domain_external_id: null,
        })
        .where('tenant_id = :tenantId AND custom_domain IS NULL', { tenantId })
        .execute();
    } catch (e) {
      if (this.isUnique(e)) throw customDomainUnavailable();
      throw e;
    }
    if (!claimed.affected) throw customDomainUnavailable(); // a concurrent PUT of this school won

    let created: CfHostname;
    try {
      created = await this.createOrAdopt(host);
    } catch (e) {
      // Only undo OUR claim: a concurrent winner's committed Cloudflare id must never be wiped.
      await this.sites
        .createQueryBuilder()
        .update(SchoolSite)
        .set({
          custom_domain: null,
          custom_domain_status: null,
          custom_domain_since: null,
          custom_domain_records: null,
        })
        .where(
          'tenant_id = :tenantId AND custom_domain = :host AND custom_domain_external_id IS NULL',
          { tenantId, host },
        )
        .execute();
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

  private async createOrAdopt(host: string): Promise<CfHostname> {
    try {
      return await this.cf.create(host);
    } catch (e) {
      let found: CfHostname | null = null;
      try {
        found = await this.cf.findByHostname(host);
      } catch {
        // lookup failed too: the original error decides
      }
      if (found) return found;
      throw e;
    }
  }

  /**
   * Another domain while one exists. The live domain is not touched until the new hostname exists
   * at Cloudflare AND the row swap succeeded; any refusal leaves the old domain exactly as it was.
   * The old hostname is deleted last, best effort (a failure leaves it at Cloudflare, logged).
   * A lost create answer here is not adopted (the name is not claimed yet): remove the domain,
   * then attach again, which adopts it.
   */
  private async replace(old: SchoolSite, host: string): Promise<CustomDomainStatusDto> {
    const tenantId = old.tenant_id;
    let created: CfHostname;
    try {
      created = await this.cf.create(host);
    } catch (e) {
      if (e instanceof CloudflareRejectedError) throw customDomainUnavailable();
      this.logger.warn('Cloudflare create failed; custom domain unchanged');
      throw customDomainTryLater();
    }
    let swapped = false;
    try {
      const res = await this.sites
        .createQueryBuilder()
        .update(SchoolSite)
        .set({
          custom_domain: host,
          custom_domain_status: Status.PENDING_DNS,
          custom_domain_since: new Date(),
          custom_domain_checked_at: null,
          custom_domain_external_id: created.id,
          custom_domain_records: recordsFor(host, created, this.fallbackOrigin()),
          ...this.bump,
        })
        .where('tenant_id = :tenantId AND custom_domain = :old', {
          tenantId,
          old: old.custom_domain,
        })
        .execute();
      swapped = !!res.affected;
    } catch (e) {
      if (!this.isUnique(e)) {
        await this.cf.remove(created.id).catch(() => undefined);
        throw e;
      }
    }
    if (!swapped) {
      await this.cf.remove(created.id).catch(() => undefined);
      throw customDomainUnavailable();
    }
    if (old.custom_domain_external_id) {
      await this.cf.remove(old.custom_domain_external_id).catch(() => {
        this.logger.warn('old custom hostname left at Cloudflare after a replace; remove by hand');
      });
    }
    await this.cache.invalidate(tenantId);
    return this.status(tenantId);
  }

  /** Cloudflare first: if it cannot be reached the columns stay, so nothing is orphaned there. */
  async remove(tenantId: string): Promise<void> {
    this.assertEnabled();
    await this.chargeWrite(tenantId, false);
    const site = await this.sites.findOne({ where: { tenant_id: tenantId } });
    if (!site?.custom_domain) return;
    if (site.custom_domain_external_id) {
      try {
        // A 4xx saying "does not exist" counts as already removed (client.remove); any other
        // refusal or outage is "try later" and the row stays.
        await this.cf.remove(site.custom_domain_external_id);
      } catch {
        throw customDomainTryLater();
      }
    }
    await this.release(tenantId, site.custom_domain, null);
    await this.cache.invalidate(tenantId);
  }

  /** Frees the host name: another school can claim it from now on. */
  private async release(tenantId: string, host: string, status: Status | null, now = new Date()) {
    await this.sites
      .createQueryBuilder()
      .update(SchoolSite)
      .set({
        custom_domain: null,
        custom_domain_status: status,
        custom_domain_external_id: null,
        custom_domain_records: null,
        custom_domain_since: null,
        custom_domain_checked_at: status ? now : null,
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

  private logUnavailable(e: unknown, now: Date) {
    if (now.getTime() - this.lastUnavailableLog < LOG_EVERY_MS) return;
    this.lastUnavailableLog = now.getTime();
    this.logger.warn(
      e instanceof CloudflareUnavailableError
        ? 'Cloudflare custom hostname check unavailable; will retry'
        : 'Cloudflare custom hostname check failed; will retry',
    );
  }

  /** A PENDING claim with no Cloudflare id after 15 min is a crashed create: adopt the hostname or release the name. */
  private async settleStuck(site: SchoolSite, now: Date): Promise<boolean> {
    const since = site.custom_domain_since ?? now;
    if (now.getTime() - since.getTime() < STUCK_CLAIM_MS) return true;
    let found: CfHostname | null;
    try {
      found = await this.cf.findByHostname(site.custom_domain!);
    } catch (e) {
      this.logUnavailable(e, now);
      return false;
    }
    if (!found) {
      await this.release(site.tenant_id, site.custom_domain!, null);
      await this.cache.invalidate(site.tenant_id);
      return true;
    }
    await this.sites
      .createQueryBuilder()
      .update(SchoolSite)
      .set({
        custom_domain_external_id: found.id,
        custom_domain_records: recordsFor(site.custom_domain!, found, this.fallbackOrigin()),
        custom_domain_checked_at: now,
        ...this.bump,
      })
      .where(
        'tenant_id = :tenantId AND custom_domain = :host AND custom_domain_external_id IS NULL',
        { tenantId: site.tenant_id, host: site.custom_domain },
      )
      .execute();
    return true;
  }

  /**
   * Asks Cloudflare about one hostname (pending, or ACTIVE on the daily re-poll). Idempotent: the
   * write is guarded on the same tenant, host and a live status, so a removal or a second poll
   * cannot be overwritten. Cloudflare unreachable: nothing changes, one log line an hour (D42),
   * returns false. A hostname that FAILED (7 days stuck, or Cloudflare says blocked/moved/deleted)
   * is deleted at Cloudflare and its name released, so it cannot squat on the name or keep billing.
   */
  async pollOne(site: SchoolSite, now = new Date()): Promise<boolean> {
    if (!site.custom_domain) return true;
    if (!site.custom_domain_external_id) return this.settleStuck(site, now);
    let cf: CfHostname | null;
    try {
      cf = await this.cf.get(site.custom_domain_external_id);
    } catch (e) {
      this.logUnavailable(e, now);
      return false;
    }
    const current = site.custom_domain_status as Status;
    let next = cf ? mapCfStatus(cf) : Status.FAILED;
    // An ACTIVE host only leaves ACTIVE through FAILED; a Cloudflare flap never downgrades it.
    if (current === Status.ACTIVE && next !== Status.FAILED) next = Status.ACTIVE;
    const since = site.custom_domain_since ?? now;
    if (
      next !== Status.ACTIVE &&
      next !== Status.FAILED &&
      next === current &&
      now.getTime() - since.getTime() > CUSTOM_DOMAIN_FAIL_AFTER_MS
    ) {
      next = Status.FAILED;
    }
    if (next === Status.FAILED) {
      if (cf) {
        try {
          await this.cf.remove(site.custom_domain_external_id);
        } catch (e) {
          this.logUnavailable(e, now);
          return false; // still pending; the next tick retries the delete
        }
      }
      await this.release(site.tenant_id, site.custom_domain, Status.FAILED, now);
      await this.cache.invalidate(site.tenant_id);
      this.logger.warn('custom domain failed and was released');
      return true;
    }
    const changed = next !== current;
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
        'tenant_id = :tenantId AND custom_domain = :host AND custom_domain_status IN (:...live)',
        { tenantId: site.tenant_id, host: site.custom_domain, live: [...PENDING, Status.ACTIVE] },
      )
      .execute();
    if (changed) await this.cache.invalidate(site.tenant_id);
    return true;
  }

  /** Pending hostnames first, then ACTIVE ones not asked for a day; bounded; one failure never stops the rest. */
  async pollPending(now = new Date()): Promise<number> {
    if (!this.isEnabled()) return 0;
    const rows = await this.sites.find({
      where: { custom_domain_status: In(PENDING) },
      order: { custom_domain_checked_at: { direction: 'ASC', nulls: 'FIRST' } },
      take: POLL_BATCH,
    });
    if (rows.length < POLL_BATCH) {
      const stale = new Date(now.getTime() - ACTIVE_REPOLL_MS);
      rows.push(
        ...(await this.sites.find({
          where: [
            { custom_domain_status: Status.ACTIVE, custom_domain_checked_at: IsNull() },
            { custom_domain_status: Status.ACTIVE, custom_domain_checked_at: LessThan(stale) },
          ],
          order: { custom_domain_checked_at: { direction: 'ASC', nulls: 'FIRST' } },
          take: POLL_BATCH - rows.length,
        })),
      );
    }
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
