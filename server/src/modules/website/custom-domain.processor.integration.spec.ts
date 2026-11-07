import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { CustomDomainService } from './custom-domain.service';
import { CloudflareSaasClient } from './cloudflare-saas.client';
import { SiteConfigService } from './site-config.service';
import { SiteCacheService } from './public/site-cache.service';
import { SiteHostService } from './public/site-host.service';

const OTHER_TENANT = '00000000-0000-4000-8000-0000000000e5';
const ZONE = 'b'.repeat(32);
const CF_ID = 'c'.repeat(32);
const HOST = 'www.cd-int.example.edu';
const BASE = `/client/v4/zones/${ZONE}/custom_hostnames`;
const T0 = new Date('2026-11-07T00:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

const cfAnswer = (status: string, ssl: string) => ({
  success: true,
  result: {
    id: CF_ID,
    status,
    ssl: { status: ssl },
    ownership_verification: { name: `_cf-custom-hostname.${HOST}`, value: 'own-value' },
  },
});

/** [40.4.08] The status poll and the host lookup against a real DB and a faked api.cloudflare.com. */
describe('custom domain (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let svc: CustomDomainService;
  let hosts: SiteHostService;
  let agent: MockAgent;
  const original = getGlobalDispatcher();
  const saved = { ...process.env };
  const pool = () => agent.get('https://api.cloudflare.com');

  const row = async (t = SEED_TENANT_ID) =>
    (await ds.query(`SELECT * FROM school_sites WHERE tenant_id = $1`, [t]))[0];

  const clean = async () => {
    await ds.query(`DELETE FROM school_sites WHERE tenant_id IN ($1,$2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT,
    ]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [OTHER_TENANT]);
  };

  beforeAll(async () => {
    process.env.CF_SAAS_API_TOKEN = 'test-token-never-logged';
    process.env.CF_ZONE_ID = ZONE;
    process.env.SITE_ROOT_DOMAIN = 'schools.test';
    moduleRef = await createTestModule(ALL_ENTITIES, [
      CustomDomainService,
      CloudflareSaasClient,
      SiteHostService,
      { provide: SiteConfigService, useValue: { get: async () => ({}) } },
      { provide: SiteCacheService, useValue: { invalidate: async () => undefined } },
    ]);
    ds = moduleRef.get(DataSource);
    svc = moduleRef.get(CustomDomainService);
    hosts = moduleRef.get(SiteHostService);
  }, 60000);

  afterAll(async () => {
    await clean();
    process.env = saved;
    setGlobalDispatcher(original);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await clean();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft)
       VALUES ($1, 'cd-int', 'blue', '{}')`,
      [SEED_TENANT_ID],
    );
  });

  const attach = async () => {
    pool()
      .intercept({ path: BASE, method: 'POST' })
      .reply(200, cfAnswer('pending', 'initializing'));
    return svc.set(SEED_TENANT_ID, HOST);
  };

  it('set stores the pending host, the records, and bumps version', async () => {
    const before = (await row()).version;
    const dto = await attach();
    expect(dto).toMatchObject({ host: HOST, status: 'PENDING_DNS', hintKey: null });
    expect(dto.records.map((r) => r.type)).toEqual(['CNAME', 'TXT']);
    expect(dto.records[0].value).toBe('sites.schools.test'); // default fallback origin
    expect((await row()).custom_domain_external_id).toBe(CF_ID);
    expect((await row()).version).toBe(before + 1);
  });

  it('walks PENDING_DNS -> PENDING_SSL -> ACTIVE over three ticks; only ACTIVE resolves', async () => {
    await attach();
    const tick = async (status: string, ssl: string, at: Date) => {
      pool()
        .intercept({ path: `${BASE}/${CF_ID}`, method: 'GET' })
        .reply(200, cfAnswer(status, ssl));
      await svc.pollPending(at);
      return (await row()).custom_domain_status;
    };
    expect(await tick('pending', 'initializing', min(10))).toBe('PENDING_DNS');
    expect(await hosts.resolve(HOST)).toBeNull(); // pending host: the standard 404
    const v1 = (await row()).version;
    expect(await tick('active', 'pending_validation', min(20))).toBe('PENDING_SSL');
    expect((await row()).version).toBe(v1 + 1); // a status change bumps version (D32)
    expect(await tick('active', 'active', min(30))).toBe('ACTIVE');
    expect(await hosts.resolve(HOST)).toMatchObject({ tenantId: SEED_TENANT_ID });
    expect((await row()).custom_domain_checked_at).not.toBeNull();
  });

  it('a Cloudflare 5xx leaves the status and version untouched', async () => {
    await attach();
    const v = (await row()).version;
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'GET' })
      .reply(503, { success: false });
    await svc.pollPending(min(10));
    expect(await row()).toMatchObject({ custom_domain_status: 'PENDING_DNS', version: v });
  });

  it('a pending host older than 7 days without progress becomes FAILED', async () => {
    await attach();
    await ds.query(`UPDATE school_sites SET custom_domain_since = $2 WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
      new Date(T0.getTime() - 8 * 86_400_000),
    ]);
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'GET' })
      .reply(200, cfAnswer('pending', 'initializing'));
    await svc.pollPending(T0);
    expect((await row()).custom_domain_status).toBe('FAILED');
    expect(await hosts.resolve(HOST)).toBeNull();
  });

  it('another school claiming the same host gets the one fixed refusal and never resolves it', async () => {
    await attach();
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,'Other CD School','other-cd-int',NOW(),NOW())`,
      [OTHER_TENANT],
    );
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft) VALUES ($1,'cd-int-other','blue','{}')`,
      [OTHER_TENANT],
    );
    // No Cloudflare call is intercepted: the unique index must refuse before Cloudflare is asked.
    await expect(svc.set(OTHER_TENANT, HOST)).rejects.toMatchObject({
      message: 'site.custom_domain_unavailable',
    });
    expect((await row(OTHER_TENANT)).custom_domain).toBeNull();
    expect((await row()).custom_domain).toBe(HOST);

    // Tenant isolation of the host lookup: the host belongs to A only, never to B.
    await ds.query(`UPDATE school_sites SET custom_domain_status = 'ACTIVE' WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    const hit = await hosts.resolve(HOST);
    expect(hit).toMatchObject({ tenantId: SEED_TENANT_ID });
    expect(hit).not.toMatchObject({ tenantId: OTHER_TENANT });
  });

  it('remove deletes at Cloudflare, clears the columns, and the host stops resolving', async () => {
    await attach();
    await ds.query(`UPDATE school_sites SET custom_domain_status = 'ACTIVE' WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'DELETE' })
      .reply(200, { success: true, result: { id: CF_ID } });
    await svc.remove(SEED_TENANT_ID);
    expect(await row()).toMatchObject({
      custom_domain: null,
      custom_domain_status: null,
      custom_domain_external_id: null,
    });
    expect(await hosts.resolve(HOST)).toBeNull();
    // the subdomain still answers
    expect(await hosts.resolve('cd-int.schools.test')).toMatchObject({ tenantId: SEED_TENANT_ID });
  });

  it('remove while Cloudflare is down keeps the columns, so nothing is orphaned there', async () => {
    await attach();
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'DELETE' })
      .reply(500, { success: false });
    await expect(svc.remove(SEED_TENANT_ID)).rejects.toMatchObject({
      message: 'site.custom_domain_try_later',
    });
    expect((await row()).custom_domain).toBe(HOST);
  });

  it('set when Cloudflare is down leaves no half-claimed host', async () => {
    pool().intercept({ path: BASE, method: 'POST' }).reply(502, { success: false });
    await expect(svc.set(SEED_TENANT_ID, HOST)).rejects.toMatchObject({
      message: 'site.custom_domain_try_later',
    });
    expect((await row()).custom_domain).toBeNull();
  });
});
