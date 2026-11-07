import {
  SITE_FEATURED_TEACHERS_MAX,
  SITE_GALLERY_CAROUSEL_MAX,
  SitePage,
  SiteSectionKey,
} from '@biddaloy/shared';
import type { BilingualText, SiteAnnouncement, SiteConfig } from '@biddaloy/shared';
import type { School } from '../../schools/entities/school.entity';
import type { FeedKind, FeedRegistry } from './feeds/feed-registry';

/** What `GET .../manifest` answers. Matches `SiteManifest` in `site/src/lib/types.ts`. */
export interface PublicManifest {
  theme: SiteConfig['theme'];
  palette: string;
  typography: SiteConfig['typography'];
  announcements: SiteConfig['announcements'];
  nav: { page: SitePage }[];
  logo?: string;
  noindex: boolean;
  schoolName: BilingualText;
  contact: { address?: BilingualText; phone?: string; email?: string };
  /** Present only when the site has an Umami website AND the operator set `UMAMI_SCRIPT_URL` (D42). */
  analytics?: { websiteId: string; scriptUrl: string };
}

/** What `GET .../page/:page` answers. `feed` is `[]` for a section with no system feed. */
export interface PublicPage {
  page: SitePage;
  sections: {
    key: string;
    data: Record<string, unknown>;
    typography?: unknown;
    feed: Record<string, unknown>[];
    /** True when a system-fed section has nothing to show: the site hides it (D12). */
    empty?: boolean;
  }[];
}

/**
 * Sections fed by live school data, and what an empty feed means (D12, D25). `hides`: the whole
 * section is its feed, so no rows hides it. `keeps`: the section also has its own text (admission
 * rules), so the feed rides along but never hides it. A section not listed here has no feed.
 * `routine` is not here: its rows need a class section, so they are read only as an island; the
 * page only carries the list of class sections to pick from (`data.sections`).
 */
const SYSTEM_FED: Partial<Record<SiteSectionKey, { feed: FeedKind; empty: 'hides' | 'keeps' }>> = {
  [SiteSectionKey.NOTICES]: { feed: 'notices', empty: 'hides' },
  [SiteSectionKey.EVENTS]: { feed: 'events', empty: 'hides' },
  [SiteSectionKey.TEACHERS]: { feed: 'teachers', empty: 'hides' },
  [SiteSectionKey.BLOG]: { feed: 'blog', empty: 'hides' },
  [SiteSectionKey.FEES]: { feed: 'fees', empty: 'hides' },
  [SiteSectionKey.ADMISSIONS]: { feed: 'admissions', empty: 'keeps' },
};

/** Fills each system-fed section from the feed registry (60 s cache per kind, never per site version). */
export async function withFeeds(
  page: PublicPage,
  tenantId: string,
  registry: FeedRegistry,
): Promise<PublicPage> {
  const sections = await Promise.all(
    page.sections.map(async (s) => {
      // The routine section also needs the picker list of class sections (bounded, cached).
      if (s.key === SiteSectionKey.ROUTINE) {
        const sections = await registry.cached('sections', tenantId);
        return { ...s, data: { ...s.data, sections } };
      }
      if (s.key === SiteSectionKey.GALLERY) {
        const albums = pickGallery(
          await registry.cached('gallery', tenantId),
          page.page,
          s.data.albumId,
        );
        return albums.length === 0 ? { ...s, feed: [], empty: true } : { ...s, feed: albums };
      }
      const fed = SYSTEM_FED[s.key as SiteSectionKey];
      if (!fed) return s;
      // The home page shows the first 8 teachers (D27); the teachers page shows them all.
      const opts =
        fed.feed === 'teachers' && page.page === SitePage.HOME
          ? { limit: SITE_FEATURED_TEACHERS_MAX }
          : {};
      const feed = await registry.cached(fed.feed, tenantId, opts);
      return fed.empty === 'hides' && feed.length === 0
        ? { ...s, feed, empty: true }
        : { ...s, feed };
    }),
  );
  return { ...page, sections };
}

/**
 * What a gallery section shows (D50): the gallery page lists every album; any other page shows one
 * album, the chosen one or (no choice) the first, cut to the carousel size. A chosen album that is
 * gone or empty shows nothing: the site hides the section (D12).
 */
function pickGallery(
  all: Record<string, unknown>[],
  page: SitePage,
  albumId: unknown,
): Record<string, unknown>[] {
  if (page === SitePage.GALLERY) return all;
  const album = typeof albumId === 'string' ? all.find((a) => a.id === albumId) : all[0];
  if (!album) return [];
  const photos = (album.photos as unknown[]).slice(0, SITE_GALLERY_CAROUSEL_MAX);
  return [{ ...album, photos }];
}

/**
 * True when some enabled gallery section asks for the page link (`showPageLink`). The gallery page
 * and its nav entry also need at least one photo, which the caller checks.
 */
export function galleryLinked(config: SiteConfig): boolean {
  return config.pages.some((p) =>
    p.sections.some(
      (s) => s.key === SiteSectionKey.GALLERY && s.enabled && s.data.showPageLink === true,
    ),
  );
}

type SchoolFields = Pick<School, 'name' | 'name_bn' | 'address' | 'phone' | 'email' | 'logo_key'>;

const both = (v: string): BilingualText => ({ bn: v, en: v });

/** Built from the published config only. Enabled announcements are kept; the date window is applied per request by `inWindow`. */
export function buildManifest(
  published: SiteConfig,
  noindex: boolean,
  school: SchoolFields,
  /** A logo uploaded in the website screens (site_media). It beats the school profile logo. */
  hasSiteLogo = false,
  /** `school_sites.umami_website_id`; never set for a draft preview (previews are not counted). */
  umamiWebsiteId: string | null = null,
  /** The gallery page is in `nav` only when linked AND an album has a photo (D50). */
  galleryPage = false,
): PublicManifest {
  const contact: PublicManifest['contact'] = {};
  if (school.address) contact.address = both(school.address);
  if (school.phone) contact.phone = school.phone;
  if (school.email) contact.email = school.email;
  return {
    theme: published.theme,
    palette: published.palette,
    typography: published.typography,
    announcements: {
      ...published.announcements,
      items: published.announcements.items.filter((a) => a.enabled),
    },
    nav: published.pages
      .filter((p) => p.enabled && (p.page !== SitePage.GALLERY || galleryPage))
      .map((p) => ({ page: p.page })),
    ...(hasSiteLogo || school.logo_key ? { logo: '/media/logo' } : {}),
    noindex,
    schoolName: { bn: school.name_bn ?? school.name, en: school.name },
    contact,
    ...analyticsOf(umamiWebsiteId),
  };
}

/** Only the website id and the public script URL leave the server; never the API URL or token. */
function analyticsOf(websiteId: string | null): Pick<PublicManifest, 'analytics'> {
  const scriptUrl = process.env.UMAMI_SCRIPT_URL?.trim();
  return websiteId && scriptUrl ? { analytics: { websiteId, scriptUrl } } : {};
}

// A bare date is a Bangladesh calendar day (UTC+6). A date that does not parse never shows.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const startOf = (v: string) => new Date(DAY.test(v) ? `${v}T00:00:00+06:00` : v);
const endOf = (v: string) => new Date(DAY.test(v) ? `${v}T23:59:59.999+06:00` : v);

/** An announcement shows from `from` through `until` (a bare date means the whole day). */
export function inWindow(a: SiteAnnouncement, now: Date): boolean {
  const from = a.from ? startOf(a.from) : null;
  const until = a.until ? endOf(a.until) : null;
  if ((from && Number.isNaN(from.getTime())) || (until && Number.isNaN(until.getTime())))
    return false;
  return !(from && from > now) && !(until && until < now);
}

export function withAnnouncementWindow(m: PublicManifest, now: Date): PublicManifest {
  return {
    ...m,
    announcements: {
      ...m.announcements,
      items: m.announcements.items.filter((a) => inWindow(a, now)),
    },
  };
}

/** `null` when the page is off or unknown: the caller answers the one site 404. */
export function buildPage(published: SiteConfig, page: string): PublicPage | null {
  if (!(Object.values(SitePage) as string[]).includes(page)) return null;
  const cfg = published.pages.find((p) => p.page === page && p.enabled);
  if (!cfg) return null;
  return {
    page: cfg.page,
    sections: cfg.sections
      // The gallery page always shows its gallery section, whatever the section switch says.
      .filter(
        (s) => s.enabled || (cfg.page === SitePage.GALLERY && s.key === SiteSectionKey.GALLERY),
      )
      .map((s) => ({ key: s.key, data: s.data, typography: s.typography, feed: [] })),
  };
}
