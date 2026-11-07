import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { SITE_FEATURED_TEACHERS_MAX, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

const ROOT = 'content.e2e.test';
const BOGUS_TENANT = '00000000-0000-4000-8000-0000000000fe';
const body = [{ type: 'paragraph', children: [{ text: 'Hello' }] }];

/** [40.3.01] Posts, enquiries and teacher cards: ADMIN-only routes, plus the public enquiry write. */
describe('Website content API E2E (posts, enquiries, teachers)', () => {
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

  /** Switches the seed school's site on (a published draft) and returns its host. */
  const liveHost = async () => {
    const site = (await admin('get', '/website').expect(200)).body;
    await ds.query(
      `UPDATE school_sites SET published = draft, enabled = true WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    return `${site.subdomain}.${ROOT}`;
  };
  const enquiry = (host: string, extra: object = {}) =>
    api()
      .post(`/api/v1/public/site/by-host/${host}/island/enquiry`)
      .send({
        name: 'Rahim',
        phone: '01712345678',
        message: 'Is admission open?',
        captcha_token: 'any-token',
        ...extra,
      });

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
       VALUES ($1,$2,'Content Teacher','ACTIVE',NOW(),NOW()) RETURNING id`,
      [`website-content-teacher-${tag}@e2e.example`, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
      [teacherUserId, SEED_TENANT_ID],
    );
    teacherToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({
          email: `website-content-teacher-${tag}@e2e.example`,
          password: SEED_ADMIN_PASSWORD,
        })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  afterAll(async () => {
    await ds.query(`DELETE FROM site_posts WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM site_enquiries WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM staff_web_profiles WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(
      `DELETE FROM user_tenants WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`website-content-%-${tag}@e2e.example`],
    );
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [
      `website-content-%-${tag}@e2e.example`,
    ]);
    await app.close();
  });

  describe('posts', () => {
    it('creates, publishes, hides and deletes a post; slug is fixed; version bumps', async () => {
      const v0 = (await admin('get', '/website').expect(200)).body.version;
      const created = await admin('post', '/website/posts')
        .set('Idempotency-Key', randomUUID())
        .send({ title: { bn: '', en: 'First Post' }, body })
        .expect(201);
      expect(created.body.slug).toMatch(/^first-post-[0-9a-f]{4}$/);
      expect(created.body.published_at).toBeNull();

      const pub = await admin('post', `/website/posts/${created.body.id}/publish`)
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      expect(pub.body.published_at).not.toBeNull();
      expect((await admin('get', '/website').expect(200)).body.version).toBeGreaterThan(v0);

      const edited = await admin('put', `/website/posts/${created.body.id}`)
        .send({ title: { bn: '', en: 'Renamed' }, body })
        .expect(200);
      expect(edited.body.slug).toBe(created.body.slug);

      await admin('post', `/website/posts/${created.body.id}/unpublish`).expect(200);
      await admin('delete', `/website/posts/${created.body.id}`).expect(204);
      await admin('get', `/website/posts/${created.body.id}`).expect(404);
    });

    it('a bad body or title is 400 with one fixed sentence that never echoes input', async () => {
      const bad = [{ type: 'script', children: [{ text: 'SECRET-MARKER' }] }];
      const a = await admin('post', '/website/posts')
        .set('Idempotency-Key', randomUUID())
        .send({ title: { bn: 'x', en: 'x' }, body: bad })
        .expect(400);
      const b = await admin('post', '/website/posts')
        .set('Idempotency-Key', randomUUID())
        .send({ title: { bn: '', en: '' }, body })
        .expect(400);
      expect(a.body.message).toBe('site.post_invalid');
      expect(b.body.message).toBe('site.post_invalid');
      expect(a.text).not.toContain('SECRET-MARKER');
    });

    it('a picture id from nowhere is refused', async () => {
      const img = [{ type: 'image', mediaId: randomUUID(), alt: '', children: [{ text: '' }] }];
      const r = await admin('post', '/website/posts')
        .set('Idempotency-Key', randomUUID())
        .send({ title: { bn: 'x', en: 'x' }, body: img })
        .expect(400);
      expect(r.body.message).toBe('site.post_invalid');
    });

    it('a non-UUID id is 400 (Rule 3); list limit over 100 is 400 (Rule 5)', async () => {
      await admin('get', '/website/posts/not-a-uuid').expect(400);
      await admin('get', '/website/posts?limit=101').expect(400);
    });
  });

  describe('enquiries', () => {
    it('stores a public enquiry; the admin lists, ticks seen and deletes it', async () => {
      const host = await liveHost();
      const res = await enquiry(host).expect(201);
      expect(res.body).toEqual({ received: true });

      const list = (await admin('get', '/website/enquiries').expect(200)).body;
      expect(list.total).toBe(1);
      expect(list.unseen).toBe(1);
      const id = list.items[0].id;
      expect(list.items[0]).toMatchObject({ name: 'Rahim', phone: '01712345678' });

      const seen = await admin('post', `/website/enquiries/${id}/seen`).expect(200);
      expect(seen.body.seen_at).not.toBeNull();
      expect((await admin('get', '/website/enquiries').expect(200)).body.unseen).toBe(0);
      await admin('delete', `/website/enquiries/${id}`).expect(204);
      expect((await admin('get', '/website/enquiries').expect(200)).body.total).toBe(0);
    });

    it('is 400 without a captcha token and stores nothing', async () => {
      const host = await liveHost();
      await api()
        .post(`/api/v1/public/site/by-host/${host}/island/enquiry`)
        .send({ name: 'Rahim', phone: '01712345678', message: 'Hi' })
        .expect(400);
      expect((await admin('get', '/website/enquiries').expect(200)).body.total).toBe(0);
    });

    it('is 400 CAPTCHA_FAILED when Cloudflare says no, and stores nothing', async () => {
      const host = await liveHost();
      const config = app.get(ConfigService);
      const realGet = config.get.bind(config);
      const spy = vi
        .spyOn(config, 'get')
        .mockImplementation(((key: string) =>
          key === 'TURNSTILE_SECRET_KEY' ? 'test-secret' : realGet(key)) as typeof config.get);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }),
      );
      try {
        const r = await enquiry(host).expect(400);
        expect(r.body.details.code).toBe('CAPTCHA_FAILED');
      } finally {
        spy.mockRestore();
        vi.unstubAllGlobals();
      }
      expect((await admin('get', '/website/enquiries').expect(200)).body.total).toBe(0);
    });

    it('is 503 in production with no Turnstile secret (fails closed, Rule 22)', async () => {
      const host = await liveHost();
      const config = app.get(ConfigService);
      const realGet = config.get.bind(config);
      const spy = vi
        .spyOn(config, 'get')
        .mockImplementation(((key: string) =>
          key === 'TURNSTILE_SECRET_KEY'
            ? undefined
            : key === 'NODE_ENV'
              ? 'production'
              : realGet(key)) as typeof config.get);
      try {
        await enquiry(host).expect(503);
      } finally {
        spy.mockRestore();
      }
      expect((await admin('get', '/website/enquiries').expect(200)).body.total).toBe(0);
    });

    it('a bad phone is 400', async () => {
      const host = await liveHost();
      await enquiry(host, { phone: '12345' }).expect(400);
    });

    it('a disabled site and an unknown host answer the identical 404', async () => {
      const host = await liveHost();
      await ds.query(`UPDATE school_sites SET enabled = false WHERE tenant_id = $1`, [
        SEED_TENANT_ID,
      ]);
      const off = await enquiry(host).expect(404);
      const unknown = await enquiry(`nobody.${ROOT}`).expect(404);
      const strip = (b: Record<string, unknown>) => {
        const { requestId: _r, timestamp: _t, ...rest } = b;
        return rest;
      };
      expect(strip(off.body)).toEqual(strip(unknown.body));
      expect((await admin('get', '/website/enquiries').expect(200)).body.total).toBe(0);
    });

    // The e2e stack turns throttling off when NODE_ENV=test (app.module.ts `skipIf`), so the tier
    // is asserted as a constant, the same way the admission e2e does.
    it('is wired to the STRICT_RATE_LIMIT tier (5/min per IP)', () => {
      expect(STRICT_RATE_LIMIT).toEqual({ limit: 5, ttl: 60_000 });
      const handler = Object.getOwnPropertyDescriptor(
        require('./site-enquiries.controller').PublicEnquiryController.prototype,
        'create',
      )!.value;
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(5);
    });
  });

  describe('teachers', () => {
    it('lists teachers; saves a card; 9th featured is 400; another school photo is refused', async () => {
      const list = (await admin('get', '/website/teachers').expect(200)).body;
      expect(list.find((t: { user_id: string }) => t.user_id === teacherUserId)).toMatchObject({
        show_on_website: false,
      });

      const saved = await admin('put', `/website/teachers/${teacherUserId}`)
        .send({
          show_on_website: true,
          featured: true,
          subjects: ['Math'],
          bio: { bn: 'ক', en: 'a' },
        })
        .expect(200);
      expect(saved.body).toMatchObject({ show_on_website: true, featured: true });

      // Fill the featured quota with other teachers, then the next one is refused.
      const ids: string[] = [];
      for (let i = 0; i < SITE_FEATURED_TEACHERS_MAX; i++) {
        const [{ id }] = await ds.query(
          `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
           VALUES ($1,$2,$3,'ACTIVE',NOW(),NOW()) RETURNING id`,
          [`website-content-f${i}-${tag}@e2e.example`, SEED_ADMIN_PASSWORD_HASH, `Featured ${i}`],
        );
        await ds.query(
          `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
           VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
          [id, SEED_TENANT_ID],
        );
        ids.push(id);
      }
      // 1 already featured + 7 more = 8; the 8th extra is the 9th overall.
      for (const id of ids.slice(0, SITE_FEATURED_TEACHERS_MAX - 1)) {
        await admin('put', `/website/teachers/${id}`)
          .send({ show_on_website: true, featured: true })
          .expect(200);
      }
      const ninth = await admin('put', `/website/teachers/${ids[SITE_FEATURED_TEACHERS_MAX - 1]}`)
        .send({ show_on_website: true, featured: true })
        .expect(400);
      expect(ninth.body.message).toBe('site.profile_invalid');
      // Re-saving one that is already featured is not a 9th.
      await admin('put', `/website/teachers/${teacherUserId}`)
        .send({ show_on_website: true, featured: true })
        .expect(200);

      const bad = await admin('put', `/website/teachers/${teacherUserId}`)
        .send({ show_on_website: true, featured: false, photo_media_id: randomUUID() })
        .expect(400);
      expect(bad.body.message).toBe('site.profile_invalid');
    });

    it('a user who is not staff of this school is 404; a non-UUID is 400', async () => {
      await admin('put', `/website/teachers/${randomUUID()}`)
        .send({ show_on_website: true, featured: false })
        .expect(404);
      await admin('put', '/website/teachers/not-a-uuid')
        .send({ show_on_website: true, featured: false })
        .expect(400);
    });
  });

  describe('access', () => {
    const id = randomUUID();
    const routes: ['get' | 'put' | 'post' | 'delete', string, object?][] = [
      ['get', '/website/posts'],
      ['post', '/website/posts', { title: { bn: 'a', en: 'a' }, body }],
      ['get', `/website/posts/${id}`],
      ['put', `/website/posts/${id}`, { title: { bn: 'a', en: 'a' }, body }],
      ['delete', `/website/posts/${id}`],
      ['post', `/website/posts/${id}/publish`],
      ['post', `/website/posts/${id}/unpublish`],
      ['get', '/website/enquiries'],
      ['post', `/website/enquiries/${id}/seen`],
      ['delete', `/website/enquiries/${id}`],
      ['get', '/website/teachers'],
      ['put', `/website/teachers/${id}`, { show_on_website: true, featured: false }],
    ];

    it('missing or malformed X-Tenant-ID is 401 on every route (bogus tenant too)', async () => {
      for (const [m, p, b] of routes) {
        for (const tenant of [null, BOGUS_TENANT, 'not-a-uuid']) {
          const r = admin(m, p, { tenant });
          await (b ? r.send(b) : r).expect(401);
        }
      }
    });

    it('a TEACHER is 403 on every route', async () => {
      for (const [m, p, b] of routes) {
        const r = api()
          [m](`/api/v1${p}`)
          .set('Authorization', `Bearer ${teacherToken}`)
          .set('X-Role', UserRole.TEACHER)
          .set('X-Tenant-ID', SEED_TENANT_ID);
        await (b ? r.send(b) : r).expect(403);
      }
    });
  });
});
