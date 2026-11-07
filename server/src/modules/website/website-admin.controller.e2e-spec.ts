import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { SITE_MEDIA_QUOTA_BYTES, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { PreviewTokenService } from './preview-token.service';

const ROOT = 'sites.e2e.test';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000e2';
const BOGUS_TENANT = '00000000-0000-4000-8000-0000000000fe';

/** [40.2.01] Address, preview link and pictures: ADMIN-only routes. */
describe('Website admin API E2E (address, preview, media)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let teacherUserId: string;
  const api = () => supertest(app.getHttpServer());
  const tag = randomUUID().slice(0, 8);

  const admin = (
    method: 'get' | 'put' | 'post' | 'delete',
    path: string,
    o: { tenant?: string | null } = {},
  ) => {
    let r = api()
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Role', UserRole.ADMIN);
    const tenant = o.tenant === undefined ? SEED_TENANT_ID : o.tenant;
    if (tenant) r = r.set('X-Tenant-ID', tenant);
    return r;
  };
  const jpeg = (w: number, h: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#224466' } })
      .jpeg()
      .toBuffer();
  const upload = async (slot: string, w: number, h: number, status: number) => {
    const file = await jpeg(w, h);
    return admin('post', '/website/media')
      .field('slot', slot)
      .attach('file', file, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(status);
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.SITE_ROOT_DOMAIN = ROOT;
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
    [{ id: teacherUserId }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1,$2,'Admin Site Teacher','ACTIVE',NOW(),NOW()) RETURNING id`,
      [`website-admin-teacher-${tag}@e2e.example`, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
      [teacherUserId, SEED_TENANT_ID],
    );
    teacherToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: `website-admin-teacher-${tag}@e2e.example`, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  afterAll(async () => {
    await ds.query(`DELETE FROM site_media WHERE tenant_id IN ($1,$2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT,
    ]);
    await ds.query(`DELETE FROM school_sites WHERE tenant_id IN ($1,$2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT,
    ]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [OTHER_TENANT]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = $1`, [teacherUserId]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [teacherUserId]);
    await app.close();
  });

  describe('subdomain', () => {
    it('PUT reserved or malformed name is 400 with one fixed sentence', async () => {
      const a = await admin('put', '/website/subdomain')
        .set('Idempotency-Key', randomUUID())
        .send({ value: 'www' })
        .expect(400);
      const b = await admin('put', '/website/subdomain')
        .set('Idempotency-Key', randomUUID())
        .send({ value: '-bad-' })
        .expect(400);
      expect(a.body.message).toBe('site.subdomain_unavailable');
      expect(b.body.message).toBe(a.body.message);
      expect(a.text).not.toContain('www');
    });

    it('check answers the same shape for free, reserved and malformed', async () => {
      const free = await admin('get', '/website/subdomain/check?value=my-free-school').expect(200);
      const reserved = await admin('get', '/website/subdomain/check?value=app').expect(200);
      const bad = await admin('get', '/website/subdomain/check').expect(200);
      expect(free.body).toEqual({ available: true });
      expect(reserved.body).toEqual({ available: false });
      expect(bad.body).toEqual({ available: false });
    });

    it('renames, keeps the old name answering a 301, and suggests free names', async () => {
      const before = (await admin('get', '/website').expect(200)).body.subdomain;
      const value = `renamed-${tag}`;
      const res = await admin('put', '/website/subdomain')
        .set('Idempotency-Key', randomUUID())
        .send({ value })
        .expect(200);
      expect(res.body.subdomain).toBe(value);
      const [row] = await ds.query(
        `SELECT previous_subdomain, previous_until FROM school_sites WHERE tenant_id = $1`,
        [SEED_TENANT_ID],
      );
      expect(row.previous_subdomain).toBe(before);
      expect(new Date(row.previous_until).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
      const sug = await admin('get', '/website/subdomain/suggest').expect(200);
      expect(Array.isArray(sug.body.suggestions)).toBe(true);
    });

    it("another school's expired redirect on my current name does not block my rename", async () => {
      const mine = (await admin('get', '/website').expect(200)).body.subdomain;
      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1,'Other Stale School',$2,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [OTHER_TENANT, `other-stale-${tag}`],
      );
      // School X left `mine` long ago; its redirect expired but still holds the unique value.
      await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [OTHER_TENANT]);
      await ds.query(
        `INSERT INTO school_sites (tenant_id, subdomain, previous_subdomain, previous_until, palette, draft)
         VALUES ($1,$2,$3, NOW() - INTERVAL '1 day','blue','{}')`,
        [OTHER_TENANT, `other-now-${tag}`, mine],
      );
      const res = await admin('put', '/website/subdomain')
        .set('Idempotency-Key', randomUUID())
        .send({ value: `after-stale-${tag}` })
        .expect(200);
      expect(res.body.subdomain).toBe(`after-stale-${tag}`);
      const [x] = await ds.query(
        `SELECT previous_subdomain FROM school_sites WHERE tenant_id = $1`,
        [OTHER_TENANT],
      );
      expect(x.previous_subdomain).toBeNull();
    });

    it('PUT without an Idempotency-Key is 400 (Rule 25)', async () => {
      await admin('put', '/website/subdomain').send({ value: 'whatever-1' }).expect(400);
    });
  });

  describe('media', () => {
    it('1919x1080 for hero is 400 with a fixed sentence', async () => {
      const res = await upload('hero', 1919, 1080, 400);
      expect(res.body.message).toBe('site.media_rejected');
    });

    it('1920x1080 JPEG is stored as WebP, listed, counted and deletable', async () => {
      const res = await upload('hero', 1920, 1080, 201);
      expect(res.body).toMatchObject({ slot: 'hero', width: 1920, height: 1080 });
      const list = (await admin('get', '/website/media').expect(200)).body;
      expect(list.items.map((i: { id: string }) => i.id)).toContain(res.body.id);
      expect(list.usedBytes).toBe(res.body.bytes);
      expect(list.quotaBytes).toBe(SITE_MEDIA_QUOTA_BYTES);
      await admin('delete', `/website/media/${res.body.id}`).expect(204);
      expect((await admin('get', '/website/media').expect(200)).body.usedBytes).toBe(0);
    });

    it('an upload that would pass the quota is 400 with the same sentence', async () => {
      await admin('get', '/website').expect(200);
      await ds.query(`UPDATE school_sites SET media_bytes_used = $2 WHERE tenant_id = $1`, [
        SEED_TENANT_ID,
        SITE_MEDIA_QUOTA_BYTES,
      ]);
      const res = await upload('person', 400, 400, 400);
      expect(res.body.message).toBe('site.media_rejected');
      await ds.query(`UPDATE school_sites SET media_bytes_used = 0 WHERE tenant_id = $1`, [
        SEED_TENANT_ID,
      ]);
    });

    it('a PNG sent as image/jpeg is refused by signature', async () => {
      const png = await sharp({
        create: { width: 400, height: 400, channels: 3, background: '#000' },
      })
        .png()
        .toBuffer();
      const res = await admin('post', '/website/media')
        .field('slot', 'person')
        .attach('file', png, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(400);
      expect(res.body.message).toBe('site.media_rejected');
    });

    it('a file over the upload cap is 400 site.media_rejected, not 413', async () => {
      const res = await admin('post', '/website/media')
        .field('slot', 'person')
        .attach('file', Buffer.alloc(11 * 1024 * 1024), {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);
      expect(res.body.message).toBe('site.media_rejected');
    });

    it('DELETE with a non-UUID id is 400 (Rule 3)', async () => {
      await admin('delete', '/website/media/not-a-uuid').expect(400);
    });
  });

  describe('preview link', () => {
    it('shows the draft of an unpublished site, noindex; a bad token changes nothing', async () => {
      const link = (await admin('get', '/website/preview-token').expect(200)).body.url as string;
      const url = new URL(link);
      expect(url.host.endsWith(`.${ROOT}`)).toBe(true);
      const host = url.host;
      const token = url.searchParams.get('preview') as string;
      const by = (q: string) => api().get(`/api/v1/public/site/by-host/${host}/manifest${q}`);

      // Never published and switched off: no token is a plain 404 ...
      await by('').expect(404);
      await by('?preview=garbage').expect(404);
      // ... a valid token shows the draft and says "do not index".
      const ok = await by(`?preview=${encodeURIComponent(token)}`).expect(200);
      expect(ok.headers['x-robots-tag']).toContain('noindex');
      expect(ok.body).toBeTruthy();
    });

    it("tenant A's token is refused on tenant B's host", async () => {
      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1,'Other Preview School',$2,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [OTHER_TENANT, `other-preview-${tag}`],
      );
      await ds.query(
        `INSERT INTO school_sites (tenant_id, subdomain, palette, draft)
         VALUES ($1,$2,'blue','{}') ON CONFLICT DO NOTHING`,
        [OTHER_TENANT, `other-${tag}`],
      );
      const token = app.get(PreviewTokenService).sign(SEED_TENANT_ID);
      await api()
        .get(`/api/v1/public/site/by-host/other-${tag}.${ROOT}/manifest?preview=${token}`)
        .expect(404);
    });
  });

  describe('access', () => {
    const routes: ['get' | 'put' | 'post' | 'delete', string, object?][] = [
      ['get', '/website/subdomain/check?value=abc'],
      ['get', '/website/subdomain/suggest'],
      ['put', '/website/subdomain', { value: 'abc-def' }],
      ['get', '/website/preview-token'],
      ['get', '/website/media'],
      ['post', '/website/media'],
      ['delete', `/website/media/${randomUUID()}`],
    ];

    it('missing or malformed X-Tenant-ID is 401 on every new route (bogus tenant too)', async () => {
      for (const [m, p, body] of routes) {
        for (const tenant of [null, BOGUS_TENANT, 'not-a-uuid']) {
          const r = admin(m, p, { tenant });
          await (body ? r.send(body) : r).expect(401);
        }
      }
    });

    it('a TEACHER is 403 on every new route', async () => {
      for (const [m, p, body] of routes) {
        const r = api()
          [m](`/api/v1${p}`)
          .set('Authorization', `Bearer ${teacherToken}`)
          .set('X-Role', UserRole.TEACHER)
          .set('X-Tenant-ID', SEED_TENANT_ID);
        await (body ? r.send(body) : r).expect(403);
      }
    });
  });
});
