import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { CustomDomainController } from './custom-domain.controller';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

const ZONE = 'd'.repeat(32);
const CF_ID = 'e'.repeat(32);
const BASE = `/client/v4/zones/${ZONE}/custom_hostnames`;
const BOGUS_TENANT = '00000000-0000-4000-8000-0000000000fd';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000e6';
const FIXED = 'site.custom_domain_unavailable';

/** [40.4.08] Custom domain and analytics routes: ADMIN-only, closed, one fixed refusal. */
describe('Custom domain API E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let teacherUserId: string;
  let agent: MockAgent;
  const original = getGlobalDispatcher();
  const saved = { ...process.env };
  const api = () => supertest(app.getHttpServer());
  const tag = randomUUID().slice(0, 8);
  const host = `www.cd-e2e-${tag}.example.edu`;

  const as = (
    token: string,
    method: 'get' | 'put' | 'post' | 'delete',
    path: string,
    o: { tenant?: string | null; role?: string } = {},
  ) => {
    const r = api()
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', o.role ?? UserRole.ADMIN);
    const tenant = o.tenant === undefined ? SEED_TENANT_ID : o.tenant;
    if (tenant !== null) r.set('X-Tenant-ID', tenant);
    return r;
  };
  const admin = (m: 'get' | 'put' | 'post' | 'delete', p: string, o = {}) =>
    as(adminToken, m, p, o);
  const cfPool = () => agent.get('https://api.cloudflare.com');

  const configure = (on: boolean) => {
    if (on) {
      process.env.CF_SAAS_API_TOKEN = 'e2e-token';
      process.env.CF_ZONE_ID = ZONE;
    } else {
      delete process.env.CF_SAAS_API_TOKEN;
      delete process.env.CF_ZONE_ID;
    }
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.SITE_ROOT_DOMAIN = 'sites.e2e.test';
    configure(true);
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    ds = app.get(DataSource);
    adminToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
    const [u] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1,$2,'CD Teacher','ACTIVE',NOW(),NOW()) RETURNING id`,
      [`cd-teacher-${tag}@e2e.example`, SEED_ADMIN_PASSWORD_HASH],
    );
    teacherUserId = u.id;
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
      [teacherUserId, SEED_TENANT_ID],
    );
    teacherToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: `cd-teacher-${tag}@e2e.example`, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  /** Per-test reset wipes data between tests, so each test that needs rows builds them. */
  const seedOtherSchoolHost = async () => {
    await admin('get', '/website').expect(200); // creates this school's site row
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,'CD Other','cd-other-${tag}',NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_TENANT],
    );
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft, custom_domain, custom_domain_status)
       VALUES ($1,$2,'blue','{}',$3,'ACTIVE') ON CONFLICT DO NOTHING`,
      [OTHER_TENANT, `cd-o-${tag}`, `www.taken-${tag}.example.edu`],
    );
  };

  afterAll(async () => {
    setGlobalDispatcher(original);
    process.env = saved;
    await ds.query(
      `UPDATE school_sites SET custom_domain = NULL, custom_domain_status = NULL, custom_domain_external_id = NULL,
         custom_domain_records = NULL, custom_domain_since = NULL, custom_domain_checked_at = NULL WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [OTHER_TENANT]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [OTHER_TENANT]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = $1`, [teacherUserId]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [teacherUserId]);
    await app.close();
  });

  const routes: ['get' | 'put' | 'post' | 'delete', string][] = [
    ['get', '/website/custom-domain'],
    ['put', '/website/custom-domain'],
    ['delete', '/website/custom-domain'],
    ['post', '/website/custom-domain/recheck'],
    ['get', '/website/analytics'],
  ];

  describe.each(routes)('%s %s', (method, path) => {
    // The context guard answers 401 for a missing, foreign or malformed X-Tenant-ID (same as /website).
    it.each([
      ['missing', null],
      ['unknown', BOGUS_TENANT],
      ['malformed', 'not-a-uuid'],
    ])('with a %s X-Tenant-ID is 401', async (_name, tenant) => {
      await admin(method, path, { tenant })
        .set('Idempotency-Key', randomUUID())
        .send({ host: 'www.a.example.edu' })
        .expect(401);
    });
    it('for a TEACHER is 403', async () => {
      await as(teacherToken, method, path, { role: UserRole.TEACHER })
        .set('Idempotency-Key', randomUUID())
        .send({ host: 'www.a.example.edu' })
        .expect(403);
    });
    it('anonymous is 401', async () => {
      await api()[method](`/api/v1${path}`).set('X-Tenant-ID', SEED_TENANT_ID).expect(401);
    });
  });

  describe('feature off (direct edge mode or Cloudflare unset)', () => {
    it('every custom-domain route answers 409 with the fixed text', async () => {
      configure(false);
      try {
        for (const [method, path] of routes.filter(([, p]) => p !== '/website/analytics')) {
          const res = await admin(method, path)
            .set('Idempotency-Key', randomUUID())
            .send({ host: 'www.example.edu' })
            .expect(409);
          expect(res.body.message).toBe(FIXED);
        }
      } finally {
        configure(true);
      }
    });
  });

  describe('attach, status, remove (Cloudflare faked)', () => {
    const fresh = () => {
      agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
    };

    it('PUT without an Idempotency-Key is 400 (Rule 25)', async () => {
      await admin('put', '/website/custom-domain').send({ host }).expect(400);
    });

    it('PUT of malformed, platform, and foreign hosts all give the same 409 body', async () => {
      fresh();
      await seedOtherSchoolHost();
      const bodies: string[] = [];
      for (const h of [
        'bad host',
        'foo.sites.e2e.test',
        'xn--bcher-kva.example.edu',
        `www.taken-${tag}.example.edu`, // another school owns it
      ]) {
        const res = await admin('put', '/website/custom-domain')
          .set('Idempotency-Key', randomUUID())
          .send({ host: h });
        expect(res.status, h).toBe(409);
        expect(res.body.message).toBe(FIXED);
        expect(res.text).not.toContain(h);
        bodies.push(res.body.message);
      }
      expect(new Set(bodies).size).toBe(1);
    });

    it('PUT valid host is 202 PENDING_DNS with the two records; apex carries the hint', async () => {
      fresh();
      cfPool()
        .intercept({ path: BASE, method: 'POST' })
        .reply(200, {
          success: true,
          result: {
            id: CF_ID,
            status: 'pending',
            ssl: { status: 'initializing' },
            ownership_verification: { name: `_cf-custom-hostname.${host}`, value: 'own-1' },
          },
        });
      const res = await admin('put', '/website/custom-domain')
        .set('Idempotency-Key', randomUUID())
        .send({ host })
        .expect(202);
      expect(res.body).toMatchObject({ host, status: 'PENDING_DNS', hintKey: null });
      expect(res.body.records).toEqual([
        { type: 'CNAME', name: host, value: 'sites.sites.e2e.test' },
        { type: 'TXT', name: `_cf-custom-hostname.${host}`, value: 'own-1' },
      ]);
      const got = await admin('get', '/website/custom-domain').expect(200);
      expect(got.body.host).toBe(host);
    });

    it('DELETE removes at Cloudflare and clears; the site row answers no custom host', async () => {
      fresh();
      cfPool()
        .intercept({ path: BASE, method: 'POST' })
        .reply(200, {
          success: true,
          result: { id: CF_ID, status: 'pending', ssl: { status: 'initializing' } },
        });
      await admin('put', '/website/custom-domain')
        .set('Idempotency-Key', randomUUID())
        .send({ host })
        .expect(202);
      cfPool()
        .intercept({ path: `${BASE}/${CF_ID}`, method: 'DELETE' })
        .reply(200, { success: true, result: { id: CF_ID } });
      await admin('delete', '/website/custom-domain').expect(204);
      const got = await admin('get', '/website/custom-domain').expect(200);
      expect(got.body).toMatchObject({ host: null, status: null, records: [] });
    });

    it('PUT when Cloudflare is down is 503 try-later and claims nothing', async () => {
      fresh();
      cfPool().intercept({ path: BASE, method: 'POST' }).reply(503, { success: false });
      const res = await admin('put', '/website/custom-domain')
        .set('Idempotency-Key', randomUUID())
        .send({ host })
        .expect(503);
      expect(res.body.message).toBe('site.custom_domain_try_later');
      expect((await admin('get', '/website/custom-domain').expect(200)).body.host).toBeNull();
    });
  });

  describe('analytics', () => {
    it('Umami unset or down is { available: false }', async () => {
      delete process.env.UMAMI_API_URL;
      const res = await admin('get', '/website/analytics').expect(200);
      expect(res.body).toEqual({ available: false });
    });
  });
  describe('more routes and refusals', () => {
    const fresh = () => {
      agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
    };
    const cfOk = (id: string) => ({
      success: true,
      result: {
        id,
        status: 'pending',
        ssl: { status: 'initializing' },
        ownership_verification: { value: 'own-x' },
      },
    });

    it('PUT and DELETE carry the same throttle tier as recheck', () => {
      const proto = CustomDomainController.prototype;
      for (const name of ['set', 'remove', 'recheck'] as const) {
        expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto[name])).toBe(20);
        expect(Reflect.getMetadata('THROTTLER:TTLdefault', proto[name])).toBe(60_000);
      }
    });

    it('an apex host returns the CNAME-flattening hint, and x.edu.bd counts as an apex', async () => {
      fresh();
      cfPool().intercept({ path: BASE, method: 'POST' }).reply(200, cfOk(CF_ID));
      const res = await admin('put', '/website/custom-domain')
        .set('Idempotency-Key', randomUUID())
        .send({ host: `cd-e2e-${tag}.edu.bd` })
        .expect(202);
      expect(res.body.hintKey).toBe('apex_needs_flattening');
    });

    it('recheck asks Cloudflare once and returns the status; Cloudflare down is 503', async () => {
      fresh();
      cfPool().intercept({ path: BASE, method: 'POST' }).reply(200, cfOk(CF_ID));
      await admin('put', '/website/custom-domain')
        .set('Idempotency-Key', randomUUID())
        .send({ host })
        .expect(202);
      cfPool()
        .intercept({ path: `${BASE}/${CF_ID}`, method: 'GET' })
        .reply(200, cfOk(CF_ID));
      const ok = await admin('post', '/website/custom-domain/recheck').expect(200);
      expect(ok.body).toMatchObject({ host, status: 'PENDING_DNS' });
      expect(ok.body.lastCheckedAt).not.toBeNull();
      cfPool()
        .intercept({ path: `${BASE}/${CF_ID}`, method: 'GET' })
        .reply(503, {});
      const down = await admin('post', '/website/custom-domain/recheck').expect(503);
      expect(down.body.message).toBe('site.custom_domain_try_later');
    });

    it('a Cloudflare 4xx with error text is the fixed 409 and nothing is echoed', async () => {
      fresh();
      cfPool()
        .intercept({ path: BASE, method: 'POST' })
        .reply(400, { success: false, errors: [{ message: 'banned by policy 77' }] });
      cfPool()
        .intercept({ path: `${BASE}?hostname=${encodeURIComponent(host)}`, method: 'GET' })
        .reply(200, { success: true, result: [] });
      const res = await admin('put', '/website/custom-domain')
        .set('Idempotency-Key', randomUUID())
        .send({ host })
        .expect(409);
      expect(res.body.message).toBe(FIXED);
      expect(res.text).not.toContain('banned');
    });

    it('analytics: Umami configured but down is { available: false }', async () => {
      fresh();
      process.env.UMAMI_API_URL = 'https://umami.platform.test';
      process.env.UMAMI_API_TOKEN = 'u-token';
      try {
        await admin('get', '/website').expect(200);
        await ds.query(`UPDATE school_sites SET umami_website_id = $2 WHERE tenant_id = $1`, [
          SEED_TENANT_ID,
          '11111111-2222-4333-8444-555555555555',
        ]);
        agent
          .get('https://umami.platform.test')
          .intercept({ path: (p: string) => p.includes('/stats?'), method: 'GET' })
          .reply(500, {});
        const res = await admin('get', '/website/analytics').expect(200);
        expect(res.body).toEqual({ available: false });
      } finally {
        delete process.env.UMAMI_API_URL;
        delete process.env.UMAMI_API_TOKEN;
      }
    });
  });
});
