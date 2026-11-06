import type {
  BilingualText,
  SiteAnnouncementBar,
  SitePage,
  SiteSectionConfig,
  SiteSectionKey,
  SiteTheme,
  SiteTypography,
} from '@biddaloy/shared';

export type { BilingualText, SiteSectionKey, SiteTheme };

export type Lang = 'bn' | 'en';
export const LANGS: readonly Lang[] = ['bn', 'en'];

/** `GET /public/site/by-host/:host/manifest` (contract from #3618 step 8, assumed until it merges). */
export interface SiteManifest {
  theme: SiteTheme;
  palette: string;
  typography: SiteTypography;
  announcements: SiteAnnouncementBar;
  nav: { page: SitePage; label?: BilingualText }[];
  logo?: string;
  noindex?: boolean;
  schoolName: BilingualText;
  contact?: { address?: BilingualText; phone?: string; email?: string; hours?: BilingualText };
}

/** `GET /public/site/by-host/:host/page/:page`. */
export interface SitePageData {
  page: SitePage;
  sections: (Pick<SiteSectionConfig, 'key' | 'data' | 'typography'> & {
    enabled?: boolean;
    /** System-fed rows (teachers, events, blog); `[]` until their feeds exist. */
    feed?: Record<string, unknown>[];
  })[];
}

export interface SectionProps {
  data: Record<string, unknown>;
  lang: Lang;
  feed: Record<string, unknown>[];
  manifest: SiteManifest;
}

export type FetchResult<T> =
  { kind: 'ok'; data: T } | { kind: 'none' } | { kind: 'down' } | { kind: 'redirect'; to: string };
