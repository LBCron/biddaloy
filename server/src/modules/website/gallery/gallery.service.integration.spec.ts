import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';
import sharp from 'sharp';
import { SITE_GALLERY_MAX_ALBUMS, SITE_GALLERY_MAX_PHOTOS_PER_ALBUM } from '@biddaloy/shared';
import { SITE_MEDIA_QUOTA_BYTES } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { StorageService } from '../../storage/storage.service';
import { SiteMediaService } from '../site-media.service';
import { SiteConfigService } from '../site-config.service';
import { SiteCacheService } from '../public/site-cache.service';
import { SiteGalleryPhoto } from '../entities/site-gallery-photo.entity';
import { GalleryService } from './gallery.service';

class MemoryStorage {
  objects = new Map<string, Buffer>();
  failPut = false;
  async put(key: string, body: Buffer) {
    this.objects.set(key, body);
  }
  async get(key: string) {
    return { body: Readable.from([this.objects.get(key)]), contentType: 'image/webp' };
  }
  deleteForTenant(key: string, tenantId: string) {
    return StorageService.prototype.deleteForTenant.call(this, key, tenantId);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

let shade = 0;
/** A distinct 1200x800 JPEG each call (a different colour is a different file hash). */
const photo = (n = shade++) =>
  sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: { r: n % 256, g: (n * 7) % 256, b: (n * 13) % 256 },
    },
  })
    .jpeg()
    .toBuffer();

/** [40.6.03] Albums, photos, quota and reorder against a real DB (the row lock, the byte counter). */
describe('GalleryService (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let storage: MemoryStorage;
  let svc: GalleryService;
  const T = SEED_TENANT_ID;

  const used = async () =>
    Number(
      (await ds.query(`SELECT media_bytes_used FROM school_sites WHERE tenant_id = $1`, [T]))[0]
        .media_bytes_used,
    );
  const setUsed = (n: number) =>
    ds.query(`UPDATE school_sites SET media_bytes_used = $2 WHERE tenant_id = $1`, [T, n]);
  const version = async () =>
    Number(
      (await ds.query(`SELECT version FROM school_sites WHERE tenant_id = $1`, [T]))[0].version,
    );
  const add = async (albumId: string, buf?: Buffer) =>
    svc.uploadPhoto(T, albumId, { buffer: buf ?? (await photo()), mimetype: 'image/jpeg' });
  const album = (n = 'A') => svc.createAlbum(T, { bn: 'অ', en: n });

  beforeAll(async () => {
    storage = new MemoryStorage();
    moduleRef = await createTestModule(
      ALL_ENTITIES,
      [
        GalleryService,
        SiteMediaService,
        { provide: StorageService, useValue: storage },
        { provide: SiteConfigService, useValue: { get: async () => ({}) } },
        { provide: SiteCacheService, useValue: { invalidate: async () => undefined } },
      ],
      [],
    );
    ds = moduleRef.get(DataSource);
    svc = moduleRef.get(GalleryService);
  }, 60000);

  afterAll(async () => {
    await clean();
    await moduleRef.close();
  });

  async function clean() {
    await ds.query(`DELETE FROM site_posts WHERE tenant_id = $1`, [T]);
    await ds.query(`DELETE FROM site_gallery_photos WHERE tenant_id = $1`, [T]);
    await ds.query(`DELETE FROM site_gallery_albums WHERE tenant_id = $1`, [T]);
    await ds.query(`DELETE FROM site_media WHERE tenant_id = $1`, [T]);
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [T]);
  }

  beforeEach(async () => {
    await clean();
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft)
       VALUES ($1, 'gallery-int', 'blue', '{}')`,
      [T],
    );
    storage.objects.clear();
  });

  it('upload counts the WebP bytes under tenants/<id>/site/ and bumps the site version', async () => {
    const a = await album();
    const v0 = await version();
    const p = await add(a.id);
    const [m] = await ds.query(`SELECT storage_key, bytes, slot FROM site_media WHERE id = $1`, [
      p.mediaId,
    ]);
    expect(m.storage_key.startsWith(`tenants/${T}/site/`)).toBe(true);
    expect(m.slot).toBe('gallery');
    expect(await used()).toBe(m.bytes);
    expect(await version()).toBeGreaterThan(v0);
  });

  it('deleting a photo gives the bytes back and removes the object', async () => {
    const a = await album();
    const p = await add(a.id);
    await svc.deletePhoto(T, p.id);
    expect(await used()).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it('the same file in two albums is stored and counted once; freed only with the last photo', async () => {
    const a = await album('A');
    const b = await album('B');
    const buf = await photo(5);
    const p1 = await add(a.id, buf);
    const p2 = await add(b.id, buf);
    expect(p2.mediaId).toBe(p1.mediaId);
    const [row] = await ds.query(`SELECT bytes FROM site_media WHERE id = $1`, [p1.mediaId]);
    expect(await used()).toBe(row.bytes);
    await svc.deletePhoto(T, p1.id);
    expect(await used()).toBe(row.bytes); // still shown in album B
    await svc.deleteAlbum(T, b.id);
    expect(await used()).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it('the same file twice in one album is refused and leaves no extra row', async () => {
    const a = await album();
    const buf = await photo(9);
    await add(a.id, buf);
    const err = await add(a.id, buf).catch((e) => e);
    expect(err.message).toBe('site.gallery_invalid');
    expect(
      await ds.query(`SELECT 1 FROM site_gallery_photos WHERE tenant_id = $1`, [T]),
    ).toHaveLength(1);
  });

  it('quota boundary: exactly 100 MB passes, one byte more fails with no orphan media row', async () => {
    const a = await album();
    const buf = await photo(21);
    const n = (await sharp(buf).webp({ quality: 82 }).toBuffer()).length;
    await setUsed(SITE_MEDIA_QUOTA_BYTES - n + 1);
    const err = await add(a.id, buf).catch((e) => e);
    expect(err.message).toBe('site.media_rejected');
    expect(await ds.query(`SELECT 1 FROM site_media WHERE tenant_id = $1`, [T])).toHaveLength(0);
    expect(storage.objects.size).toBe(0);
    await setUsed(SITE_MEDIA_QUOTA_BYTES - n);
    await add(a.id, buf);
    expect(await used()).toBe(SITE_MEDIA_QUOTA_BYTES);
  });

  it('a failing photo insert rolls back the media row and deletes the stored object', async () => {
    const a = await album();
    // A caption over the limit is refused before anything is stored.
    const long = JSON.stringify({ bn: 'x'.repeat(121), en: '' });
    const e1 = await svc
      .uploadPhoto(T, a.id, { buffer: await photo(), mimetype: 'image/jpeg' }, long)
      .catch((e) => e);
    expect(e1.message).toBe('site.gallery_invalid');
    // Force the photo insert itself to fail, in this test only: a spy on the manager's `save`
    // (no change to the shared test database).
    const proto = Object.getPrototypeOf(ds.manager) as { save: (...a: unknown[]) => unknown };
    const real = proto.save;
    const spy = vi.spyOn(proto, 'save').mockImplementation(function (this: unknown, ...args) {
      if (args[0] instanceof SiteGalleryPhoto) throw new Error('boom');
      return real.apply(this, args);
    });
    try {
      const e2 = await add(a.id).catch((e) => e);
      expect(e2.message).toBe('boom');
    } finally {
      spy.mockRestore();
    }
    expect(await ds.query(`SELECT 1 FROM site_media WHERE tenant_id = $1`, [T])).toHaveLength(0);
    expect(await used()).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it('the 61st photo in an album and the 21st album are refused', async () => {
    const a = await album();
    const rows: unknown[] = [];
    for (let i = 0; i < SITE_GALLERY_MAX_PHOTOS_PER_ALBUM; i++) {
      const [m] = await ds.query(
        `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes)
         VALUES ($1,'gallery',$2,$3,1200,800,10) RETURNING id`,
        [T, `tenants/${T}/site/k${i}.webp`, String(i).padStart(64, '0')],
      );
      rows.push(m.id);
      await ds.query(
        `INSERT INTO site_gallery_photos (tenant_id, album_id, media_id, sort_order) VALUES ($1,$2,$3,$4)`,
        [T, a.id, m.id, i],
      );
    }
    const err = await add(a.id).catch((e) => e);
    expect(err.message).toBe('site.gallery_limit');
    expect(storage.objects.size).toBe(0);

    for (let i = 1; i < SITE_GALLERY_MAX_ALBUMS; i++) await album(`n${i}`);
    const err2 = await album('over').catch((e) => e);
    expect(err2.message).toBe('site.gallery_limit');
  });

  it('reorder swaps in one step and refuses a list that is not exactly the current set', async () => {
    const a = await album();
    const p1 = await add(a.id);
    const p2 = await add(a.id);
    const p3 = await add(a.id);
    const res = await svc.reorderPhotos(T, a.id, [p3.id, p1.id, p2.id]);
    expect(res.photos.map((p) => p.id)).toEqual([p3.id, p1.id, p2.id]);
    const bad = await svc.reorderPhotos(T, a.id, [p3.id, p1.id]).catch((e) => e);
    expect(bad.message).toBe('site.gallery_invalid');
    const foreign = await svc
      .reorderPhotos(T, a.id, [p3.id, p1.id, '00000000-0000-4000-8000-000000000001'])
      .catch((e) => e);
    expect(foreign.message).toBe('site.gallery_invalid');
    // The failed attempts changed nothing.
    expect((await svc.listAlbums(T))[0].photos.map((p) => p.id)).toEqual([p3.id, p1.id, p2.id]);
  });

  it('albums reorder; a media still used by a photo cannot be removed (409)', async () => {
    const a = await album('A');
    const b = await album('B');
    const res = await svc.reorderAlbums(T, [b.id, a.id]);
    expect(res.map((x) => x.id)).toEqual([b.id, a.id]);
    const p = await add(a.id);
    const media = moduleRef.get(SiteMediaService);
    const err = await media.remove(T, p.mediaId).catch((e) => e);
    expect(err.message).toBe('site.media_in_use');
  });

  it('deleting a gallery photo never frees a picture a post or the library also uses', async () => {
    const a = await album();
    const media = moduleRef.get(SiteMediaService);
    const buf = await photo(33); // 1200x800: also a valid POST_IMAGE (width <= 1200)
    const g = await add(a.id, buf);
    // Reverse order: a post-image upload of the same file takes the gallery row over.
    const post = await media.upload(T, 'post-image', { buffer: buf, mimetype: 'image/jpeg' });
    expect(post.id).toBe(g.mediaId);
    expect(post.slot).toBe('post-image');
    await ds.query(
      `INSERT INTO site_posts (tenant_id, kind, slug, title, body) VALUES ($1,'POST',$2,'{"bn":"a","en":"a"}',$3)`,
      [T, `p-${g.mediaId.slice(0, 8)}`, JSON.stringify([{ type: 'image', mediaId: g.mediaId }])],
    );
    const before = storage.objects.size;
    await svc.deletePhoto(T, g.id);
    expect(await ds.query(`SELECT 1 FROM site_media WHERE id = $1`, [g.mediaId])).toHaveLength(1);
    expect(storage.objects.size).toBe(before);
    expect(await used()).toBeGreaterThan(0);
  });

  it('a gallery-only picture named by a post body is kept; one nobody uses is freed', async () => {
    const a = await album();
    const kept = await add(a.id);
    const freed = await add(a.id);
    await ds.query(
      `INSERT INTO site_posts (tenant_id, kind, slug, title, body) VALUES ($1,'POST','keep','{"bn":"a","en":"a"}',$2)`,
      [T, JSON.stringify([{ text: kept.mediaId }])],
    );
    await svc.deleteAlbum(T, a.id);
    expect(await ds.query(`SELECT 1 FROM site_media WHERE id = $1`, [kept.mediaId])).toHaveLength(
      1,
    );
    expect(await ds.query(`SELECT 1 FROM site_media WHERE id = $1`, [freed.mediaId])).toHaveLength(
      0,
    );
  });

  it('each stored object has its own key, even for equal bytes in a re-created row', async () => {
    const a = await album();
    const buf = await photo(44);
    const p1 = await add(a.id, buf);
    const [k1] = await ds.query(`SELECT storage_key FROM site_media WHERE id = $1`, [p1.mediaId]);
    await svc.deletePhoto(T, p1.id);
    const p2 = await add(a.id, buf);
    const [k2] = await ds.query(`SELECT storage_key FROM site_media WHERE id = $1`, [p2.mediaId]);
    expect(k2.storage_key).not.toBe(k1.storage_key);
    expect(storage.objects.has(k2.storage_key)).toBe(true);
  });

  it('deleting the chosen album sets the draft section back to no choice and bumps the draft revision only', async () => {
    const a = await album('Chosen');
    const other = await album('Other');
    const draft = {
      pages: [
        {
          page: 'home',
          sections: [
            { key: 'gallery', enabled: true, data: { albumId: a.id, showPageLink: true } },
          ],
        },
      ],
    };
    await ds.query(
      `UPDATE school_sites SET draft = $2, draft_revision = 5, version = 7 WHERE tenant_id = $1`,
      [T, JSON.stringify(draft)],
    );
    await svc.deleteAlbum(T, other.id); // not the chosen one: draft untouched
    const [s1] = await ds.query(
      `SELECT draft, draft_revision FROM school_sites WHERE tenant_id = $1`,
      [T],
    );
    expect(s1.draft.pages[0].sections[0].data.albumId).toBe(a.id);
    expect(s1.draft_revision).toBe(5);
    await svc.deleteAlbum(T, a.id);
    const [s2] = await ds.query(
      `SELECT draft, draft_revision, version FROM school_sites WHERE tenant_id = $1`,
      [T],
    );
    expect(s2.draft.pages[0].sections[0].data).toEqual({ albumId: null, showPageLink: true });
    expect(s2.draft_revision).toBe(6);
  });

  it('another school cannot see or touch an album (404)', async () => {
    const a = await album();
    const other = '00000000-0000-4000-8000-0000000000aa';
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1,'Gallery Other',$2,NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [other, 'gallery-other-int'],
    );
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft)
       VALUES ($1,'gallery-other','blue','{}') ON CONFLICT DO NOTHING`,
      [other],
    );
    try {
      const err = await svc.updateAlbum(other, a.id, { bn: 'x', en: 'y' }).catch((e) => e);
      expect(err.message).toBe('site.gallery_not_found');
      const err2 = await svc.deleteAlbum(other, a.id).catch((e) => e);
      expect(err2.message).toBe('site.gallery_not_found');
      const err3 = await svc.reorderPhotos(other, a.id, []).catch((e) => e);
      expect(err3.message).toBe('site.gallery_not_found');
    } finally {
      await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [other]);
      await ds.query(`DELETE FROM schools WHERE id = $1`, [other]);
    }
  });
});
