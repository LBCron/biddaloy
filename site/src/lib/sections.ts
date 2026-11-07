import { SITE_GALLERY_CAROUSEL_MAX, SITE_VIDEO_START_MAX_SECONDS } from '@biddaloy/shared';
import { field } from './pick';
import type {
  BilingualText,
  Lang,
  SiteManifest,
  SitePageData,
  SitePublicGalleryAlbum,
} from './types';

type Row = SitePageData['sections'][number];

/**
 * The sections a page shows, in the admin's order (D31), minus switched-off ones and system-fed
 * ones with nothing to show (D12, D25). `hero` is pinned first and a `footer` section (if a
 * theme ever lists one) last; a key listed twice shows once, at its first place.
 */
export function orderSections(page: Pick<SitePageData, 'sections'>, skip: string[] = []): Row[] {
  const seen = new Set<string>();
  const rows = page.sections.filter((s) => {
    if (s.enabled === false || s.empty || skip.includes(s.key) || seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });
  const rank = (s: Row) =>
    (s.key as string) === 'hero' ? 0 : (s.key as string) === 'footer' ? 2 : 1;
  // Array.sort is stable, so the admin's order holds inside each rank.
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

/** The routine picker's options from `data.sections` (`[{ id, label }]`, set by the server). Rows without an id or a label are dropped. */
export function routineOptions(data: Record<string, unknown>, lang: Lang) {
  return ((data.sections ?? []) as { id?: unknown; label?: unknown }[])
    .map((o) => ({ id: typeof o.id === 'string' ? o.id : '', label: field(o.label, lang) ?? '' }))
    .filter((o) => o.id && o.label);
}

const MEDIA_ID = /^[A-Za-z0-9-]{1,64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const bilingual = (v: unknown): BilingualText | null =>
  isRecord(v) && typeof v.bn === 'string'
    ? { bn: v.bn, en: typeof v.en === 'string' ? v.en : '' }
    : null;

/** How many photos the home carousel shows (D47). */
export const GALLERY_CAROUSEL_MAX = SITE_GALLERY_CAROUSEL_MAX;

/**
 * The albums of a gallery section's `feed`, kept only where the shape is right: photos whose
 * `mediaId` is a plain id (it goes into `/media/<id>`). An album left with no photo is dropped, so
 * the section hides itself (D12). `max` cuts each album (the carousel shows 12, the page all).
 */
export function galleryAlbums(feed: unknown, max = Infinity): SitePublicGalleryAlbum[] {
  if (!Array.isArray(feed)) return [];
  return feed.flatMap((a): SitePublicGalleryAlbum[] => {
    if (!isRecord(a) || !Array.isArray(a.photos)) return [];
    const photos = a.photos
      .flatMap((p) =>
        isRecord(p) && typeof p.mediaId === 'string' && MEDIA_ID.test(p.mediaId)
          ? [{ mediaId: p.mediaId, caption: bilingual(p.caption) }]
          : [],
      )
      .slice(0, max);
    if (photos.length === 0) return [];
    return [{ id: String(a.id ?? ''), title: bilingual(a.title) ?? { bn: '', en: '' }, photos }];
  });
}

/** The "view all photos" link and the page exist only when the manifest lists the gallery page (D51). */
export const galleryPageLinked = (manifest: Pick<SiteManifest, 'nav'>) =>
  manifest.nav.some((n) => n.page === 'gallery');

export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * A `video` section's data, or null when there is nothing safe to play. The id is checked here a
 * second time (the server already did): only a clean 11-character id ever reaches the player.
 */
export function videoOf(data: Record<string, unknown>, lang: Lang) {
  const id =
    typeof data.videoId === 'string' && YOUTUBE_ID.test(data.videoId) ? data.videoId : null;
  if (!id) return null;
  const s = data.startSeconds;
  const start =
    typeof s === 'number' && Number.isInteger(s) && s > 0 && s <= SITE_VIDEO_START_MAX_SECONDS
      ? s
      : null;
  return { id, start, heading: field(data.heading, lang), below: data.headingPosition === 'below' };
}
