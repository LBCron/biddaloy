import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { UserRole } from '@biddaloy/shared';
import { StorageService } from '../storage/storage.service';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

const ROOT = 'sites.e2e.test';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000e1';
const BOGUS_TENANT = '00000000-0000-4000-8000-0000000000ff';

/** [40.1.04] School website: ADMIN-only editing routes and the anonymous by-host read routes. */
describe('Website API E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let teacherUserId: string;
  const api = () => supertest(app.getHttpServer());
  const tag = randomUUID().slice(0, 8);

  const admin = (
    method: 'get' | 'put' | 'post',
    path: string,
    o: { tenant?: string | null } = {},
  ) => {
    let r = api()[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);
    r = r.set('X-Role', UserRole.ADMIN);
    const tenant = o.tenant === undefined ? SEED_TENANT_ID : o.tenant;
    if (tenant) r = r.set('X-Tenant-ID', tenant);
    return r;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.SITE_ROOT_DOMAIN = ROOT;
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    adminToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;

    [{ id: teacherUserId }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1,$2,'Site Teacher','ACTIVE',NOW(),NOW()) RETURNING id`,
      [`website-teacher-${tag}@e2e.example`, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
      [teacherUserId, SEED_TENANT_ID],
    );
    teacherToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: `website-teacher-${tag}@e2e.example`, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  afterAll(async () => {
    await ds.query(`DELETE FROM site_media WHERE tenant_id IN ($1,$2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT,
    ]);
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM notices WHERE tenant_id = $1 AND title LIKE $2`, [
      SEED_TENANT_ID,
      `site-${tag}%`,
    ]);
    await ds.query(`UPDATE schools SET logo_key = NULL WHERE id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [OTHER_TENANT]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = $1`, [teacherUserId]);
    await app.close();
  });

  it('anonymous: unknown host answers 404 site.not_found', async () => {
    const res = await api().get('/api/v1/public/site/by-host/unknown.example/manifest').expect(404);
    expect(res.body.message).toBe('site.not_found');
  });

  it('ADMIN GET /website seeds and returns the site', async () => {
    const res = await admin('get', '/website').expect(200);
    expect(res.body.theme).toBe('basic');
    expect(res.body.enabled).toBe(false);
  });

  it('TEACHER GET /website is 403', async () => {
    await api()
      .get('/api/v1/website')
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Role', UserRole.TEACHER)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);
  });

  it('GET /website: missing or foreign X-Tenant-ID is 401', async () => {
    await admin('get', '/website', { tenant: null }).expect(401);
    await admin('get', '/website', { tenant: BOGUS_TENANT }).expect(401);
  });
  describe('editing and publishing', () => {
    let host: string;
    let version: number;
    const send = (method: 'put' | 'post', path: string, body: object) =>
      admin(method, path).send(body);

    it('rejects an unknown palette with a fixed code and never echoes it (Rule 23)', async () => {
      const site = (await admin('get', '/website').expect(200)).body;
      host = `${site.subdomain}.${ROOT}`;
      version = site.version;
      const config = { ...site.draft, palette: 'secret-palette-xyz' };
      const res = await send('put', '/website/draft', { config, version }).expect(400);
      expect(res.body.message).toBe('site.invalid');
      expect(res.text).not.toContain('secret-palette-xyz');
    });

    it('a site that was never published cannot be switched on (409)', async () => {
      const res = await send('post', '/website/enabled', { enabled: true }).expect(409);
      expect(res.body.message).toBe('site.not_published');
    });

    it('saves a draft, then publishes and bumps the version; a stale version is 409', async () => {
      const site = (await admin('get', '/website').expect(200)).body;
      const config = JSON.parse(JSON.stringify(site.draft));
      config.palette = 'green';
      await send('put', '/website/draft', { config, version }).expect(200);
      const stale = await send('put', '/website/draft', { config, version: version + 5 }).expect(
        409,
      );
      expect(stale.body.message).toBe('site.stale');

      const published = await send('post', '/website/publish', { version }).expect(200);
      expect(published.body.version).toBe(version + 1);
      expect(published.body.has_published).toBe(true);
      await send('post', '/website/publish', { version }).expect(409);
      version += 1;
    });

    it('a switched-off site and an unknown host answer byte-identical 404s', async () => {
      const off = await api().get(`/api/v1/public/site/by-host/${host}/manifest`).expect(404);
      const unknown = await api()
        .get('/api/v1/public/site/by-host/nobody.sites.e2e.test/manifest')
        .expect(404);
      expect(off.text).toBe(unknown.text);
    });

    it('serves manifest and page in draft order once switched on', async () => {
      await send('post', '/website/enabled', { enabled: true }).expect(200);
      const manifest = await api().get(`/api/v1/public/site/by-host/${host}/manifest`).expect(200);
      expect(manifest.body.palette).toBe('green');
      expect(manifest.body.schoolName.en).toBe('Test School');
      const site = (await admin('get', '/website').expect(200)).body;
      const home = site.draft.pages.find((p: { page: string }) => p.page === 'home');
      const page = await api().get(`/api/v1/public/site/by-host/${host}/page/home`).expect(200);
      expect(page.body.sections.map((s: { key: string }) => s.key)).toEqual(
        home.sections
          .filter((s: { enabled: boolean }) => s.enabled)
          .map((s: { key: string }) => s.key),
      );
      await api().get(`/api/v1/public/site/by-host/${host}/page/not-a-page`).expect(404);
    });

    it('still serves page/home while Redis is down (fail open, D42)', async () => {
      const redis = app.get(TENANT_STATUS_REDIS);
      const down = () => Promise.reject(new Error('redis down'));
      const spies = [
        vi.spyOn(redis, 'get').mockImplementation(down as never),
        vi.spyOn(redis, 'set').mockImplementation(down as never),
        vi.spyOn(redis, 'scan').mockImplementation(down as never),
      ];
      try {
        await api().get(`/api/v1/public/site/by-host/${host}/page/home`).expect(200);
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
    });

    it('notices island lists only public published notices', async () => {
      const ins = (title: string, isPublic: boolean) =>
        ds.query(
          `INSERT INTO notices (tenant_id, author_user_id, title, body, status, published_at, is_public)
           VALUES ($1,$2,$3,'b','PUBLISHED',NOW(),$4)`,
          [SEED_TENANT_ID, SEED_ADMIN_USER_ID, title, isPublic],
        );
      await ins(`site-${tag}-public`, true);
      await ins(`site-${tag}-private`, false);
      const redis = app.get(TENANT_STATUS_REDIS);
      await redis.del(`site:${SEED_TENANT_ID}:feed:notices`);
      const res = await api().get(`/api/v1/public/site/by-host/${host}/island/notices`).expect(200);
      const titles = res.body.map((n: { title: string }) => n.title);
      expect(titles).toContain(`site-${tag}-public`);
      expect(titles).not.toContain(`site-${tag}-private`);
      await api().get(`/api/v1/public/site/by-host/${host}/island/events`).expect(404);
    });

    it('streams the school logo; another school’s picture is a 404', async () => {
      const storage = app.get(StorageService);
      const key = `tenants/${SEED_TENANT_ID}/website-logo-${tag}.webp`;
      const bytes = Buffer.from('RIFFfakewebp');
      await storage.put(key, bytes, 'image/webp');
      await ds.query(`UPDATE schools SET logo_key = $2 WHERE id = $1`, [SEED_TENANT_ID, key]);
      const logo = await api()
        .get(`/api/v1/public/site/by-host/${host}/media/logo`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          (res as unknown as Readable).on('data', (c: Buffer) => chunks.push(c));
          (res as unknown as Readable).on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(logo.headers['content-type']).toContain('image/webp');
      expect((logo.body as Buffer).equals(bytes)).toBe(true);
      await storage.delete(key);

      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1,'Other Site School',$2,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [OTHER_TENANT, `other-site-${tag}`],
      );
      const [{ id }] = await ds.query(
        `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes)
         VALUES ($1,'hero',$2,$3,10,10,5) RETURNING id`,
        [OTHER_TENANT, `tenants/${OTHER_TENANT}/m-${tag}.webp`, 'a'.repeat(64)],
      );
      await api().get(`/api/v1/public/site/by-host/${host}/media/${id}`).expect(404);
    });

    it('an old subdomain inside its window answers 301 with the new address', async () => {
      const site = (await admin('get', '/website').expect(200)).body;
      await ds.query(
        `UPDATE school_sites SET previous_subdomain = $2, previous_until = NOW() + interval '1 day' WHERE tenant_id = $1`,
        [SEED_TENANT_ID, `old-${tag}`],
      );
      const res = await api()
        .get(`/api/v1/public/site/by-host/old-${tag}.${ROOT}/manifest`)
        .expect(301);
      expect(res.body.to).toBe(`${site.subdomain}.${ROOT}`);
    });
  });
});
