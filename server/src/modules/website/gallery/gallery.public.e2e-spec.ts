import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { SiteTheme, UserRole } from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { defaultConfigFor } from '@biddaloy/site-themes';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/http-exception.filter';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

const ROOT = 'sites.gallery.test';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000e7';

/** [40.6.03] What a visitor can reach of the gallery: the page, the nav link, the pictures. */
describe('Public gallery exposure (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let mediaId: string;
  let hostA: string;
  const hostB = `gallery-b-${randomUUID().slice(0, 6)}.${ROOT}`;
  const api = () => supertest(app.getHttpServer());
  const by = (host: string, path: string) =>
    api().get(`/api/v1/public/site/by-host/${host}${path}`);

  /** Publishes a config for school A; a new version so no cached page from the last step is read. */
  const publishA = async (o: {
    enabled?: boolean;
    published?: boolean;
    showPageLink?: boolean;
  }) => {
    const cfg: SiteConfig = defaultConfigFor(SiteTheme.BASIC);
    for (const p of cfg.pages) {
      for (const s of p.sections) {
        if (s.key === 'gallery') {
          s.enabled = true;
          s.data = { albumId: null, showPageLink: o.showPageLink ?? false };
        }
      }
    }
    await ds.query(
      `UPDATE school_sites SET enabled = $2, published = $3, version = version + 1 WHERE tenant_id = $1`,
      [SEED_TENANT_ID, o.enabled ?? true, o.published === false ? null : JSON.stringify(cfg)],
    );
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
  }, 90_000);

  /** The per-test reset empties the data tables, so the site, school B and the photo are made per test. */
  beforeEach(async () => {
    const admin = (method: 'get' | 'post', path: string) =>
      api()
        [method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Role', UserRole.ADMIN)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('Idempotency-Key', randomUUID());
    const site = (await admin('get', '/website').expect(200)).body;
    hostA = `${site.subdomain}.${ROOT}`;

    // School B: its own live site with a gallery photo, to prove A cannot read it by id.
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1,'Gallery Public Other',$2,NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_TENANT, `gallery-pub-${randomUUID().slice(0, 6)}`],
    );
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [OTHER_TENANT]);
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft, published, enabled)
       VALUES ($1,$2,'blue','{}',$3,true)`,
      [OTHER_TENANT, hostB.split('.')[0], JSON.stringify(defaultConfigFor(SiteTheme.BASIC))],
    );

    const album = (
      await admin('post', '/website/gallery/albums')
        .send({ title: { bn: 'ক', en: 'Public' } })
        .expect(201)
    ).body;
    const file = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#335577' },
    })
      .jpeg()
      .toBuffer();
    mediaId = (
      await admin('post', `/website/gallery/albums/${album.id}/photos`)
        .attach('file', file, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(201)
    ).body.mediaId;
  }, 90_000);

  afterAll(async () => {
    for (const t of [SEED_TENANT_ID, OTHER_TENANT]) {
      await ds.query(`DELETE FROM site_gallery_photos WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM site_gallery_albums WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM site_media WHERE tenant_id = $1`, [t]);
    }
    await ds.query(`UPDATE school_sites SET media_bytes_used = 0 WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [OTHER_TENANT]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [OTHER_TENANT]);
    await app.close();
  });

  it('page/gallery is 404 and the nav hides it while showPageLink is off', async () => {
    await publishA({ showPageLink: false });
    await by(hostA, '/page/gallery').expect(404);
    const m = (await by(hostA, '/manifest').expect(200)).body;
    expect(m.nav.map((n: { page: string }) => n.page)).not.toContain('gallery');
  });

  it('page/gallery is 404 with the link on but no photo; 200 once a photo exists', async () => {
    await publishA({ showPageLink: true });
    const [{ id: photoId }] = await ds.query(
      `SELECT id FROM site_gallery_photos WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    // Take the photo out: no photo, no gallery page.
    const [row] = await ds.query(`SELECT * FROM site_gallery_photos WHERE id = $1`, [photoId]);
    await ds.query(`DELETE FROM site_gallery_photos WHERE id = $1`, [photoId]);
    await publishA({ showPageLink: true });
    await by(hostA, '/page/gallery').expect(404);
    expect(
      (await by(hostA, '/manifest').expect(200)).body.nav.map((n: { page: string }) => n.page),
    ).not.toContain('gallery');

    await ds.query(
      `INSERT INTO site_gallery_photos (id, tenant_id, album_id, media_id, caption, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.id, row.tenant_id, row.album_id, row.media_id, row.caption, row.sort_order],
    );
    await publishA({ showPageLink: true });
    const page = (await by(hostA, '/page/gallery').expect(200)).body;
    expect(page.sections[0].feed).toHaveLength(1);
    expect(page.sections[0].feed[0].photos[0].mediaId).toBe(mediaId);
    const m = (await by(hostA, '/manifest').expect(200)).body;
    expect(m.nav.map((n: { page: string }) => n.page)).toContain('gallery');
    // The home page carries the carousel photos too.
    const home = (await by(hostA, '/page/home').expect(200)).body;
    const g = home.sections.find((s: { key: string }) => s.key === 'gallery');
    expect(g.feed[0].photos).toHaveLength(1);
  });

  it('/media/<gallery photo> is 200 webp for its school', async () => {
    await publishA({ showPageLink: true });
    const r = await by(hostA, `/media/${mediaId}`).expect(200);
    expect(r.headers['content-type']).toContain('image/webp');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it("another school's host cannot read this school's picture or gallery page", async () => {
    await publishA({ showPageLink: true });
    await by(hostB, `/media/${mediaId}`).expect(404);
    await by(hostB, '/page/gallery').expect(404);
  });

  it('an off or unpublished site serves no gallery page and no picture', async () => {
    await publishA({ enabled: false, showPageLink: true });
    await by(hostA, '/page/gallery').expect(404);
    await by(hostA, `/media/${mediaId}`).expect(404);
    await publishA({ enabled: true, published: false, showPageLink: true });
    await by(hostA, '/page/gallery').expect(404);
    await by(hostA, `/media/${mediaId}`).expect(404);
  });

  it('a picture that is not a gallery photo, post or card is 404 even for its own school', async () => {
    await publishA({ showPageLink: true });
    await by(hostA, `/media/${randomUUID()}`).expect(404);
    await by(hostA, '/media/not-a-uuid').expect(404);
  });
});
