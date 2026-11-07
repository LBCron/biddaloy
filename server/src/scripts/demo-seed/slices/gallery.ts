import { SiteGalleryAlbum } from '../../../modules/website/entities/site-gallery-album.entity';
import { SiteGalleryPhoto } from '../../../modules/website/entities/site-gallery-photo.entity';
import type { DemoSlice } from '../context';

/** [40.6.02] Gallery tables exist; the demo albums and photos arrive with the Wave 6 close. */
export const slice: DemoSlice = {
  name: 'gallery',
  covers: [SiteGalleryAlbum, SiteGalleryPhoto],
  owedBy: '#3671 (40.6.10)',
  run: async () => {},
};
