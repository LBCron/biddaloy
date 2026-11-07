import type {
  SiteAnnouncementStyle,
  SiteMarqueeSpeed,
  SitePage,
  SiteSectionKey,
  SiteTheme,
} from '../enums/index';
import { SiteMediaSlot } from '../enums/index';
import type { BilingualText } from '../presets/pack.types';

/** Target pixel size per upload slot (D19). `post-image` only caps the width. */
export const SITE_MEDIA_SLOT_PX: Record<SiteMediaSlot, { w: number; h: number; maxW?: number }> = {
  [SiteMediaSlot.LOGO]: { w: 512, h: 512 },
  [SiteMediaSlot.HERO]: { w: 1920, h: 1080 },
  [SiteMediaSlot.ABOUT]: { w: 1200, h: 800 },
  [SiteMediaSlot.POST_COVER]: { w: 1200, h: 630 },
  [SiteMediaSlot.PERSON]: { w: 400, h: 400 },
  [SiteMediaSlot.GALLERY]: { w: 1200, h: 800 },
  [SiteMediaSlot.POST_IMAGE]: { w: 0, h: 0, maxW: 1200 },
};

/**
 * 3-30 chars, lowercase letters, digits and inner hyphens (D34). Same pattern as the DB
 * CHECK `CHK_school_sites_subdomain` (migration 1791900003400); keep the two identical.
 */
export const SITE_SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/**
 * Subdomains a school may not take (D34). Mirror of runbook Part 17 (School websites).
 * Includes the host label of every `server_name` in nginx/templates/*.conf.template:
 * app, demo, staging, ops, www (APP/DEMO/STAGING/OPS/LANDING_DOMAIN), kuma, beszel, logs,
 * inbox-demo, inbox-staging (KUMA/BESZEL/LOGS/INBOX_*_DOMAIN). Those templates hold only
 * `${VAR}` names, no literal hosts.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  'app',
  'api',
  'www',
  'stats',
  'sites',
  'mail',
  'admin',
  'demo',
  'staging',
  'dev',
  'docs',
  'status',
  'cdn',
  'ops',
  'inbox',
  'kuma',
  'site-test',
  'beszel',
  'logs',
  'inbox-demo',
  'inbox-staging',
];

export const SITE_MEDIA_QUOTA_BYTES = 100 * 1024 * 1024;
export const SITE_POST_BODY_MAX_CHARS = 20_000;
export const SITE_POST_MAX_IMAGES = 10;
export const SITE_HERO_MAX_PHOTOS = 5;
export const SITE_GALLERY_MAX_ALBUMS = 20;
export const SITE_GALLERY_MAX_PHOTOS_PER_ALBUM = 60;
export const SITE_GALLERY_CAROUSEL_MAX = 12;
export const SITE_GALLERY_CAPTION_MAX_CHARS = 120;
export const SITE_ANNOUNCEMENTS_MAX = 5;
export const SITE_FEATURED_TEACHERS_MAX = 8;
export const SITE_SUBDOMAIN_REDIRECT_DAYS = 30;
export const SITE_HREF_MAX_CHARS = 500;

/**
 * An announcement link must stay on the school's own site: `/notices`, `/admission?x=1`.
 * Refused: `//evil.com` and `/\evil.com` (browsers read both as another host), `javascript:`,
 * any scheme, and any space or control character (browsers strip tabs and newlines, so
 * `/\t/evil.com` would turn into `//evil.com`). The validator and the site renderer both use it.
 */
export function isSiteRelativeHref(href: unknown): href is string {
  return (
    typeof href === 'string' &&
    href.length <= SITE_HREF_MAX_CHARS &&
    // eslint-disable-next-line no-control-regex
    /^\/(?![/\\])[^\s\\\u0000-\u001f\u007f]*$/.test(href)
  );
}

/** Font ids. */
export interface SiteTypographyPair {
  heading: string;
  body: string;
}

export interface SiteTypography {
  bn: SiteTypographyPair;
  en: SiteTypographyPair;
}

export interface SiteTextStyle {
  size?: 'S' | 'M' | 'L' | 'XL';
  weight?: 'regular' | 'medium' | 'bold';
  align?: 'start' | 'center';
}

interface SiteLangTypography {
  heading?: SiteTextStyle;
  body?: SiteTextStyle;
}

export interface SiteSectionTypography {
  bn?: SiteLangTypography;
  en?: SiteLangTypography;
}

export interface SiteAnnouncement {
  id: string;
  text: BilingualText;
  href?: string;
  from?: string;
  until?: string;
  enabled: boolean;
}

export interface SiteAnnouncementBar {
  style: SiteAnnouncementStyle;
  speed: SiteMarqueeSpeed;
  items: SiteAnnouncement[];
}

export interface SiteSectionConfig {
  key: SiteSectionKey;
  enabled: boolean;
  typography?: SiteSectionTypography;
  data: Record<string, unknown>;
}

export interface SitePageConfig {
  page: SitePage;
  enabled: boolean;
  sections: SiteSectionConfig[];
}

export interface SiteConfig {
  theme: SiteTheme;
  palette: string;
  typography: SiteTypography;
  announcements: SiteAnnouncementBar;
  pages: SitePageConfig[];
}

export type SiteEnquiryStatus = 'NEW' | 'SEEN';

/** Admin read of one photo in a gallery album. */
export interface SiteGalleryPhoto {
  id: string;
  mediaId: string;
  caption: BilingualText | null;
  sortOrder: number;
}

/** Admin read of a gallery album. */
export interface SiteGalleryAlbum {
  id: string;
  title: BilingualText;
  sortOrder: number;
  photos: SiteGalleryPhoto[];
}

/** Public read of a gallery album: no ids the visitor cannot use, no order numbers. */
export interface SitePublicGalleryAlbum {
  id: string;
  title: BilingualText;
  photos: { mediaId: string; caption: BilingualText | null }[];
}

/** What the `gallery` entry in `SiteConfig.sections[].data` holds. */
export interface SiteGallerySectionData {
  heading: BilingualText;
  albumId: string | null;
  showPageLink: boolean;
}
