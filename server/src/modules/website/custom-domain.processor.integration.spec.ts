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
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';

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

/** [40.4.08] Status poll, host lookup and write cap against a real DB and a faked api.cloudflare.com. */
/** In-memory stand-in for the Redis calls the service makes. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const redis = {
    down: false,
    incr: async (k: string) => {
      if (redis.down) throw new Error('redis down');
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k)!;
    },
    pexpire: async () => 1,
    set: async () => 'OK',
    del: async () => 1,
    reset: () => {
      counts.clear();
      redis.down = false;
    },
  };
  return redis;
}

describe('custom domain (integration)', () => {
  const redis = fakeRedis();
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
      { provide: TENANT_STATUS_REDIS, useValue: redis },
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
    redis.reset();
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

  const makeOther = async () => {
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,'Other CD School','other-cd-int',NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_TENANT],
    );
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft) VALUES ($1,'cd-int-other','blue','{}') ON CONFLICT DO NOTHING`,
      [OTHER_TENANT],
    );
  };

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

  it('a pending host older than 7 days without progress becomes FAILED and is released', async () => {
    await attach();
    await ds.query(`UPDATE school_sites SET custom_domain_since = $2 WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
      new Date(T0.getTime() - 8 * 86_400_000),
    ]);
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'GET' })
      .reply(200, cfAnswer('pending', 'initializing'));
    // FAILED deletes the billed hostname at Cloudflare and releases the name.
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'DELETE' })
      .reply(200, { success: true, result: { id: CF_ID } });
    await svc.pollPending(T0);
    expect(await row()).toMatchObject({
      custom_domain: null,
      custom_domain_status: 'FAILED',
      custom_domain_external_id: null,
    });
    expect(await hosts.resolve(HOST)).toBeNull();
  });

  it('tenant B can claim a host after tenant A FAILED and released it', async () => {
    await attach();
    await ds.query(`UPDATE school_sites SET custom_domain_since = $2 WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
      new Date(T0.getTime() - 8 * 86_400_000),
    ]);
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'GET' })
      .reply(200, cfAnswer('pending', 'initializing'));
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'DELETE' })
      .reply(200, { success: true, result: { id: CF_ID } });
    await svc.pollPending(T0);
    await makeOther();
    pool()
      .intercept({ path: BASE, method: 'POST' })
      .reply(200, {
        success: true,
        result: { ...cfAnswer('pending', 'initializing').result, id: 'f'.repeat(32) },
      });
    await svc.set(OTHER_TENANT, HOST);
    expect((await row(OTHER_TENANT)).custom_domain).toBe(HOST);
  });

  it('a pending host Cloudflare says is blocked is deleted and released', async () => {
    await attach();
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'GET' })
      .reply(200, cfAnswer('blocked', 'initializing'));
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'DELETE' })
      .reply(200, { success: true, result: { id: CF_ID } });
    await svc.pollPending(min(10));
    expect(await row()).toMatchObject({ custom_domain: null, custom_domain_status: 'FAILED' });
  });

  it('an ACTIVE host is re-polled after a day and released when Cloudflare says moved', async () => {
    await attach();
    await ds.query(
      `UPDATE school_sites SET custom_domain_status = 'ACTIVE', custom_domain_checked_at = $2 WHERE tenant_id = $1`,
      [SEED_TENANT_ID, T0],
    );
    // Within a day nothing is asked (no intercept: a call would fail), the row stays ACTIVE.
    await svc.pollPending(min(60));
    expect((await row()).custom_domain_status).toBe('ACTIVE');
    // After a day a Cloudflare flap to "pending" never downgrades it.
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'GET' })
      .reply(200, cfAnswer('pending', 'initializing'));
    await svc.pollPending(new Date(T0.getTime() + 2 * 86_400_000));
    expect((await row()).custom_domain_status).toBe('ACTIVE');
    // "moved": FAILED and released.
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'GET' })
      .reply(200, cfAnswer('moved', 'active'));
    pool()
      .intercept({ path: `${BASE}/${CF_ID}`, method: 'DELETE' })
      .reply(200, { success: true, result: { id: CF_ID } });
    await svc.pollPending(new Date(T0.getTime() + 4 * 86_400_000));
    expect(await row()).toMatchObject({ custom_domain: null, custom_domain_status: 'FAILED' });
    expect(await hosts.resolve(HOST)).toBeNull();
  });

  it('a create whose answer was lost is adopted from the Cloudflare lookup (no orphan)', async () => {
    pool()
      .intercept({ path: BASE, method: 'POST' })
      .reply(409, { success: false, errors: [{ message: 'Duplicate custom hostname found.' }] });
    pool()
      .intercept({ path: `${BASE}?hostname=${encodeURIComponent(HOST)}`, method: 'GET' })
      .reply(200, {
        success: true,
        result: [{ ...cfAnswer('pending', 'initializing').result, hostname: HOST }],
      });
    const dto = await svc.set(SEED_TENANT_ID, HOST);
    expect(dto).toMatchObject({ host: HOST, status: 'PENDING_DNS' });
    expect((await row()).custom_domain_external_id).toBe(CF_ID);
  });

  it('a stuck claim (no Cloudflare id for 15 min) is released when Cloudflare has nothing', async () => {
    await ds.query(
      `UPDATE school_sites SET custom_domain = $2, custom_domain_status = 'PENDING_DNS', custom_domain_since = $3 WHERE tenant_id = $1`,
      [SEED_TENANT_ID, HOST, T0],
    );
    await svc.pollPending(min(5)); // too young: untouched
    expect((await row()).custom_domain).toBe(HOST);
    pool()
      .intercept({ path: `${BASE}?hostname=${encodeURIComponent(HOST)}`, method: 'GET' })
      .reply(200, { success: true, result: [] });
    await svc.pollPending(min(30));
    expect((await row()).custom_domain).toBeNull();
  });

  it('a failed create only undoes its own claim, never a committed Cloudflare id', async () => {
    pool()
      .intercept({ path: `${BASE}?hostname=${encodeURIComponent(HOST)}`, method: 'GET' })
      .reply(502, { success: false });
    // A concurrent winner commits its id while our create is in flight.
    const spy = vi
      .spyOn(CloudflareSaasClient.prototype, 'create')
      .mockImplementationOnce(async () => {
        await ds.query(
          `UPDATE school_sites SET custom_domain_external_id = $2 WHERE tenant_id = $1`,
          [SEED_TENANT_ID, CF_ID],
        );
        throw new Error('boom');
      });
    await expect(svc.set(SEED_TENANT_ID, HOST)).rejects.toMatchObject({
      message: 'site.custom_domain_try_later',
    });
    spy.mockRestore();
    expect(await row()).toMatchObject({ custom_domain: HOST, custom_domain_external_id: CF_ID });
  });

  describe('replace', () => {
    const NEW_HOST = 'www.cd-int-new.example.edu';
    const NEW_ID = '9'.repeat(32);
    const makeActive = async () => {
      await attach();
      await ds.query(
        `UPDATE school_sites SET custom_domain_status = 'ACTIVE' WHERE tenant_id = $1`,
        [SEED_TENANT_ID],
      );
    };

    it('a refused replace (Cloudflare rejects) leaves the ACTIVE domain untouched', async () => {
      await makeActive();
      pool()
        .intercept({ path: BASE, method: 'POST' })
        .reply(400, { success: false, errors: [{ message: 'hostname is not allowed' }] });
      await expect(svc.set(SEED_TENANT_ID, NEW_HOST)).rejects.toMatchObject({
        message: 'site.custom_domain_unavailable',
      });
      expect(await row()).toMatchObject({
        custom_domain: HOST,
        custom_domain_status: 'ACTIVE',
        custom_domain_external_id: CF_ID,
      });
      expect(await hosts.resolve(HOST)).toMatchObject({ tenantId: SEED_TENANT_ID });
    });

    it('a replace onto a host another school owns is refused before Cloudflare, domain untouched', async () => {
      await makeActive();
      await makeOther();
      await ds.query(`UPDATE school_sites SET custom_domain = $2 WHERE tenant_id = $1`, [
        OTHER_TENANT,
        NEW_HOST,
      ]);
      await expect(svc.set(SEED_TENANT_ID, NEW_HOST)).rejects.toMatchObject({
        message: 'site.custom_domain_unavailable',
      });
      expect((await row()).custom_domain).toBe(HOST);
    });

    it('Cloudflare down during a replace keeps the old domain', async () => {
      await makeActive();
      pool().intercept({ path: BASE, method: 'POST' }).reply(503, { success: false });
      await expect(svc.set(SEED_TENANT_ID, NEW_HOST)).rejects.toMatchObject({
        message: 'site.custom_domain_try_later',
      });
      expect(await row()).toMatchObject({ custom_domain: HOST, custom_domain_status: 'ACTIVE' });
    });

    it('a successful replace creates the new hostname first, swaps, then deletes the old', async () => {
      await makeActive();
      pool()
        .intercept({ path: BASE, method: 'POST' })
        .reply(200, {
          success: true,
          result: { ...cfAnswer('pending', 'initializing').result, id: NEW_ID },
        });
      pool()
        .intercept({ path: `${BASE}/${CF_ID}`, method: 'DELETE' })
        .reply(200, { success: true, result: { id: CF_ID } });
      const dto = await svc.set(SEED_TENANT_ID, NEW_HOST);
      expect(dto).toMatchObject({ host: NEW_HOST, status: 'PENDING_DNS' });
      expect((await row()).custom_domain_external_id).toBe(NEW_ID);
    });
  });

  describe('remove and Cloudflare 4xx', () => {
    it('a 4xx saying the hostname does not exist clears the row', async () => {
      await attach();
      pool()
        .intercept({ path: `${BASE}/${CF_ID}`, method: 'DELETE' })
        .reply(400, { success: false, errors: [{ message: 'Custom hostname does not exist.' }] });
      await svc.remove(SEED_TENANT_ID);
      expect((await row()).custom_domain).toBeNull();
    });

    it('any other 4xx stays "try later" and keeps the row', async () => {
      await attach();
      pool()
        .intercept({ path: `${BASE}/${CF_ID}`, method: 'DELETE' })
        .reply(400, { success: false, errors: [{ message: 'something else' }] });
      await expect(svc.remove(SEED_TENANT_ID)).rejects.toMatchObject({
        message: 'site.custom_domain_try_later',
      });
      expect((await row()).custom_domain).toBe(HOST);
    });
  });

  describe('write cap (the Cloudflare token is shared by every school)', () => {
    it('the 21st PUT in an hour is 429', async () => {
      pool()
        .intercept({ path: BASE, method: 'POST' })
        .reply(200, cfAnswer('pending', 'initializing'));
      await svc.set(SEED_TENANT_ID, HOST);
      for (let i = 0; i < 19; i++) await svc.set(SEED_TENANT_ID, HOST); // same host: early return, still charged
      await expect(svc.set(SEED_TENANT_ID, HOST)).rejects.toMatchObject({ status: 429 });
    });

    it('Redis down: PUT fails closed (503), DELETE still works', async () => {
      redis.down = true;
      await expect(svc.set(SEED_TENANT_ID, HOST)).rejects.toMatchObject({
        message: 'site.custom_domain_try_later',
      });
      await expect(svc.remove(SEED_TENANT_ID)).resolves.toBeUndefined();
    });
  });

  it('the API token never appears in logs or errors across failing Cloudflare calls', async () => {
    const logged: string[] = [];
    const spies = (['warn', 'error', 'log'] as const).map((m) =>
      vi.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => {
        logged.push(a.map(String).join(' '));
      }),
    );
    pool()
      .intercept({ path: BASE, method: 'POST' })
      .reply(500, {
        success: false,
        errors: [{ message: 'token test-token-never-logged rejected' }],
      });
    pool()
      .intercept({ path: `${BASE}?hostname=${encodeURIComponent(HOST)}`, method: 'GET' })
      .reply(500, {});
    const err = await svc.set(SEED_TENANT_ID, HOST).catch((e) => e);
    spies.forEach((x) => x.mockRestore());
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify([logged, err.message, err.getResponse?.()])).not.toContain(
      'test-token-never-logged',
    );
  });

  it('a Cloudflare 4xx WITH error text maps to the fixed 409 and echoes nothing', async () => {
    pool()
      .intercept({ path: BASE, method: 'POST' })
      .reply(400, {
        success: false,
        errors: [{ message: 'Hostname www.cd-int.example.edu is banned by policy 77' }],
      });
    pool()
      .intercept({ path: `${BASE}?hostname=${encodeURIComponent(HOST)}`, method: 'GET' })
      .reply(200, { success: true, result: [] });
    const err = await svc.set(SEED_TENANT_ID, HOST).catch((e) => e);
    expect(err.message).toBe('site.custom_domain_unavailable');
    expect(JSON.stringify(err.getResponse())).not.toContain('banned');
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
