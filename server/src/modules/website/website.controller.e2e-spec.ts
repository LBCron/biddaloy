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
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
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
    // As main.ts does, so the 404 bodies checked below are the ones production sends.
    app.useGlobalFilters(new AllExceptionsFilter());
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
    await ds.query(`DELETE FROM users WHERE id = $1`, [teacherUserId]);
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

  // Mandatory per route: no X-Tenant-ID, a tenant the user is not in, and a non-UUID value.
  it('GET /website: missing, foreign or malformed X-Tenant-ID is 401', async () => {
    await admin('get', '/website', { tenant: null }).expect(401);
    await admin('get', '/website', { tenant: BOGUS_TENANT }).expect(401);
    await admin('get', '/website', { tenant: 'not-a-uuid' }).expect(401);
  });

  it('GET /website/themes: missing, foreign or malformed X-Tenant-ID is 401', async () => {
    await admin('get', '/website/themes', { tenant: null }).expect(401);
    await admin('get', '/website/themes', { tenant: BOGUS_TENANT }).expect(401);
    await admin('get', '/website/themes', { tenant: 'not-a-uuid' }).expect(401);
  });

  it('PUT /website/draft: missing, foreign or malformed X-Tenant-ID is 401', async () => {
    const body = { config: {}, draft_revision: 0 };
    await admin('put', '/website/draft', { tenant: null }).send(body).expect(401);
    await admin('put', '/website/draft', { tenant: BOGUS_TENANT }).send(body).expect(401);
    await admin('put', '/website/draft', { tenant: 'not-a-uuid' }).send(body).expect(401);
  });

  it('POST /website/publish: missing, foreign or malformed X-Tenant-ID is 401', async () => {
    const body = { version: 0, draft_revision: 0 };
    const post = (tenant: string | null) =>
      admin('post', '/website/publish', { tenant }).set('Idempotency-Key', randomUUID()).send(body);
    await post(null).expect(401);
    await post(BOGUS_TENANT).expect(401);
    await post('not-a-uuid').expect(401);
  });

  it('POST /website/enabled: missing, foreign or malformed X-Tenant-ID is 401', async () => {
    const body = { enabled: false };
    await admin('post', '/website/enabled', { tenant: null }).send(body).expect(401);
    await admin('post', '/website/enabled', { tenant: BOGUS_TENANT }).send(body).expect(401);
    await admin('post', '/website/enabled', { tenant: 'not-a-uuid' }).send(body).expect(401);
  });
  // test/setup.ts clears school_sites, site_media and notices before every test, so each test
  // builds the site it needs through the real routes (`liveSite`) instead of relying on order.
  describe('editing and publishing', () => {
    type Config = {
      palette: string;
      pages: { page: string; sections: { key: string; data: Record<string, unknown> }[] }[];
    };
    const send = (method: 'put' | 'post', path: string, body: object) =>
      admin(method, path).send(body);
    // Publish needs an Idempotency-Key (Rule 25); a fresh key per call so no replay hides a 409.
    const publish = (body: object) =>
      admin('post', '/website/publish').set('Idempotency-Key', randomUUID()).send(body);
    const strip = (body: Record<string, unknown>) => {
      const { requestId: _r, timestamp: _t, ...rest } = body;
      return rest;
    };
    const by = (host: string, path: string) =>
      api().get(`/api/v1/public/site/by-host/${host}${path}`);
    const binary = (res: unknown, cb: (err: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      (res as Readable).on('data', (c: Buffer) => chunks.push(c));
      (res as Readable).on('end', () => cb(null, Buffer.concat(chunks)));
    };

    /** Saves a green draft (plus `edit`), publishes it and, unless told not to, switches it on. */
    async function liveSite(o: { edit?: (c: Config) => void; enable?: boolean } = {}) {
      const site = (await admin('get', '/website').expect(200)).body;
      const config = JSON.parse(JSON.stringify(site.draft)) as Config;
      config.palette = 'green';
      o.edit?.(config);
      const saved = (
        await send('put', '/website/draft', { config, draft_revision: site.draft_revision }).expect(
          200,
        )
      ).body;
      const published = (
        await publish({ version: saved.version, draft_revision: saved.draft_revision }).expect(200)
      ).body;
      if (o.enable !== false) await send('post', '/website/enabled', { enabled: true }).expect(200);
      return { host: `${published.subdomain}.${ROOT}`, site: published };
    }

    it('rejects an unknown palette with a fixed code and never echoes it (Rule 23)', async () => {
      const site = (await admin('get', '/website').expect(200)).body;
      const config = { ...site.draft, palette: 'secret-palette-xyz' };
      const res = await send('put', '/website/draft', {
        config,
        draft_revision: site.draft_revision,
      }).expect(400);
      expect(res.body.message).toBe('site.invalid');
      expect(res.text).not.toContain('secret-palette-xyz');
    });

    it('a site that was never published cannot be switched on (409)', async () => {
      const res = await send('post', '/website/enabled', { enabled: true }).expect(409);
      expect(res.body.message).toBe('site.not_published');
    });

    it('saves a draft, then publishes and bumps the version; a stale token is 409', async () => {
      const site = (await admin('get', '/website').expect(200)).body;
      const { version, draft_revision: rev } = site;
      const config = JSON.parse(JSON.stringify(site.draft));
      config.palette = 'green';
      const saved = await send('put', '/website/draft', { config, draft_revision: rev }).expect(
        200,
      );
      expect(saved.body.draft_revision).toBe(rev + 1);
      // A second editor still on the old revision cannot overwrite that save.
      const stale = await send('put', '/website/draft', { config, draft_revision: rev }).expect(
        409,
      );
      expect(stale.body.message).toBe('site.stale');

      // Publishing a draft the publisher never saw (the old revision) is refused.
      const unseen = await publish({ version, draft_revision: rev }).expect(409);
      expect(unseen.body.message).toBe('site.stale');
      const published = await publish({ version, draft_revision: rev + 1 }).expect(200);
      expect(published.body.version).toBe(version + 1);
      expect(published.body.has_published).toBe(true);
      // Someone already published from this version.
      await publish({ version, draft_revision: rev + 1 }).expect(409);
    });

    it('publish without an Idempotency-Key is 400 (Rule 25)', async () => {
      const site = (await admin('get', '/website').expect(200)).body;
      const res = await send('post', '/website/publish', {
        version: site.version,
        draft_revision: site.draft_revision,
      }).expect(400);
      expect(res.body.message).toMatch(/Idempotency-Key/);
      // Nothing was published.
      expect((await admin('get', '/website').expect(200)).body.has_published).toBe(false);
    });

    it('a switched-off site and an unknown host answer the same 404, never naming the host', async () => {
      const { host } = await liveSite({ enable: false });
      const off = await by(host, '/manifest').expect(404);
      const unknown = await by('nobody.sites.e2e.test', '/manifest').expect(404);
      // requestId and timestamp differ per request by design; everything else must match.
      expect(strip(off.body)).toEqual(strip(unknown.body));
      expect(off.body.message).toBe('site.not_found');
      expect(off.text).not.toContain(host);
      expect(unknown.text).not.toContain('nobody');
    });

    it('serves manifest and page in draft order once switched on', async () => {
      const { host, site } = await liveSite();
      const manifest = await by(host, '/manifest').expect(200);
      expect(manifest.body.palette).toBe('green');
      expect(manifest.body.schoolName.en).toBe('Test School');
      const home = site.draft.pages.find((p: { page: string }) => p.page === 'home');
      const page = await by(host, '/page/home').expect(200);
      expect(page.body.sections.map((s: { key: string }) => s.key)).toEqual(
        home.sections
          .filter((s: { enabled: boolean }) => s.enabled)
          .map((s: { key: string }) => s.key),
      );
      await by(host, '/page/not-a-page').expect(404);
    });

    it('still serves page/home while Redis is down (fail open, D42)', async () => {
      const { host } = await liveSite();
      const redis = app.get(TENANT_STATUS_REDIS);
      const down = () => Promise.reject(new Error('redis down'));
      const spies = [
        vi.spyOn(redis, 'get').mockImplementation(down as never),
        vi.spyOn(redis, 'set').mockImplementation(down as never),
        vi.spyOn(redis, 'del').mockImplementation(down as never),
      ];
      try {
        await by(host, '/page/home').expect(200);
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
    });

    it('notices island lists only public published notices', async () => {
      const { host } = await liveSite();
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
      const res = await by(host, '/island/notices').expect(200);
      const titles = res.body.map((n: { title: string }) => n.title);
      expect(titles).toContain(`site-${tag}-public`);
      expect(titles).not.toContain(`site-${tag}-private`);
      await by(host, '/island/events').expect(404);
    });

    it('streams the school logo; another school’s picture is a 404', async () => {
      const { host } = await liveSite();
      const storage = app.get(StorageService);
      const key = `tenants/${SEED_TENANT_ID}/website-logo-${tag}.webp`;
      const bytes = Buffer.from('RIFFfakewebp');
      await storage.put(key, bytes, 'image/webp');
      await ds.query(`UPDATE schools SET logo_key = $2 WHERE id = $1`, [SEED_TENANT_ID, key]);
      const logo = await by(host, '/media/logo').buffer(true).parse(binary).expect(200);
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
      await by(host, `/media/${id}`).expect(404);
    });

    it('serves only a picture the published site shows, with ETag and 304', async () => {
      const storage = app.get(StorageService);
      const key = `tenants/${SEED_TENANT_ID}/website-hero-${tag}.webp`;
      const bytes = Buffer.from('RIFFherowebp');
      await storage.put(key, bytes, 'image/webp');
      const hash = 'b'.repeat(64);
      const [{ id: shown }] = await ds.query(
        `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes)
         VALUES ($1,'hero',$2,$3,10,10,12) RETURNING id`,
        [SEED_TENANT_ID, key, hash],
      );
      // Same tenant, but not in the published config (e.g. a removed teacher photo).
      const [{ id: hidden }] = await ds.query(
        `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes)
         VALUES ($1,'person',$2,$3,10,10,12) RETURNING id`,
        [SEED_TENANT_ID, key.replace('hero', 'person'), 'c'.repeat(64)],
      );
      const { host } = await liveSite({
        edit: (c) => {
          c.pages.find((p) => p.page === 'home')!.sections[0].data.images = [shown];
        },
      });

      const ok = await by(host, `/media/${shown}`).buffer(true).parse(binary).expect(200);
      expect(ok.headers.etag).toBe(`"${hash}"`);
      expect((ok.body as Buffer).equals(bytes)).toBe(true);
      await by(host, `/media/${shown}`).set('If-None-Match', `"${hash}"`).expect(304);
      await by(host, `/media/${hidden}`).expect(404);
      // An unreferenced row never answers 304 either: no hint that it exists.
      await by(host, `/media/${hidden}`)
        .set('If-None-Match', `"${'c'.repeat(64)}"`)
        .expect(404);
      await storage.delete(key);
    });

    it('a picture whose stored file fails mid-read answers the same JSON 404', async () => {
      const [{ id: shown }] = await ds.query(
        `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes)
         VALUES ($1,'hero',$2,$3,10,10,12) RETURNING id`,
        [SEED_TENANT_ID, `tenants/${SEED_TENANT_ID}/broken-${tag}.webp`, 'd'.repeat(64)],
      );
      const { host } = await liveSite({
        edit: (c) => {
          c.pages.find((p) => p.page === 'home')!.sections[0].data.images = [shown];
        },
      });
      const storage = app.get(StorageService);
      const spy = vi.spyOn(storage, 'getForTenant').mockResolvedValue({
        body: new Readable({
          read() {
            this.destroy(new Error('bucket gone'));
          },
        }),
        contentType: 'image/webp',
      });
      try {
        const res = await by(host, `/media/${shown}`).expect(404);
        expect(res.headers['content-type']).toContain('application/json');
        expect(res.headers.etag).toBeUndefined();
        expect(res.body.message).toBe('site.not_found');
        expect(res.text).not.toContain(host);
      } finally {
        spy.mockRestore();
      }
    });

    it('an old subdomain inside its window answers 301 with the new address', async () => {
      const { site } = await liveSite();
      await ds.query(
        `UPDATE school_sites SET previous_subdomain = $2, previous_until = NOW() + interval '1 day' WHERE tenant_id = $1`,
        [SEED_TENANT_ID, `old-${tag}`],
      );
      const res = await by(`old-${tag}.${ROOT}`, '/manifest').expect(301);
      expect(res.body.to).toBe(`${site.subdomain}.${ROOT}`);
    });

    // A switched-off school must not use its old address to reveal its new one.
    it('a switched-off site’s old subdomain answers 404, not 301', async () => {
      await liveSite({ enable: false });
      await ds.query(
        `UPDATE school_sites SET previous_subdomain = $2, previous_until = NOW() + interval '1 day' WHERE tenant_id = $1`,
        [SEED_TENANT_ID, `old-${tag}`],
      );
      const res = await by(`old-${tag}.${ROOT}`, '/manifest').expect(404);
      expect(res.body.message).toBe('site.not_found');
      expect(res.body.to).toBeUndefined();
    });
  });
});
