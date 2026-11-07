import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import {
  SITE_GALLERY_CAROUSEL_MAX,
  SitePage,
  SiteSectionKey,
  SiteTheme,
  SiteAnnouncementStyle,
  SiteMarqueeSpeed,
} from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { buildManifest, buildPage, galleryLinked, withFeeds } from '../page-read-model';
import type { FeedRegistry } from './feed-registry';
import { GalleryFeed } from './gallery.feed';

/** [40.6.03] The gallery feed against a real DB, and how a page picks an album from it. */
describe('GalleryFeed (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let feed: GalleryFeed;
  let A: string;
  let B: string;
  const tag = randomUUID().slice(0, 8);
  let n = 0;

  const school = async (name: string) => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [id, `Gal ${name} ${tag}`, `gal-${name}-${tag}`],
    );
    return id;
  };
  const album = async (tenant: string, title: string, sort: number) => {
    const [{ id }] = await ds.query(
      `INSERT INTO site_gallery_albums (tenant_id, title, sort_order) VALUES ($1,$2,$3) RETURNING id`,
      [tenant, JSON.stringify({ bn: title, en: title }), sort],
    );
    return id as string;
  };
  const addPhotos = async (tenant: string, albumId: string, count: number) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      n++;
      const [m] = await ds.query(
        `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes)
         VALUES ($1,'gallery',$2,$3,1200,800,10) RETURNING id`,
        [tenant, `tenants/${tenant}/site/${tag}-${n}.webp`, `${tag}${n}`.padEnd(64, '0')],
      );
      await ds.query(
        `INSERT INTO site_gallery_photos (tenant_id, album_id, media_id, sort_order) VALUES ($1,$2,$3,$4)`,
        [tenant, albumId, m.id, i],
      );
      ids.push(m.id);
    }
    return ids;
  };
  const clean = async () => {
    for (const t of [A, B]) {
      if (!t) continue;
      await ds.query(`DELETE FROM site_gallery_photos WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM site_gallery_albums WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM site_media WHERE tenant_id = $1`, [t]);
    }
  };
  /** The registry's `cached` without Redis: straight to the feed. */
  const registryFor = (t: string) =>
    ({
      cached: (_k: string, tenantId: string) => feed.load(tenantId ?? t),
    }) as unknown as FeedRegistry;

  const config = (data: Record<string, unknown>, showOn: SitePage = SitePage.HOME): SiteConfig => ({
    theme: SiteTheme.BASIC,
    palette: 'blue',
    typography: { bn: { heading: 'a', body: 'a' }, en: { heading: 'a', body: 'a' } },
    announcements: {
      style: SiteAnnouncementStyle.STATIC,
      speed: SiteMarqueeSpeed.NORMAL,
      items: [],
    },
    pages: [
      {
        page: showOn,
        enabled: true,
        sections: [{ key: SiteSectionKey.GALLERY, enabled: true, data }],
      },
      { page: SitePage.GALLERY, enabled: true, sections: [] },
    ],
  });
  const homePage = (data: Record<string, unknown>) =>
    buildPage(config(data), SitePage.HOME) as NonNullable<ReturnType<typeof buildPage>>;

  beforeAll(async () => {
    moduleRef = await createTestModule(ALL_ENTITIES, [GalleryFeed]);
    ds = moduleRef.get(DataSource);
    feed = moduleRef.get(GalleryFeed);
    A = await school('a');
    B = await school('b');
  }, 60000);

  afterAll(async () => {
    await clean();
    await ds.query(`DELETE FROM schools WHERE id IN ($1,$2)`, [A, B]);
    await moduleRef.close();
  });

  beforeEach(clean);

  it('lists albums in order with their photos; an album with no photo is left out; empty is []', async () => {
    expect(await feed.load(A)).toEqual([]);
    const second = await album(A, 'Second', 2);
    const first = await album(A, 'First', 1);
    await album(A, 'Empty', 0);
    const f = await addPhotos(A, first, 2);
    await addPhotos(A, second, 1);
    const rows = (await feed.load(A)) as unknown as {
      id: string;
      photos: { mediaId: string }[];
    }[];
    expect(rows.map((r) => r.id)).toEqual([first, second]);
    expect(rows[0].photos.map((p) => p.mediaId)).toEqual(f);
  });

  it("never returns another school's album", async () => {
    await addPhotos(B, await album(B, 'B album', 0), 1);
    expect(await feed.load(A)).toEqual([]);
    expect(await feed.load(B)).toHaveLength(1);
  });

  it('a section shows the chosen album, else the first; the carousel is cut to 12', async () => {
    const first = await album(A, 'First', 0);
    const chosen = await album(A, 'Chosen', 1);
    await addPhotos(A, first, 2);
    await addPhotos(A, chosen, SITE_GALLERY_CAROUSEL_MAX + 3);
    const reg = registryFor(A);

    const byChoice = await withFeeds(homePage({ albumId: chosen, showPageLink: false }), A, reg);
    const rows = byChoice.sections[0].feed as unknown as { id: string; photos: unknown[] }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(chosen);
    expect(rows[0].photos).toHaveLength(SITE_GALLERY_CAROUSEL_MAX);

    const byDefault = await withFeeds(homePage({ albumId: null }), A, reg);
    expect((byDefault.sections[0].feed as unknown as { id: string }[])[0].id).toBe(first);
  });

  it('a chosen album that is gone, or no photos at all, hides the section (empty)', async () => {
    const reg = registryFor(A);
    const none = await withFeeds(homePage({ albumId: null }), A, reg);
    expect(none.sections[0]).toMatchObject({ feed: [], empty: true });
    await addPhotos(A, await album(A, 'Only', 0), 1);
    const gone = await withFeeds(homePage({ albumId: randomUUID() }), A, reg);
    expect(gone.sections[0]).toMatchObject({ feed: [], empty: true });
  });

  it('the gallery page lists every album, uncut, and shows its section even when switched off', async () => {
    const one = await album(A, 'One', 0);
    const two = await album(A, 'Two', 1);
    await addPhotos(A, one, SITE_GALLERY_CAROUSEL_MAX + 2);
    await addPhotos(A, two, 1);
    const cfg = config({ albumId: null, showPageLink: true });
    cfg.pages[1].sections = [
      { key: SiteSectionKey.GALLERY, enabled: false, data: { albumId: null, showPageLink: false } },
    ];
    const page = buildPage(cfg, SitePage.GALLERY)!;
    expect(page.sections).toHaveLength(1);
    const full = await withFeeds(page, A, registryFor(A));
    const rows = full.sections[0].feed as unknown as { photos: unknown[] }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].photos).toHaveLength(SITE_GALLERY_CAROUSEL_MAX + 2);
  });

  it('the gallery page is in the nav only when linked and a photo exists', () => {
    const linked = config({ albumId: null, showPageLink: true });
    const unlinked = config({ albumId: null, showPageLink: false });
    expect(galleryLinked(linked)).toBe(true);
    expect(galleryLinked(unlinked)).toBe(false);
    const school = {
      name: 'S',
      name_bn: null,
      address: null,
      phone: null,
      email: null,
      logo_key: null,
    };
    const nav = (c: SiteConfig, photos: boolean) =>
      buildManifest(c, false, school as never, false, null, photos).nav.map((x) => x.page);
    expect(nav(linked, true)).toContain(SitePage.GALLERY);
    expect(nav(linked, false)).not.toContain(SitePage.GALLERY);
  });
});
