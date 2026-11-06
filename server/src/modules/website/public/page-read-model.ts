import { SitePage } from '@biddaloy/shared';
import type { BilingualText, SiteAnnouncement, SiteConfig } from '@biddaloy/shared';
import type { School } from '../../schools/entities/school.entity';

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
}

/** What `GET .../page/:page` answers. `feed` stays `[]` until a section has a system feed. */
export interface PublicPage {
  page: SitePage;
  sections: {
    key: string;
    data: Record<string, unknown>;
    typography?: unknown;
    feed: Record<string, unknown>[];
  }[];
}

type SchoolFields = Pick<School, 'name' | 'name_bn' | 'address' | 'phone' | 'email' | 'logo_key'>;

const both = (v: string): BilingualText => ({ bn: v, en: v });

/** Built from the published config only. Enabled announcements are kept; the date window is applied per request by `inWindow`. */
export function buildManifest(
  published: SiteConfig,
  noindex: boolean,
  school: SchoolFields,
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
    nav: published.pages.filter((p) => p.enabled).map((p) => ({ page: p.page })),
    ...(school.logo_key ? { logo: '/media/logo' } : {}),
    noindex,
    schoolName: { bn: school.name_bn ?? school.name, en: school.name },
    contact,
  };
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
      .filter((s) => s.enabled)
      .map((s) => ({ key: s.key, data: s.data, typography: s.typography, feed: [] })),
  };
}
