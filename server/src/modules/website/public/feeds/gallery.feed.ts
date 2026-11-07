import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SITE_GALLERY_MAX_ALBUMS, SITE_GALLERY_MAX_PHOTOS_PER_ALBUM } from '@biddaloy/shared';
import type { BilingualText, SitePublicGalleryAlbum } from '@biddaloy/shared';
import type { Feed, FeedRow } from './feed-registry';

/**
 * Every album that has at least one photo, in order, as `SitePublicGalleryAlbum` rows (at most
 * 20 albums of 60 photos). One cached read per school; the page builder picks the album a section
 * shows and cuts the carousel, so there is one cache key and one `DEL` on every gallery write.
 */
@Injectable()
export class GalleryFeed implements Feed {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async load(tenantId: string): Promise<FeedRow[]> {
    const albums: { id: string; title: BilingualText }[] = await this.ds.query(
      `SELECT id, title FROM site_gallery_albums
        WHERE tenant_id = $1
        ORDER BY sort_order, created_at, id
        LIMIT $2`,
      [tenantId, SITE_GALLERY_MAX_ALBUMS],
    );
    if (albums.length === 0) return [];
    const photos: {
      album_id: string;
      media_id: string;
      caption: BilingualText | null;
    }[] = await this.ds.query(
      `SELECT album_id, media_id, caption FROM site_gallery_photos
        WHERE tenant_id = $1 AND album_id = ANY($2::uuid[])
        ORDER BY album_id, sort_order, created_at, id
        LIMIT $3`,
      [
        tenantId,
        albums.map((a) => a.id),
        SITE_GALLERY_MAX_ALBUMS * SITE_GALLERY_MAX_PHOTOS_PER_ALBUM,
      ],
    );
    const out: SitePublicGalleryAlbum[] = [];
    for (const a of albums) {
      const own = photos
        .filter((p) => p.album_id === a.id)
        .map((p) => ({ mediaId: p.media_id, caption: p.caption }));
      if (own.length > 0) out.push({ id: a.id, title: a.title, photos: own });
    }
    return out as unknown as FeedRow[];
  }
}
