import { SitePage, SiteSectionKey } from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { SiteGalleryAlbum } from '../../../modules/website/entities/site-gallery-album.entity';
import { SiteGalleryPhoto } from '../../../modules/website/entities/site-gallery-photo.entity';
import { GalleryService } from '../../../modules/website/gallery/gallery.service';
import { SiteConfigService } from '../../../modules/website/site-config.service';
import type { DemoSeedContext, DemoSlice } from '../context';
import { orgIds } from './org';
import { gradient } from './website';

const ALBUMS = [
  {
    title: { bn: 'বার্ষিক ক্রীড়া প্রতিযোগিতা', en: 'Annual sports day' },
    captions: [
      { bn: 'দৌড় প্রতিযোগিতা', en: 'The relay race' },
      { bn: 'পুরস্কার বিতরণ', en: 'Prize giving' },
      { bn: 'দর্শকসারি', en: 'The crowd' },
      { bn: 'বিজয়ী দল', en: 'The winning team' },
      { bn: 'সমাপনী কুচকাওয়াজ', en: 'The closing march' },
    ],
  },
  {
    title: { bn: 'বিজ্ঞান মেলা', en: 'Science fair' },
    captions: [
      { bn: 'প্রকল্প প্রদর্শনী', en: 'Project stalls' },
      { bn: 'বিচারকদের সামনে', en: 'In front of the judges' },
      { bn: 'সেরা প্রকল্প', en: 'The best project' },
    ],
  },
];

/**
 * [40.6.10 / #3671] Two gallery albums on the demo school's site, through the real `GalleryService`
 * (limits, quota, one media row per distinct file all apply). Photos are generated 1200x800 WebP
 * gradients with colours from `ctx.rng`, so no picture file ships. Then the first album goes on the
 * home page gallery section with a link to the gallery page, and the site is published again.
 */
export const slice: DemoSlice = {
  name: 'gallery',
  covers: [SiteGalleryAlbum, SiteGalleryPhoto],
  run: async (ctx: DemoSeedContext) => {
    const T = orgIds(ctx).tenants.find((t) => t.kind === 'HIGH')!.id;
    const gallery = ctx.app.get(GalleryService);
    const site = ctx.app.get(SiteConfigService);
    const hex = () =>
      '#' + ctx.rng.number.int({ min: 0x202020, max: 0xdfdfdf }).toString(16).padStart(6, '0');

    let rows = 0;
    let firstAlbum = '';
    for (const a of ALBUMS) {
      const album = await gallery.createAlbum(T, a.title);
      firstAlbum ||= album.id;
      rows += 1;
      for (const caption of a.captions) {
        const body = await gradient(1200, 800, hex(), hex());
        await gallery.uploadPhoto(
          T,
          album.id,
          { buffer: body, mimetype: 'image/webp' },
          JSON.stringify(caption),
        );
        rows += 1;
      }
    }

    // Show the first album on the home page and link to the gallery page; publish again.
    const cur = await site.get(T);
    const draft = cur.draft as unknown as SiteConfig;
    const home = draft.pages.find((p) => p.page === SitePage.HOME)!;
    const sec = home.sections.find((s) => s.key === SiteSectionKey.GALLERY);
    if (!sec) throw new Error('demo gallery: theme has no home gallery section');
    sec.enabled = true;
    sec.data.albumId = firstAlbum;
    sec.data.showPageLink = true;
    await site.saveDraft(T, { config: draft as never, draft_revision: cur.draft_revision });
    const saved = await site.get(T);
    await site.publish(T, saved.version, saved.draft_revision);
    return rows;
  },
};
