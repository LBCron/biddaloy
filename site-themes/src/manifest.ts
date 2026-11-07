import type {
  BilingualText,
  SiteMediaSlot,
  SitePage,
  SiteSectionKey,
  SiteTheme,
  SiteTypography,
} from '@biddaloy/shared';

/** The five colours a school may pick between (D28). Six-digit hex only. */
export interface ThemePalette {
  id: string;
  name: BilingualText;
  vars: { primary: string; secondary: string; accent: string; surface: string; ink: string };
}

/** `files` are woff2 names under `site/public/fonts/<theme>/` (D29). */
export interface ThemeFont {
  id: string;
  family: string;
  files: string[];
  sample: BilingualText;
}

/** `text`/`richtext` hold a BilingualText; `images` hold a list of media ids. */
export type ThemeFieldKind =
  | 'text'
  | 'richtext'
  | 'images'
  /** null or a UUID string (gallery album). */
  | 'uuid'
  | 'bool'
  /** One of `options`. */
  | 'choice'
  /** null or an 11-character YouTube id. */
  | 'youtubeId'
  /** null or a whole number 0-86400. */
  | 'seconds';

export interface ThemeField {
  key: string;
  kind: ThemeFieldKind;
  required: boolean;
  /** Bilingual default for `text`/`richtext` fields (D25). */
  defaults?: BilingualText;
  /** Upload slot for `images` fields. */
  slot?: SiteMediaSlot;
  /** Allowed values for a `choice` field. */
  options?: string[];
  /** Default for the non-text kinds (`null`, `false`, `'above'`). */
  initial?: unknown;
}

export interface ThemeSection {
  key: SiteSectionKey;
  fields: ThemeField[];
  /** `false`: a fresh config lists the section switched off (gallery, video). */
  enabledByDefault?: false;
}

export interface ThemePage {
  page: SitePage;
  /** Section keys in default order. On `home`, hero comes first (D31). */
  sections: SiteSectionKey[];
}

export interface ThemeManifest {
  id: SiteTheme;
  name: BilingualText;
  palettes: ThemePalette[];
  fonts: { bn: ThemeFont[]; en: ThemeFont[] };
  defaultTypography: SiteTypography;
  sections: ThemeSection[];
  pages: ThemePage[];
}
