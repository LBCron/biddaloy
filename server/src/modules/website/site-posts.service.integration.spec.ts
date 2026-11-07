import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { SitePostsService } from './site-posts.service';
import { SiteCacheService } from './public/site-cache.service';

const OTHER_TENANT = '00000000-0000-4000-8000-0000000000e3';
const body = [{ type: 'paragraph', children: [{ text: 'Hello' }] }];
const dto = (en: string) => ({ title: { bn: '', en }, body });

/** [40.3.01] Slugs, version bump and the delete guard against a real DB. */
describe('SitePostsService (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let svc: SitePostsService;
  const invalidated: string[] = [];

  const version = async () =>
    Number(
      (await ds.query(`SELECT version FROM school_sites WHERE tenant_id = $1`, [SEED_TENANT_ID]))[0]
        .version,
    );

  beforeAll(async () => {
    moduleRef = await createTestModule(ALL_ENTITIES, [
      SitePostsService,
      {
        provide: SiteCacheService,
        useValue: { invalidate: async (t: string) => invalidated.push(t) },
      },
    ]);
    ds = moduleRef.get(DataSource);
    svc = moduleRef.get(SitePostsService);
  }, 60000);

  const clean = async () => {
    await ds.query(`DELETE FROM site_posts WHERE tenant_id IN ($1,$2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT,
    ]);
    await ds.query(`DELETE FROM school_sites WHERE tenant_id IN ($1,$2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT,
    ]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [OTHER_TENANT]);
  };

  afterAll(async () => {
    await clean();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await clean();
    invalidated.length = 0;
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft)
       VALUES ($1, 'posts-int', 'blue', '{}')`,
      [SEED_TENANT_ID],
    );
  });

  it('two posts with the same title get different slugs in one school', async () => {
    const a = await svc.create(SEED_TENANT_ID, dto('Annual Day'));
    const b = await svc.create(SEED_TENANT_ID, dto('Annual Day'));
    expect(a.slug).not.toBe(b.slug);
    expect(a.slug).toMatch(/^annual-day-/);
  });

  it('the same slug is refused inside one school but allowed in another', async () => {
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
                    VALUES ($1,'Other Posts School','other-posts-int',NOW(),NOW())`,
      [OTHER_TENANT],
    );
    const insert = (tenant: string) =>
      ds.query(
        `INSERT INTO site_posts (tenant_id, slug, title, body) VALUES ($1,'same','{}','[]')`,
        [tenant],
      );
    await insert(SEED_TENANT_ID);
    await insert(OTHER_TENANT);
    await expect(insert(SEED_TENANT_ID)).rejects.toThrow(/UQ_site_posts_tenant_slug/);
  });

  it('every write bumps the site version and drops the feed cache; publish sets the date once', async () => {
    const v0 = await version();
    const p = await svc.create(SEED_TENANT_ID, dto('Hello'));
    expect(await version()).toBe(v0 + 1);
    const pub = await svc.publish(SEED_TENANT_ID, p.id);
    expect(await version()).toBe(v0 + 2);
    expect(pub.published_at).not.toBeNull();
    const again = await svc.publish(SEED_TENANT_ID, p.id);
    expect(again.published_at).toBe(pub.published_at);
    const hidden = await svc.unpublish(SEED_TENANT_ID, p.id);
    expect(hidden.published_at).toBeNull();
    expect(invalidated.length).toBe(4);
  });

  it('another school cannot read, change or delete my post (404)', async () => {
    const p = await svc.create(SEED_TENANT_ID, dto('Mine'));
    await expect(svc.get(OTHER_TENANT, p.id)).rejects.toThrow('site.post_not_found');
    await expect(svc.publish(OTHER_TENANT, p.id)).rejects.toThrow('site.post_not_found');
    await expect(svc.remove(OTHER_TENANT, p.id)).rejects.toThrow('site.post_not_found');
  });

  it('delete of a post the site config points at is refused (409)', async () => {
    const p = await svc.create(SEED_TENANT_ID, dto('Pinned'));
    await ds.query(`UPDATE school_sites SET draft = $2::jsonb WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
      JSON.stringify({ pages: [{ sections: [{ key: 'blog', data: { postId: p.id } }] }] }),
    ]);
    await expect(svc.remove(SEED_TENANT_ID, p.id)).rejects.toThrow('site.post_in_use');
    await ds.query(`UPDATE school_sites SET draft = '{}' WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await svc.remove(SEED_TENANT_ID, p.id);
  });
});
