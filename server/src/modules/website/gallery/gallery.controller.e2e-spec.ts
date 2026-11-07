import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/http-exception.filter';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

const OTHER_TENANT = '00000000-0000-4000-8000-0000000000e6';
const BOGUS_TENANT = '00000000-0000-4000-8000-0000000000fd';
type Method = 'get' | 'put' | 'post' | 'patch' | 'delete';

/** [40.6.03] Gallery admin API: ADMIN only, fixed sentences, tenant isolation. */
describe('Website gallery admin API E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let teacherUserId: string;
  let otherAlbum: string;
  let otherPhoto: string;
  const api = () => supertest(app.getHttpServer());
  const tag = randomUUID().slice(0, 8);
  let shade = 1;

  const admin = (method: Method, path: string, o: { tenant?: string | null } = {}) => {
    let r = api()
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Role', UserRole.ADMIN)
      .set('Idempotency-Key', randomUUID());
    const tenant = o.tenant === undefined ? SEED_TENANT_ID : o.tenant;
    if (tenant) r = r.set('X-Tenant-ID', tenant);
    return r;
  };
  const img = (w: number, h: number, fmt: 'jpeg' | 'png' = 'jpeg') => {
    const n = shade++;
    return sharp({
      create: { width: w, height: h, channels: 3, background: { r: n, g: n * 3, b: n * 5 } },
    })
      [fmt]()
      .toBuffer();
  };
  const title = { bn: 'অনুষ্ঠান', en: 'Events' };
  const newAlbum = async () =>
    (await admin('post', '/website/gallery/albums').send({ title }).expect(201)).body;
  const upload = async (albumId: string, buf: Buffer, type = 'image/jpeg') =>
    admin('post', `/website/gallery/albums/${albumId}/photos`).attach('file', buf, {
      filename: 'a.jpg',
      contentType: type,
    });

  /**
   * Another school with its own album and photo. Made inside the test: the per-test reset clears
   * gallery rows of every school but the seed one.
   */
  const seedOtherSchool = async () => {
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1,'Gallery Other',$2,NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_TENANT, `gallery-other-${tag}`],
    );
    [{ id: otherAlbum }] = await ds.query(
      `INSERT INTO site_gallery_albums (tenant_id, title) VALUES ($1,'{"bn":"x","en":"x"}') RETURNING id`,
      [OTHER_TENANT],
    );
    const [m] = await ds.query(
      `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes)
       VALUES ($1,'gallery',$2,$3,1200,800,10) RETURNING id`,
      [OTHER_TENANT, `tenants/${OTHER_TENANT}/site/x-${tag}.webp`, tag.padEnd(64, '0')],
    );
    [{ id: otherPhoto }] = await ds.query(
      `INSERT INTO site_gallery_photos (tenant_id, album_id, media_id) VALUES ($1,$2,$3) RETURNING id`,
      [OTHER_TENANT, otherAlbum, m.id],
    );
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
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
       VALUES ($1,$2,'Gallery Teacher','ACTIVE',NOW(),NOW()) RETURNING id`,
      [`gallery-teacher-${tag}@e2e.example`, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
      [teacherUserId, SEED_TENANT_ID],
    );
    teacherToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: `gallery-teacher-${tag}@e2e.example`, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  afterAll(async () => {
    for (const t of [SEED_TENANT_ID, OTHER_TENANT]) {
      await ds.query(`DELETE FROM site_gallery_photos WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM site_gallery_albums WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM site_media WHERE tenant_id = $1`, [t]);
    }
    await ds.query(`UPDATE school_sites SET media_bytes_used = 0 WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [OTHER_TENANT]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = $1`, [teacherUserId]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [teacherUserId]);
    await app.close();
  });

  describe('albums and photos', () => {
    it('creates, renames, captions, reorders and deletes', async () => {
      const a = await newAlbum();
      await admin('patch', `/website/gallery/albums/${a.id}`)
        .send({ title: { bn: 'নতুন', en: 'Renamed' } })
        .expect(200);
      const p = (await upload(a.id, await img(1200, 800))).body;
      expect(p.mediaId).toBeTruthy();
      const cap = await admin('patch', `/website/gallery/photos/${p.id}`)
        .send({ caption: { bn: 'ক', en: 'Cap' } })
        .expect(200);
      expect(cap.body.caption.en).toBe('Cap');
      await admin('patch', `/website/gallery/photos/${p.id}`).send({ caption: null }).expect(200);
      const p2 = (await upload(a.id, await img(1200, 800))).body;
      const re = await admin('put', `/website/gallery/albums/${a.id}/photos/order`)
        .send({ ids: [p2.id, p.id] })
        .expect(200);
      expect(re.body.photos.map((x: { id: string }) => x.id)).toEqual([p2.id, p.id]);
      const list = (await admin('get', '/website/gallery/albums').expect(200)).body;
      expect(list.find((x: { id: string }) => x.id === a.id).title.en).toBe('Renamed');
      await admin('delete', `/website/gallery/photos/${p.id}`).expect(204);
      await admin('delete', `/website/gallery/albums/${a.id}`).expect(204);
    });

    it('upload of 1199x800, an SVG and a type/signature mismatch is 400 with one sentence', async () => {
      const a = await newAlbum();
      const small = await upload(a.id, await img(1199, 800)).then((r) => r);
      const svg = await upload(
        a.id,
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        'image/svg+xml',
      );
      const lie = await upload(a.id, await img(1200, 800, 'png'), 'image/jpeg');
      for (const r of [small, svg, lie]) {
        expect(r.status).toBe(400);
        expect(r.body.message).toBe('site.media_rejected');
      }
      expect(small.text).not.toContain('1199');
    });

    it('a file over the cap is 400 site.media_rejected, not 413', async () => {
      const a = await newAlbum();
      const r = await upload(a.id, Buffer.alloc(11 * 1024 * 1024));
      expect(r.status).toBe(400);
      expect(r.body.message).toBe('site.media_rejected');
    });

    it('a caption over 120 chars is 400 site.gallery_invalid and the album stays empty', async () => {
      const a = await newAlbum();
      const r = await admin('post', `/website/gallery/albums/${a.id}/photos`)
        .field('caption', JSON.stringify({ bn: 'x'.repeat(121), en: '' }))
        .attach('file', await img(1200, 800), { filename: 'a.jpg', contentType: 'image/jpeg' });
      expect(r.status).toBe(400);
      expect(r.body.message).toBe('site.gallery_invalid');
      const list = (await admin('get', '/website/gallery/albums').expect(200)).body;
      expect(list.find((x: { id: string }) => x.id === a.id).photos).toHaveLength(0);
    });

    it('the 21st album is 400 site.gallery_limit', async () => {
      const have = (await admin('get', '/website/gallery/albums').expect(200)).body.length;
      for (let i = have; i < 20; i++) await newAlbum();
      const r = await admin('post', '/website/gallery/albums').send({ title });
      expect(r.status).toBe(400);
      expect(r.body.message).toBe('site.gallery_limit');
    });

    it('a bad title is 400 site.gallery_invalid without echoing it', async () => {
      const r = await admin('post', '/website/gallery/albums').send({
        title: { bn: '', en: '' },
      });
      expect(r.status).toBe(400);
      expect(r.body.message).toBe('site.gallery_invalid');
    });
  });

  describe('tenant isolation', () => {
    it("tenant A's token gets 404 on tenant B's album and photo", async () => {
      await seedOtherSchool();
      await admin('patch', `/website/gallery/albums/${otherAlbum}`).send({ title }).expect(404);
      await admin('delete', `/website/gallery/albums/${otherAlbum}`).expect(404);
      await upload(otherAlbum, await img(1200, 800)).then((r) => expect(r.status).toBe(404));
      await admin('put', `/website/gallery/albums/${otherAlbum}/photos/order`)
        .send({ ids: [otherPhoto] })
        .expect(404);
      await admin('patch', `/website/gallery/photos/${otherPhoto}`)
        .send({ caption: null })
        .expect(404);
      await admin('delete', `/website/gallery/photos/${otherPhoto}`).expect(404);
      // The other school's album is not in A's list.
      const list = (await admin('get', '/website/gallery/albums').expect(200)).body;
      expect(list.some((x: { id: string }) => x.id === otherAlbum)).toBe(false);
      // And it is still there.
      const [row] = await ds.query(`SELECT 1 FROM site_gallery_photos WHERE id = $1`, [otherPhoto]);
      expect(row).toBeTruthy();
    });
  });

  describe('access', () => {
    const someId = randomUUID();
    const routes: [Method, string, object?][] = [
      ['get', '/website/gallery/albums'],
      ['post', '/website/gallery/albums', { title }],
      ['put', '/website/gallery/albums/order', { ids: [] }],
      ['patch', `/website/gallery/albums/${someId}`, { title }],
      ['delete', `/website/gallery/albums/${someId}`],
      ['post', `/website/gallery/albums/${someId}/photos`],
      ['put', `/website/gallery/albums/${someId}/photos/order`, { ids: [] }],
      ['patch', `/website/gallery/photos/${someId}`, { caption: null }],
      ['delete', `/website/gallery/photos/${someId}`],
    ];

    it.each(routes)('%s %s: missing, bogus or malformed X-Tenant-ID is 401', async (m, p, body) => {
      for (const tenant of [null, BOGUS_TENANT, 'not-a-uuid']) {
        const r = admin(m, p, { tenant });
        await (body ? r.send(body) : r).expect(401);
      }
    });

    it.each(routes)('%s %s: a TEACHER is 403', async (m, p, body) => {
      const r = api()
        [m](`/api/v1${p}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Role', UserRole.TEACHER)
        .set('X-Tenant-ID', SEED_TENANT_ID);
      await (body ? r.send(body) : r).expect(403);
    });

    it('a non-UUID id is 400 (Rule 3)', async () => {
      await admin('delete', '/website/gallery/albums/not-a-uuid').expect(400);
      await admin('delete', '/website/gallery/photos/not-a-uuid').expect(400);
      await admin('patch', '/website/gallery/photos/not-a-uuid')
        .send({ caption: null })
        .expect(400);
    });
  });
});
