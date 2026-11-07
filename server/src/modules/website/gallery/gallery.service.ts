import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { EntityManager, In, Repository } from 'typeorm';
import {
  SITE_GALLERY_CAPTION_MAX_CHARS,
  SITE_GALLERY_MAX_ALBUMS,
  SITE_GALLERY_MAX_PHOTOS_PER_ALBUM,
  SiteMediaSlot,
  SiteSectionKey,
} from '@biddaloy/shared';
import type { BilingualText, SiteConfig } from '@biddaloy/shared';
import { StorageService } from '../../storage/storage.service';
import { SchoolSite } from '../entities/school-site.entity';
import { SiteGalleryAlbum } from '../entities/site-gallery-album.entity';
import { SiteGalleryPhoto } from '../entities/site-gallery-photo.entity';
import { SiteMedia } from '../entities/site-media.entity';
import { SiteCacheService } from '../public/site-cache.service';
import { SiteConfigService } from '../site-config.service';
import { SiteMediaService } from '../site-media.service';
import type { GalleryAlbumDto, GalleryPhotoDto } from './dto/gallery.dto';

export const ALBUM_TITLE_MAX = 200;

/** One sentence per kind of failure; none carries the submitted value (Rules 23, 24; D37). */
export const galleryInvalid = () => new BadRequestException('site.gallery_invalid');
export const galleryLimit = () => new BadRequestException('site.gallery_limit');
export const galleryNotFound = () => new NotFoundException('site.gallery_not_found');

/** `{ bn, en }` of strings within `max` chars; at least one language filled when `needOne`. */
function checkText(v: unknown, max: number, needOne: boolean): BilingualText {
  const t = v as Record<string, unknown> | null;
  const ok =
    !!t &&
    typeof t === 'object' &&
    !Array.isArray(t) &&
    typeof t.bn === 'string' &&
    typeof t.en === 'string' &&
    t.bn.length <= max &&
    t.en.length <= max &&
    (!needOne || t.bn.trim() !== '' || t.en.trim() !== '');
  if (!ok) throw galleryInvalid();
  return { bn: (t.bn as string).trim(), en: (t.en as string).trim() };
}

/** A caption with both languages empty is no caption. */
function checkCaption(v: unknown): BilingualText | null {
  if (v === null || v === undefined) return null;
  const c = checkText(v, SITE_GALLERY_CAPTION_MAX_CHARS, false);
  return c.bn === '' && c.en === '' ? null : c;
}

/** The multipart `caption` field is JSON text. */
function parseCaption(raw: string | undefined): BilingualText | null {
  if (raw === undefined || raw === '') return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw galleryInvalid();
  }
  return checkCaption(v);
}

const photoDto = (p: SiteGalleryPhoto): GalleryPhotoDto => ({
  id: p.id,
  mediaId: p.media_id,
  caption: p.caption,
  sortOrder: p.sort_order,
});

/**
 * [40.6.03] Photo gallery admin: albums, photos, reorder. Every method takes the tenant from the
 * request context. Writes hold the school's site-row lock (the same lock as `SiteMediaService`),
 * so the album, photo and byte-quota limits are checked and applied in one step per school.
 * Content goes live at once, like posts: each write bumps `site.version` and drops the feed keys.
 */
@Injectable()
export class GalleryService {
  constructor(
    @InjectRepository(SiteGalleryAlbum) private readonly albums: Repository<SiteGalleryAlbum>,
    private readonly media: SiteMediaService,
    private readonly storage: StorageService,
    private readonly cache: SiteCacheService,
    private readonly config: SiteConfigService,
  ) {}

  /** Runs `fn` in a transaction holding the site lock, then drops caches and dead objects. */
  private async write<T>(
    tenantId: string,
    fn: (m: EntityManager) => Promise<{ result: T; deleteKeys?: string[] }>,
  ): Promise<T> {
    await this.config.get(tenantId); // the site row exists
    const out = await this.albums.manager.transaction(async (m) => {
      await this.media.lockSite(m, tenantId);
      const r = await fn(m);
      await m.update(SchoolSite, { tenant_id: tenantId }, { version: () => 'version + 1' });
      return r;
    });
    await this.cache.invalidate(tenantId);
    // After commit: a failed delete leaves an unreferenced object, never a dangling row.
    for (const k of out.deleteKeys ?? []) {
      await this.storage.deleteForTenant(k, tenantId).catch(() => undefined);
    }
    return out.result;
  }

  async listAlbums(tenantId: string): Promise<GalleryAlbumDto[]> {
    const albums = await this.albums.find({
      where: { tenant_id: tenantId },
      order: { sort_order: 'ASC', created_at: 'ASC', id: 'ASC' },
      take: SITE_GALLERY_MAX_ALBUMS,
    });
    if (albums.length === 0) return [];
    const photos = await this.albums.manager.find(SiteGalleryPhoto, {
      where: { tenant_id: tenantId, album_id: In(albums.map((a) => a.id)) },
      order: { sort_order: 'ASC', created_at: 'ASC', id: 'ASC' },
    });
    return albums.map((a) => ({
      id: a.id,
      title: a.title,
      sortOrder: a.sort_order,
      photos: photos.filter((p) => p.album_id === a.id).map(photoDto),
    }));
  }

  private async one(m: EntityManager, tenantId: string, id: string): Promise<SiteGalleryAlbum> {
    const a = await m.findOne(SiteGalleryAlbum, { where: { id, tenant_id: tenantId } });
    if (!a) throw galleryNotFound();
    return a;
  }

  async createAlbum(tenantId: string, title: unknown): Promise<GalleryAlbumDto> {
    const t = checkText(title, ALBUM_TITLE_MAX, true);
    return this.write(tenantId, async (m) => {
      const n = await m.count(SiteGalleryAlbum, { where: { tenant_id: tenantId } });
      if (n >= SITE_GALLERY_MAX_ALBUMS) throw galleryLimit();
      const rows: { next: number }[] = await m.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM site_gallery_albums WHERE tenant_id = $1`,
        [tenantId],
      );
      const a = await m.save(
        m.create(SiteGalleryAlbum, { tenant_id: tenantId, title: t, sort_order: rows[0].next }),
      );
      return { result: { id: a.id, title: a.title, sortOrder: a.sort_order, photos: [] } };
    });
  }

  async updateAlbum(tenantId: string, id: string, title: unknown): Promise<GalleryAlbumDto> {
    const t = checkText(title, ALBUM_TITLE_MAX, true);
    await this.write(tenantId, async (m) => {
      const a = await this.one(m, tenantId, id);
      await m.update(SiteGalleryAlbum, { id: a.id, tenant_id: tenantId }, { title: t });
      return { result: undefined };
    });
    return this.albumDto(tenantId, id);
  }

  private async albumDto(tenantId: string, id: string): Promise<GalleryAlbumDto> {
    const a = (await this.listAlbums(tenantId)).find((x) => x.id === id);
    if (!a) throw galleryNotFound();
    return a;
  }

  /** Deletes the album and its photos; a picture no other photo or page uses is freed with its bytes. */
  async deleteAlbum(tenantId: string, id: string): Promise<void> {
    await this.write(tenantId, async (m) => {
      const a = await this.one(m, tenantId, id);
      const photos = await m.find(SiteGalleryPhoto, {
        where: { album_id: a.id, tenant_id: tenantId },
      });
      await m.delete(SiteGalleryPhoto, { album_id: a.id, tenant_id: tenantId });
      await m.delete(SiteGalleryAlbum, { id: a.id, tenant_id: tenantId });
      await this.clearChosenAlbum(m, tenantId, a.id);
      return {
        result: undefined,
        deleteKeys: await this.release(m, tenantId, [...new Set(photos.map((p) => p.media_id))]),
      };
    });
  }

  /**
   * A gallery section of the draft that chose the deleted album goes back to "the first album".
   * The draft revision moves (an editor that has the old draft open gets the stale answer instead
   * of silently saving the dead id back); the site version does not, a publish carries it (D49).
   */
  private async clearChosenAlbum(m: EntityManager, tenantId: string, albumId: string) {
    const site = await m.findOneOrFail(SchoolSite, { where: { tenant_id: tenantId } });
    const draft = structuredClone(site.draft) as SiteConfig;
    let changed = false;
    for (const page of draft.pages ?? []) {
      for (const s of page.sections ?? []) {
        if (s.key === SiteSectionKey.GALLERY && s.data?.albumId === albumId) {
          s.data.albumId = null;
          changed = true;
        }
      }
    }
    if (!changed) return;
    await m.update(
      SchoolSite,
      { tenant_id: tenantId },
      { draft: draft as never, draft_revision: () => 'draft_revision + 1' },
    );
  }

  /** `ids` must be exactly the school's albums: the order changes in one statement. */
  async reorderAlbums(tenantId: string, ids: string[]): Promise<GalleryAlbumDto[]> {
    await this.write(tenantId, async (m) => {
      const have: { id: string }[] = await m.query(
        `SELECT id FROM site_gallery_albums WHERE tenant_id = $1`,
        [tenantId],
      );
      this.assertSameSet(
        ids,
        have.map((r) => r.id),
      );
      await m.query(
        `UPDATE site_gallery_albums a SET sort_order = o.ord - 1
           FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, ord)
          WHERE a.id = o.id AND a.tenant_id = $1`,
        [tenantId, ids],
      );
      return { result: undefined };
    });
    return this.listAlbums(tenantId);
  }

  private assertSameSet(given: string[], current: string[]): void {
    if (given.length !== current.length || !given.every((i) => current.includes(i))) {
      throw galleryInvalid();
    }
  }

  async uploadPhoto(
    tenantId: string,
    albumId: string,
    file: { buffer: Buffer; mimetype: string },
    captionRaw?: string,
  ): Promise<GalleryPhotoDto> {
    const caption = parseCaption(captionRaw);
    // Signature, exact 1200x800, WebP re-encode: the one fixed sentence `site.media_rejected`.
    const p = await this.media.prepare(SiteMediaSlot.GALLERY, file);
    const hash = createHash('sha256').update(p.out).digest('hex');
    let putKey: string | null = null;
    try {
      return await this.write(tenantId, async (m) => {
        const album = await this.one(m, tenantId, albumId);
        const n = await m.count(SiteGalleryPhoto, {
          where: { tenant_id: tenantId, album_id: album.id },
        });
        if (n >= SITE_GALLERY_MAX_PHOTOS_PER_ALBUM) throw galleryLimit();
        const stored = await this.media.storeIn(m, tenantId, p, hash, (k) => (putKey = k));
        const dup = await m.count(SiteGalleryPhoto, {
          where: { tenant_id: tenantId, album_id: album.id, media_id: stored.row.id },
        });
        if (dup > 0) throw galleryInvalid();
        const rows: { next: number }[] = await m.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM site_gallery_photos WHERE tenant_id = $1 AND album_id = $2`,
          [tenantId, album.id],
        );
        const photo = await m.save(
          m.create(SiteGalleryPhoto, {
            tenant_id: tenantId,
            album_id: album.id,
            media_id: stored.row.id,
            caption,
            sort_order: rows[0].next,
          }),
        );
        return { result: photoDto(photo) };
      });
    } catch (e) {
      // Rolled back: the object we put (if any) has no row; delete it.
      if (putKey) await this.storage.delete(putKey).catch(() => undefined);
      throw e;
    }
  }

  async updatePhoto(tenantId: string, id: string, caption: unknown): Promise<GalleryPhotoDto> {
    const c = checkCaption(caption);
    return this.write(tenantId, async (m) => {
      const p = await m.findOne(SiteGalleryPhoto, { where: { id, tenant_id: tenantId } });
      if (!p) throw galleryNotFound();
      await m.update(SiteGalleryPhoto, { id, tenant_id: tenantId }, { caption: c });
      return { result: photoDto({ ...p, caption: c }) };
    });
  }

  async deletePhoto(tenantId: string, id: string): Promise<void> {
    await this.write(tenantId, async (m) => {
      const p = await m.findOne(SiteGalleryPhoto, { where: { id, tenant_id: tenantId } });
      if (!p) throw galleryNotFound();
      await m.delete(SiteGalleryPhoto, { id, tenant_id: tenantId });
      return { result: undefined, deleteKeys: await this.release(m, tenantId, [p.media_id]) };
    });
  }

  async reorderPhotos(tenantId: string, albumId: string, ids: string[]): Promise<GalleryAlbumDto> {
    await this.write(tenantId, async (m) => {
      const album = await this.one(m, tenantId, albumId);
      const have: { id: string }[] = await m.query(
        `SELECT id FROM site_gallery_photos WHERE tenant_id = $1 AND album_id = $2`,
        [tenantId, album.id],
      );
      this.assertSameSet(
        ids,
        have.map((r) => r.id),
      );
      await m.query(
        `UPDATE site_gallery_photos p SET sort_order = o.ord - 1
           FROM unnest($3::uuid[]) WITH ORDINALITY AS o(id, ord)
          WHERE p.id = o.id AND p.tenant_id = $1 AND p.album_id = $2`,
        [tenantId, album.id, ids],
      );
      return { result: undefined };
    });
    return this.albumDto(tenantId, albumId);
  }

  /**
   * Frees pictures only the gallery owned: row slot `gallery` (a library or post upload of the same
   * file takes the row over, see `SiteMediaService.storeIn`), no gallery photo left, not named in
   * the draft or published site, not a post cover or inside a post body, not a teacher photo.
   * Returns the storage keys to delete after commit; the bytes go back to the quota in this
   * transaction.
   */
  private async release(m: EntityManager, tenantId: string, mediaIds: string[]): Promise<string[]> {
    if (mediaIds.length === 0) return [];
    const site = await m.findOneOrFail(SchoolSite, { where: { tenant_id: tenantId } });
    const shown = JSON.stringify([site.draft, site.published]);
    const candidates: Pick<SiteMedia, 'id' | 'bytes' | 'storage_key'>[] = await m.query(
      `SELECT x.id, x.bytes, x.storage_key FROM site_media x
        WHERE x.tenant_id = $1 AND x.id = ANY($2::uuid[]) AND x.slot = 'gallery'
          AND NOT EXISTS (SELECT 1 FROM site_gallery_photos p WHERE p.tenant_id = $1 AND p.media_id = x.id)
          AND NOT EXISTS (SELECT 1 FROM staff_web_profiles w WHERE w.tenant_id = $1 AND w.photo_media_id = x.id)`,
      [tenantId, mediaIds],
    );
    const gone: typeof candidates = [];
    for (const r of candidates) {
      if (shown.includes(`"${r.id}"`)) continue;
      // Post bodies hold the id as text (no FK): at most 60 ids, one indexed read each.
      const inPost: unknown[] = await m.query(
        `SELECT 1 FROM site_posts
          WHERE tenant_id = $1 AND (cover_media_id = $2 OR position($2::text in body::text) > 0)
          LIMIT 1`,
        [tenantId, r.id],
      );
      if (inPost.length === 0) gone.push(r);
    }
    if (gone.length === 0) return [];
    const bytes = gone.reduce((sum, r) => sum + r.bytes, 0);
    await m.delete(SiteMedia, { tenant_id: tenantId, id: In(gone.map((r) => r.id)) });
    await m.query(
      `UPDATE school_sites SET media_bytes_used = GREATEST(media_bytes_used - $2, 0) WHERE tenant_id = $1`,
      [tenantId, Math.trunc(bytes)],
    );
    return gone.map((r) => r.storage_key);
  }
}
