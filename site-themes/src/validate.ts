import {
  SITE_ANNOUNCEMENTS_MAX,
  SITE_HERO_MAX_PHOTOS,
  SITE_POST_BODY_MAX_CHARS,
  SiteAnnouncementStyle,
  SiteMarqueeSpeed,
  SitePage,
  SiteSectionKey,
} from '@biddaloy/shared';
import type {
  SiteConfig,
  SitePageConfig,
  SiteSectionConfig,
  SiteSectionTypography,
} from '@biddaloy/shared';
import type { ThemeManifest } from './manifest';

export const SITE_TEXT_MAX_CHARS = 2000;

export type ValidateResult = { ok: true; value: SiteConfig } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

const SIZES = ['S', 'M', 'L', 'XL'];
const WEIGHTS = ['regular', 'medium', 'bold'];
const ALIGNS = ['start', 'center'];

/** Keeps only known typography keys with known values. */
function cleanTypography(raw: Obj, bad: (code: string) => void): SiteSectionTypography {
  const out: SiteSectionTypography = {};
  for (const lang of ['bn', 'en'] as const) {
    if (raw[lang] === undefined) continue;
    if (!isObj(raw[lang])) {
      bad('typography.invalid');
      continue;
    }
    const pair: Obj = {};
    for (const role of ['heading', 'body'] as const) {
      const st = (raw[lang] as Obj)[role];
      if (st === undefined) continue;
      if (!isObj(st)) {
        bad('typography.invalid');
        continue;
      }
      const o: Obj = {};
      if (st.size !== undefined)
        isStr(st.size) && SIZES.includes(st.size) ? (o.size = st.size) : bad('typography.invalid');
      if (st.weight !== undefined)
        isStr(st.weight) && WEIGHTS.includes(st.weight)
          ? (o.weight = st.weight)
          : bad('typography.invalid');
      if (st.align !== undefined)
        isStr(st.align) && ALIGNS.includes(st.align)
          ? (o.align = st.align)
          : bad('typography.invalid');
      pair[role] = o;
    }
    out[lang] = pair as SiteSectionTypography['bn'];
  }
  return out;
}

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
  const style = Object.values(SiteAnnouncementStyle).find((v) => v === bar.style);
  const speed = Object.values(SiteMarqueeSpeed).find((v) => v === bar.speed);
  if (!style || !speed) bad('announcements.invalid');
  const cleanItems: SiteConfig['announcements']['items'] = [];
  for (const it of items.slice(0, SITE_ANNOUNCEMENTS_MAX)) {
    const ok =
      isObj(it) &&
      isStr(it.id) &&
      it.id.length <= 64 &&
      isObj(it.text) &&
      isStr(it.text.bn) &&
      isStr(it.text.en) &&
      it.text.bn.length <= SITE_TEXT_MAX_CHARS &&
      it.text.en.length <= SITE_TEXT_MAX_CHARS &&
      typeof it.enabled === 'boolean' &&
      (it.href === undefined ||
        (isStr(it.href) &&
          it.href.length <= 500 &&
          /^(https?:\/\/|\/)/i.test(it.href) &&
          !it.href.startsWith('//'))) &&
      (it.from === undefined || (isStr(it.from) && !Number.isNaN(Date.parse(it.from)))) &&
      (it.until === undefined || (isStr(it.until) && !Number.isNaN(Date.parse(it.until))));
    if (!ok) {
      bad('announcements.item.invalid');
      continue;
    }
    cleanItems.push({
      id: it.id as string,
      text: { bn: (it.text as Obj).bn as string, en: (it.text as Obj).en as string },
      enabled: it.enabled as boolean,
      ...(it.href !== undefined ? { href: it.href as string } : {}),
      ...(it.from !== undefined ? { from: it.from as string } : {}),
      ...(it.until !== undefined ? { until: it.until as string } : {}),
    });
  }
  const announcements: SiteConfig['announcements'] = {
    style: style ?? SiteAnnouncementStyle.STATIC,
    speed: speed ?? SiteMarqueeSpeed.NORMAL,
    items: cleanItems,
  };

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
        ...(isObj(s.typography) ? { typography: cleanTypography(s.typography, bad) } : {}),
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
