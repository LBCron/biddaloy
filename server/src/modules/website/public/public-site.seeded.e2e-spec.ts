import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/http-exception.filter';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { createContext } from '../../../scripts/demo-seed/context';
import { slice as org, orgIds } from '../../../scripts/demo-seed/slices/org';
import { slice as staff } from '../../../scripts/demo-seed/slices/staff';
import { slice as website } from '../../../scripts/demo-seed/slices/website';
import { Notice } from '../../notices/entities/notice.entity';

const ROOT = 'sites.seeded.test';
const HOST = `bmsc-high.${ROOT}`;

/**
 * [40.1.08] The public by-host API against the demo seed's own website slice: what the site
 * container would read for the demo school. The test setup empties data tables before every
 * `it`, so every request is made once in `beforeAll` and the `it`s only read the answers.
 */
describe('Public site API on the seeded demo school (e2e)', () => {
  let app: INestApplication;
  const facts: Record<string, any> = {};

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
    const ds = app.get(DataSource);

    const ctx = await createContext({
      ds,
      app,
      scale: 0.05,
      years: 2,
      anchor: '2026-10-10',
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await staff.run(ctx);
    await website.run(ctx);

    // The notice feed shows only public, published notices: one of each kind (the notices slice
    // needs the whole people graph; two rows are enough for this check).
    const T = orgIds(ctx).tenants.find((t) => t.kind === 'HIGH')!.id;
    const base = {
      tenant_id: T,
      author_user_id: orgIds(ctx).adminUserId,
      body: 'x',
      status: 'PUBLISHED' as const,
      published_at: new Date(),
    };
    await ds.getRepository(Notice).insert([
      { ...base, title: 'Public notice', is_public: true },
      { ...base, title: 'Private notice', is_public: false },
    ]);

    const by = (host: string, path: string) =>
      supertest(app.getHttpServer()).get(`/api/v1/public/site/by-host/${host}${path}`);
    const strip = (body: Record<string, unknown>) => {
      const { requestId: _r, timestamp: _t, ...rest } = body;
      return rest;
    };

    facts.manifest = await by(HOST, '/manifest');
    facts.home = await by(HOST, '/page/home');
    facts.notices = await by(HOST, '/island/notices');
    const heroIds: string[] = facts.home.body.sections.find(
      (s: { key: string }) => s.key === 'hero',
    ).data.images;
    facts.heroIds = heroIds;
    facts.media = await by(HOST, `/media/${heroIds[0]}`);
    facts.logo = await by(HOST, '/media/logo');
    // The seed has two published posts and one draft; the by-slug read serves any published one.
    const slugs: { slug: string; published_at: Date | null }[] = await ds.query(
      `SELECT slug, published_at FROM site_posts WHERE tenant_id = $1 ORDER BY published_at NULLS LAST`,
      [T],
    );
    facts.publishedPost = await by(HOST, `/blog/${slugs[0].slug}`);
    facts.draftPost = await by(HOST, `/blog/${slugs[2].slug}`);
    facts.badSlug = await by(HOST, '/blog/Not%20A%20Slug');
    facts.unknown = await by(`unknown.${ROOT}`, '/manifest');
    await ds.query(`UPDATE school_sites SET enabled = false WHERE tenant_id = $1`, [T]);
    facts.disabled = await by(HOST, '/manifest');
    facts.strip = strip;
  }, 300_000);

  afterAll(async () => {
    await app?.close();
  });

  it('manifest: 200 with the green palette, the logo and both languages of the school name', () => {
    expect(facts.manifest.status).toBe(200);
    expect(facts.manifest.body).toMatchObject({
      theme: 'basic',
      palette: 'green',
      logo: '/media/logo',
      schoolName: { en: 'Bangladesh Model School & College — Secondary Branch' },
    });
    expect(facts.manifest.body.nav.map((n: { page: string }) => n.page)).toContain('home');
  });

  it('home page: the sections come in the theme order, and the hero shows two pictures', () => {
    expect(facts.home.status).toBe(200);
    expect(facts.home.body.sections.map((s: { key: string }) => s.key)).toEqual([
      'hero',
      'about',
      'notices',
      'teachers',
    ]);
    expect(facts.heroIds).toHaveLength(2);
    // ponytail: the teachers section feed (3 featured first) is #3629's; today `feed` is [].
  });

  it('notices island: only the public notice', () => {
    expect(facts.notices.status).toBe(200);
    expect(facts.notices.body.map((n: { title: string }) => n.title)).toEqual(['Public notice']);
  });

  it('a hero picture streams as WebP', () => {
    expect(facts.media.status).toBe(200);
    expect(facts.media.headers['content-type']).toMatch(/image\/webp/);
    // A WebP file starts with "RIFF....WEBP".
    expect(facts.media.body.subarray(0, 4).toString()).toBe('RIFF');
    expect(facts.media.body.subarray(8, 12).toString()).toBe('WEBP');
  });

  it('the school logo streams as WebP', () => {
    expect(facts.logo.status).toBe(200);
    expect(facts.logo.headers['content-type']).toMatch(/image\/webp/);
  });

  it('one blog post by slug: sanitised html and cover; a draft and a bad slug are the one 404', () => {
    expect(facts.publishedPost.status).toBe(200);
    expect(Object.keys(facts.publishedPost.body).sort()).toEqual(
      ['cover', 'excerpt', 'html', 'publishedAt', 'title'].sort(),
    );
    expect(facts.publishedPost.body.html).toContain('<table>');
    expect(facts.draftPost.status).toBe(404);
    expect(facts.badSlug.status).toBe(404);
  });

  it('an unknown host and a switched-off site answer the same 404', () => {
    expect(facts.unknown.status).toBe(404);
    expect(facts.disabled.status).toBe(404);
    expect(facts.strip(facts.disabled.body)).toEqual(facts.strip(facts.unknown.body));
  });
});
