import { SiteGalleryAlbum } from '../../../website/entities/site-gallery-album.entity';
import { createRefChildTab } from '../people/ref-child-tab.factory';

/**
 * [40.6.10] `site_gallery_albums`: the album folders of the school gallery (title and order).
 * Photos are not in the workbook: `site_gallery_photos` points at `site_media`, a file in the
 * storage backup, and a photo row without its file would only 404 (both are in `ENTITY_COVERAGE_EXEMPT`).
 * A restore therefore brings back empty albums for the admin to refill, and never deletes one
 * (`deleteByAbsence: false`): an album with photos is held by a RESTRICT foreign key, and one made
 * after the backup must survive it. The key is `sort_order`, which the gallery service keeps unique.
 */
export const siteGalleryAlbumsTab = createRefChildTab<SiteGalleryAlbum>({
  name: 'site_gallery_albums',
  entityClass: SiteGalleryAlbum,
  refs: [],
  fields: [
    { key: 'title', type: 'json', required: true, label: { en: 'Title', bn: 'শিরোনাম' } },
    { key: 'sort_order', type: 'int', required: true, label: { en: 'Order', bn: 'ক্রম' } },
  ],
  naturalKey: ['sort_order'],
  deleteByAbsence: false,
});
