import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { SITE_FEATURED_TEACHERS_MAX, SitePage, SiteSectionKey } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_ADMIN_PASSWORD_HASH } from '@test/constants';
import { SchoolsService } from '../../../schools/schools.service';
import { SiteCacheService } from '../site-cache.service';
import { buildPage, withFeeds } from '../page-read-model';
import type { SiteConfig } from '@biddaloy/shared';
import { AdmissionsFeed } from './admissions.feed';
import { BlogFeed } from './blog.feed';
import { EventsFeed } from './events.feed';
import { FeedRegistry } from './feed-registry';
import { FeesFeed } from './fees.feed';
import { NoticesFeed } from './notices.feed';
import { RoutineFeed } from './routine.feed';
import { TeachersFeed } from './teachers.feed';

// The school's "today" is fixed so the dates below never drift.
const TODAY = '2026-11-07';
const body = [{ type: 'paragraph', children: [{ text: 'Hello world from the blog' }] }];

class FakeRedis {
  down = false;
  store = new Map<string, string>();
  async get(k: string) {
    if (this.down) throw new Error('redis down');
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string) {
    if (this.down) throw new Error('redis down');
    this.store.set(k, v);
  }
  async del(...keys: string[]) {
    if (this.down) throw new Error('redis down');
    keys.forEach((k) => this.store.delete(k));
  }
}

/** [40.3.02] Every feed against a real DB: tenant scope, ordering, limits, empty sections, cache. */
describe('Site feeds (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let registry: FeedRegistry;
  let redis: FakeRedis;
  let A: string;
  let B: string;
  let adminA: string;
  const tag = randomUUID().slice(0, 8);

  const school = async (name: string) => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [id, `Feed ${name} ${tag}`, `feed-${name}-${tag}`],
    );
    return id;
  };
  const user = async (tenant: string, name: string, role = 'TEACHER') => {
    const [{ id }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1,$2,$3,'ACTIVE',NOW(),NOW()) RETURNING id`,
      [`feed-${randomUUID()}@e2e.example`, SEED_ADMIN_PASSWORD_HASH, name],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1,$2,$3,NOW(),NOW())`,
      [id, tenant, role],
    );
    return id as string;
  };
  const notice = (tenant: string, o: Record<string, unknown> = {}) =>
    ds.query(
      `INSERT INTO notices (tenant_id, author_user_id, title, body, status, published_at, is_public,
                            pinned_on_website, expires_on, withdrawn_at)
       VALUES ($1,$2,$3,'x',$4,$5,$6,$7,$8,$9)`,
      [
        tenant,
        adminA,
        o.title ?? 'N',
        o.status ?? 'PUBLISHED',
        o.published_at ?? new Date('2026-11-01T00:00:00Z'),
        o.is_public ?? true,
        o.pinned ?? false,
        o.expires_on ?? null,
        o.withdrawn_at ?? null,
      ],
    );
  const profile = (tenant: string, userId: string, o: Record<string, unknown> = {}) =>
    ds.query(
      `INSERT INTO staff_web_profiles (tenant_id, user_id, show_on_website, featured, sort_order)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenant, userId, o.show ?? true, o.featured ?? false, o.sort ?? 0],
    );
  const titles = (rows: Record<string, unknown>[]) => rows.map((r) => r.title);

  const clean = async () => {
    for (const t of [A, B]) {
      if (!t) continue;
      for (const table of [
        'staff_web_profiles',
        'site_posts',
        'notices',
        'calendar_events',
        'fee_structures',
        'admission_intakes',
        'class_sections',
        'classes',
        'academic_years',
      ]) {
        await ds.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [t]);
      }
    }
  };

  beforeAll(async () => {
    redis = new FakeRedis();
    moduleRef = await createTestModule(ALL_ENTITIES, [
      NoticesFeed,
      EventsFeed,
      RoutineFeed,
      TeachersFeed,
      BlogFeed,
      FeesFeed,
      AdmissionsFeed,
      FeedRegistry,
      { provide: SiteCacheService, useValue: new SiteCacheService(redis as never) },
      { provide: SchoolsService, useValue: { todayFor: async () => TODAY } },
    ]);
    ds = moduleRef.get(DataSource);
    registry = moduleRef.get(FeedRegistry);
    A = await school('a');
    B = await school('b');
    adminA = await user(A, 'Feed Admin', 'ADMIN');
  }, 60000);

  afterAll(async () => {
    await clean();
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id IN ($1,$2)`, [A, B]);
    await ds.query(`DELETE FROM users WHERE email LIKE 'feed-%@e2e.example'`);
    await ds.query(`DELETE FROM schools WHERE id IN ($1,$2)`, [A, B]);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await clean();
    redis.down = false;
    redis.store.clear();
  });

  it('notices: only public published live ones, pinned-on-website first, then newest, per tenant', async () => {
    await notice(A, { title: 'old', published_at: new Date('2026-10-01T00:00:00Z') });
    await notice(A, { title: 'new', published_at: new Date('2026-11-05T00:00:00Z') });
    await notice(A, {
      title: 'pinned',
      pinned: true,
      published_at: new Date('2026-09-01T00:00:00Z'),
    });
    await notice(A, { title: 'private', is_public: false });
    await notice(A, { title: 'draft', status: 'DRAFT', published_at: null });
    await notice(A, { title: 'expired', expires_on: '2026-11-06' });
    await notice(A, { title: 'withdrawn', withdrawn_at: new Date() });
    await notice(B, { title: 'other school' });
    const rows = await registry.cached('notices', A);
    // Pinned on the website first, then the newest of the rest.
    expect(titles(rows)).toEqual(['pinned', 'new', 'old']);
    expect(titles(await registry.cached('notices', B))).toEqual(['other school']);
  });

  it('teachers: only show_on_website, featured first then sort_order; other schools never appear', async () => {
    const [t1, t2, t3, hidden, other] = [
      await user(A, 'Teacher One'),
      await user(A, 'Teacher Two'),
      await user(A, 'Teacher Three'),
      await user(A, 'Hidden Teacher'),
      await user(B, 'Other School Teacher'),
    ];
    await profile(A, t1, { sort: 2 });
    await profile(A, t2, { sort: 1 });
    await profile(A, t3, { featured: true, sort: 9 });
    await profile(A, hidden, { show: false });
    await profile(B, other);
    const names = (await registry.cached('teachers', A)).map((r) => (r.name as { en: string }).en);
    expect(names).toEqual(['Teacher Three', 'Teacher Two', 'Teacher One']);
    expect(
      (await registry.cached('teachers', B)).map((r) => (r.name as { en: string }).en),
    ).toEqual(['Other School Teacher']);
  });

  it('teachers: a card whose person left the school (or is not teaching staff) drops out', async () => {
    const gone = await user(A, 'Left School');
    const parent = await user(A, 'A Parent', 'PARENT');
    await profile(A, gone);
    await profile(A, parent);
    await ds.query(`UPDATE user_tenants SET deleted_at = NOW() WHERE user_id = $1`, [gone]);
    expect(await registry.cached('teachers', A)).toEqual([]);
  });

  it('home page shows at most 8 teachers; the teachers page shows all', async () => {
    for (let i = 0; i < SITE_FEATURED_TEACHERS_MAX + 2; i++) {
      await profile(A, await user(A, `T${i}`), { sort: i });
    }
    const cfg = (page: SitePage) =>
      ({
        pages: [
          {
            page,
            enabled: true,
            sections: [{ key: SiteSectionKey.TEACHERS, enabled: true, data: {} }],
          },
        ],
      }) as unknown as SiteConfig;
    const home = await withFeeds(buildPage(cfg(SitePage.HOME), 'home')!, A, registry);
    const all = await withFeeds(buildPage(cfg(SitePage.TEACHERS), 'teachers')!, A, registry);
    expect(home.sections[0].feed).toHaveLength(SITE_FEATURED_TEACHERS_MAX);
    expect(all.sections[0].feed).toHaveLength(SITE_FEATURED_TEACHERS_MAX + 2);
  });

  it('blog: published POSTs only, newest first, with a 160-char excerpt and sanitised html', async () => {
    const long = [{ type: 'paragraph', children: [{ text: 'x'.repeat(400) }] }];
    const post = (tenant: string, slug: string, o: Record<string, unknown> = {}) =>
      ds.query(
        `INSERT INTO site_posts (tenant_id, kind, slug, title, body, published_at)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
        [
          tenant,
          o.kind ?? 'POST',
          slug,
          JSON.stringify({ bn: slug, en: slug }),
          JSON.stringify(o.body ?? body),
          o.published_at === undefined ? new Date('2026-11-01T00:00:00Z') : o.published_at,
        ],
      );
    await post(A, 'older', { published_at: new Date('2026-10-01T00:00:00Z') });
    await post(A, 'newer', { body: long });
    await post(A, 'draft', { published_at: null });
    await post(A, 'a-page', { kind: 'PAGE' });
    await post(B, 'other-school');
    const rows = await registry.cached('blog', A);
    expect(rows.map((r) => r.slug)).toEqual(['newer', 'older']);
    expect((rows[0].excerpt as string).length).toBe(160);
    expect(rows[1].html).toBe('<p>Hello world from the blog</p>');
  });

  it('events, fees and admissions: current year, this school only', async () => {
    const setup = async (tenant: string, label: string) => {
      const [{ id: year }] = await ds.query(
        `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
         VALUES ($1,'2026-01-01','2026-12-31',true,$2) RETURNING id`,
        [`Y-${label}`, tenant],
      );
      const [{ id: klass }] = await ds.query(
        `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ($1,$2,$3) RETURNING id`,
        [`Class ${label}`, year, tenant],
      );
      const [{ id: section }] = await ds.query(
        `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1,'A',$2) RETURNING id`,
        [klass, tenant],
      );
      const event = (
        name: string,
        start: string,
        o: { published?: boolean; audience?: string } = {},
      ) =>
        ds.query(
          `INSERT INTO calendar_events (tenant_id, academic_year_id, type, name, start_date, end_date,
                                        audience, published_at)
           VALUES ($1,$2,'EVENT',$3,$4,$4,$5,$6)`,
          [
            tenant,
            year,
            name,
            start,
            o.audience ?? 'ALL',
            o.published === false ? null : new Date('2026-10-01T00:00:00Z'),
          ],
        );
      await event(`${label} sports day`, '2026-12-10');
      await event(`${label} past`, '2026-10-01');
      await event(`${label} draft`, '2026-12-11', { published: false });
      await event(`${label} staff only`, '2026-12-12', { audience: 'STAFF' });
      await ds.query(
        `INSERT INTO fee_structures (tenant_id, academic_year_id, class_id, fee_type, name, amount)
         VALUES ($1,$2,$3,'MONTHLY_TUITION',$4,500.50)`,
        [tenant, year, klass, `${label} tuition`],
      );
      await ds.query(
        `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
         VALUES ($1,$2,$3,10,'2026-11-01','2026-11-30'), ($1,$2,$4,10,'2026-12-01','2026-12-30')`,
        [tenant, section, `${label} open intake`, `${label} future intake`],
      );
    };
    await setup(A, 'a');
    await setup(B, 'b');

    expect((await registry.cached('events', A)).map((r) => r.title)).toEqual(['a sports day']);
    const fees = await registry.cached('fees', A);
    expect(fees).toEqual([expect.objectContaining({ name: 'a tuition', amount: 500.5 })]);
    const admissions = await registry.cached('admissions', A);
    expect(admissions).toEqual([
      expect.objectContaining({ title: 'a open intake', link: `/admission/feed-a-${tag}` }),
    ]);
  });

  it('an empty feed marks its section empty; admissions keeps its own text; a section with no feed is untouched', async () => {
    const cfg = {
      pages: [
        {
          page: 'home',
          enabled: true,
          sections: [
            { key: SiteSectionKey.TEACHERS, enabled: true, data: {} },
            {
              key: SiteSectionKey.ADMISSIONS,
              enabled: true,
              data: { title: { bn: 'a', en: 'a' } },
            },
            { key: SiteSectionKey.ABOUT, enabled: true, data: {} },
          ],
        },
      ],
    } as unknown as SiteConfig;
    const page = await withFeeds(buildPage(cfg, 'home')!, A, registry);
    const by = (k: string) => page.sections.find((s) => s.key === k)!;
    expect(by('teachers')).toMatchObject({ feed: [], empty: true });
    expect(by('admissions').empty).toBeUndefined();
    expect(by('about')).toMatchObject({ feed: [] });
    expect(by('about').empty).toBeUndefined();
  });

  it('routine: only a PUBLISHED routine of the asked section; no section is empty', async () => {
    expect(await registry.cached('routine', A)).toEqual([]);
    expect(await registry.cached('routine', A, { classSectionId: 'not-a-uuid' })).toEqual([]);
    expect(await registry.cached('routine', A, { classSectionId: randomUUID() })).toEqual([]);
  });

  it('Redis down: the feed still answers from the database; Redis up: the second read is cached for 60 s', async () => {
    await notice(A, { title: 'first' });
    redis.down = true;
    expect(titles(await registry.cached('notices', A))).toEqual(['first']);

    redis.down = false;
    expect(titles(await registry.cached('notices', A))).toEqual(['first']);
    await notice(A, { title: 'second', pinned: true });
    // Still the cached answer: a new notice shows when the 60 s key expires (or is invalidated).
    expect(titles(await registry.cached('notices', A))).toEqual(['first']);
    await moduleRef.get(SiteCacheService).invalidate(A);
    expect(titles(await registry.cached('notices', A))).toEqual(['second', 'first']);
  });
});
