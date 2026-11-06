import {
  SITE_ANNOUNCEMENTS_MAX,
  SITE_HERO_MAX_PHOTOS,
  SITE_POST_BODY_MAX_CHARS,
  SitePage,
  SiteSectionKey,
} from '@biddaloy/shared';
import type { SiteConfig, SitePageConfig, SiteSectionConfig } from '@biddaloy/shared';
import type { ThemeManifest } from './manifest';

export const SITE_TEXT_MAX_CHARS = 2000;

export type ValidateResult = { ok: true; value: SiteConfig } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * Checks a SiteConfig against a theme manifest. Plain functions, no zod.
 * Errors are fixed codes and never echo input (Rule 23). Unknown keys are dropped.
 */
export function validateSiteConfig(config: unknown, manifest: ThemeManifest): ValidateResult {
  const errors: string[] = [];
  const bad = (code: string) => {
    if (!errors.includes(code)) errors.push(code);
  };
  if (!isObj(config)) return { ok: false, errors: ['config.invalid'] };

  if (config.theme !== manifest.id) bad('theme.mismatch');
  if (!isStr(config.palette) || !manifest.palettes.some((p) => p.id === config.palette))
    bad('palette.unknown');

  const typo = isObj(config.typography) ? config.typography : {};
  const pick = (lang: 'bn' | 'en') => {
    const pair = isObj(typo[lang]) ? (typo[lang] as Obj) : {};
    const ids = manifest.fonts[lang].map((f) => f.id);
    for (const role of ['heading', 'body'] as const) {
      if (!isStr(pair[role]) || !ids.includes(pair[role])) bad('font.unknown');
    }
    return { heading: String(pair.heading), body: String(pair.body) };
  };
  const typography = { bn: pick('bn'), en: pick('en') };

  const bar = isObj(config.announcements) ? config.announcements : {};
  const items = Array.isArray(bar.items) ? bar.items : [];
  if (items.length > SITE_ANNOUNCEMENTS_MAX) bad('announcements.tooMany');
  const announcements = { ...(bar as object), items } as SiteConfig['announcements'];

  const pageKeys = new Set<string>(Object.values(SitePage));
  const rawPages = Array.isArray(config.pages) ? config.pages : [];
  if (!Array.isArray(config.pages)) bad('pages.invalid');
  const pages: SitePageConfig[] = [];
  for (const p of rawPages) {
    if (!isObj(p) || !isStr(p.page) || !pageKeys.has(p.page)) {
      bad('page.unknown');
      continue;
    }
    const sections: SiteSectionConfig[] = [];
    for (const s of Array.isArray(p.sections) ? p.sections : []) {
      const def =
        isObj(s) && isStr(s.key) ? manifest.sections.find((m) => m.key === s.key) : undefined;
      if (!isObj(s) || !def) {
        bad('section.unknown');
        continue;
      }
      const data: Obj = {};
      const raw = isObj(s.data) ? s.data : {};
      for (const f of def.fields) {
        const v = raw[f.key];
        if (f.kind === 'images') {
          if (v === undefined) continue;
          if (!Array.isArray(v)) bad('field.invalid');
          else if (v.length > SITE_HERO_MAX_PHOTOS) bad('images.tooMany');
          else data[f.key] = v;
          continue;
        }
        const max = f.kind === 'richtext' ? SITE_POST_BODY_MAX_CHARS : SITE_TEXT_MAX_CHARS;
        if (v === undefined) {
          if (f.required) bad('field.missing');
          continue;
        }
        if (!isObj(v) || !isStr(v.bn) || !isStr(v.en)) {
          bad('field.invalid');
          continue;
        }
        if (v.bn.length > max || v.en.length > max) bad('text.tooLong');
        data[f.key] = { bn: v.bn, en: v.en };
      }
      sections.push({
        key: s.key as SiteSectionKey,
        enabled: s.enabled !== false,
        ...(isObj(s.typography) ? { typography: s.typography } : {}),
        data,
      });
    }
    if (
      p.page === SitePage.HOME &&
      sections.length > 0 &&
      sections[0].key !== SiteSectionKey.HERO
    ) {
      bad('hero.notFirst');
    }
    pages.push({ page: p.page as SitePage, enabled: p.enabled !== false, sections });
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      theme: manifest.id,
      palette: config.palette as string,
      typography,
      announcements,
      pages,
    },
  };
}
