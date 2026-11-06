import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SchoolSite } from '../entities/school-site.entity';
import { SiteHostService, normalizeHost } from './site-host.service';

const NOW = new Date('2026-11-06T00:00:00Z');
const ROOT = 'schools.test';

const site = (o: Partial<SchoolSite>): SchoolSite =>
  ({ tenant_id: 't1', subdomain: 'green', ...o }) as SchoolSite;

/** `where` objects are matched field by field against an in-memory list. */
function service(rows: SchoolSite[]) {
  const repo = {
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) =>
        Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
      ) ?? null,
  };
  return new SiteHostService(repo as never);
}

describe('SiteHostService', () => {
  const saved = process.env.SITE_ROOT_DOMAIN;
  beforeEach(() => {
    process.env.SITE_ROOT_DOMAIN = ROOT;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SITE_ROOT_DOMAIN;
    else process.env.SITE_ROOT_DOMAIN = saved;
  });

  it('resolves a subdomain, ignoring case and port', async () => {
    const r = await service([site({})]).resolve(`GREEN.${ROOT}:443`, NOW);
    expect(r).toMatchObject({ tenantId: 't1' });
  });

  it('resolves a custom domain only when ACTIVE', async () => {
    const active = site({ custom_domain: 'school.org', custom_domain_status: 'ACTIVE' });
    const pending = site({ custom_domain: 'school.org', custom_domain_status: 'PENDING_DNS' });
    expect(await service([active]).resolve('school.org', NOW)).toMatchObject({ tenantId: 't1' });
    expect(await service([pending]).resolve('school.org', NOW)).toBeNull();
  });

  it('redirects a renamed subdomain inside its window and not after it', async () => {
    const renamed = (until: string) =>
      site({ subdomain: 'new', previous_subdomain: 'old', previous_until: new Date(until) });
    expect(await service([renamed('2026-11-10T00:00:00Z')]).resolve(`old.${ROOT}`, NOW)).toEqual({
      redirectTo: `new.${ROOT}`,
    });
    expect(await service([renamed('2026-11-01T00:00:00Z')]).resolve(`old.${ROOT}`, NOW)).toBeNull();
  });

  it('answers null for an unknown host, a nested label and junk', async () => {
    const s = service([site({})]);
    expect(await s.resolve(`nobody.${ROOT}`, NOW)).toBeNull();
    expect(await s.resolve(`a.green.${ROOT}`, NOW)).toBeNull();
    expect(await s.resolve('bad host/x', NOW)).toBeNull();
  });

  it('normalizeHost strips the port and lower-cases', () => {
    expect(normalizeHost(' Example.COM:8080 ')).toBe('example.com');
    expect(normalizeHost('')).toBeNull();
  });
});
