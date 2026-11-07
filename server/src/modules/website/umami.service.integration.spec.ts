import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { UmamiService } from './umami.service';
import { UmamiClient } from './umami.client';

const WEBSITE_ID = '11111111-2222-4333-8444-555555555555';
const URL_ = 'https://umami.platform.test';

/** [40.4.08] One Umami website per school, never blocking, aggregates only. */
describe('UmamiService (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let svc: UmamiService;
  let agent: MockAgent;
  const original = getGlobalDispatcher();
  const saved = { ...process.env };
  const pool = () => agent.get(URL_);
  const idInDb = async () =>
    (
      await ds.query(`SELECT umami_website_id FROM school_sites WHERE tenant_id = $1`, [
        SEED_TENANT_ID,
      ])
    )[0].umami_website_id;

  beforeAll(async () => {
    process.env.SITE_ROOT_DOMAIN = 'schools.test';
    moduleRef = await createTestModule(ALL_ENTITIES, [UmamiService, UmamiClient]);
    ds = moduleRef.get(DataSource);
    svc = moduleRef.get(UmamiService);
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    process.env = saved;
    setGlobalDispatcher(original);
    await moduleRef.close();
  });

  beforeEach(async () => {
    process.env.UMAMI_API_URL = URL_;
    process.env.UMAMI_API_TOKEN = 'umami-token';
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft) VALUES ($1,'umami-int','blue','{}')`,
      [SEED_TENANT_ID],
    );
  });

  it('creates exactly one website, then reuses it (a second call makes no request)', async () => {
    pool().intercept({ path: '/api/websites', method: 'POST' }).reply(200, { id: WEBSITE_ID });
    expect(await svc.ensureWebsite(SEED_TENANT_ID)).toBe(WEBSITE_ID);
    expect(await svc.ensureWebsite(SEED_TENANT_ID)).toBe(WEBSITE_ID); // no 2nd intercept: would throw
    expect(await idInDb()).toBe(WEBSITE_ID);
  });

  it('two concurrent first publishes still create one website', async () => {
    pool().intercept({ path: '/api/websites', method: 'POST' }).reply(200, { id: WEBSITE_ID });
    const [a, b] = await Promise.all([
      svc.ensureWebsite(SEED_TENANT_ID),
      svc.ensureWebsite(SEED_TENANT_ID),
    ]);
    expect([a, b]).toEqual([WEBSITE_ID, WEBSITE_ID]);
  });

  it('Umami down returns null and never throws', async () => {
    pool().intercept({ path: '/api/websites', method: 'POST' }).reply(500, {});
    expect(await svc.ensureWebsite(SEED_TENANT_ID)).toBeNull();
    expect(await idInDb()).toBeNull();
  });

  it('is a no-op when Umami is not configured', async () => {
    delete process.env.UMAMI_API_URL;
    expect(await svc.ensureWebsite(SEED_TENANT_ID)).toBeNull();
  });

  it('monthlyStats returns the 30-day totals, or { available: false } when down', async () => {
    await ds.query(`UPDATE school_sites SET umami_website_id = $2 WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
      WEBSITE_ID,
    ]);
    pool()
      .intercept({ path: (p) => p.startsWith(`/api/websites/${WEBSITE_ID}/stats?`), method: 'GET' })
      .reply(200, { pageviews: { value: 120 }, visitors: { value: 45 } });
    expect(await svc.monthlyStats(SEED_TENANT_ID)).toMatchObject({
      available: true,
      pageviews: 120,
      visitors: 45,
    });
    pool()
      .intercept({ path: (p) => p.startsWith(`/api/websites/${WEBSITE_ID}/stats?`), method: 'GET' })
      .reply(502, {});
    expect(await svc.monthlyStats(SEED_TENANT_ID)).toEqual({ available: false });
  });
});
