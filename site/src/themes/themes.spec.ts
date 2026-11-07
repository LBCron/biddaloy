import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SiteTheme } from '@biddaloy/shared';
import { THEMES } from '@biddaloy/site-themes';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

// Astro bundles every theme's CSS into every page, so a rule that is not scoped to its theme's wrapper
// class (`<div class="t-<theme>">` in the theme's Layout.astro) leaks into the other themes. This spec holds
// all six scoped themes to the same rules, and holds their text colours to WCAG AA in every palette.
const here = import.meta.dirname;
const SCOPED = [
  [SiteTheme.PRIMARY, 'primary'],
  [SiteTheme.HIGH_SCHOOL, 'high-school'],
  [SiteTheme.INTERNATIONAL, 'international'],
  [SiteTheme.PREMIUM, 'premium'],
  [SiteTheme.COLLEGE, 'college'],
  [SiteTheme.MADRASA, 'madrasa'],
] as const;
const read = (dir: string) => readFileSync(resolve(here, dir, 'theme.css'), 'utf8');

/** Every style rule outside `@keyframes`, with its selector list and declarations. */
function styleRules(css: string) {
  const out: { selectors: string[]; props: string[] }[] = [];
  postcss.parse(css).walkRules((r) => {
    if (r.parent?.type === 'atrule' && /keyframes$/.test((r.parent as postcss.AtRule).name)) return;
    const props: string[] = [];
    r.each((n) => {
      if (n.type === 'decl') props.push(n.prop);
    });
    out.push({ selectors: r.selectors, props });
  });
  return out;
}

describe.each(SCOPED)('%s theme.css scoping', (_id, dir) => {
  const css = read(dir);
  const wrap = new RegExp(`^(html\\[lang='(bn|en)'\\] )?\\.t-${dir}( |$)`);

  it('scopes every rule (also inside @media) under its wrapper class', () => {
    const rules = styleRules(css);
    expect(rules.length).toBeGreaterThan(50);
    for (const r of rules) for (const s of r.selectors) expect(s, s).toMatch(wrap);
  });

  it('prefixes its @keyframes names, since keyframes are global', () => {
    postcss.parse(css).walkAtRules(/keyframes$/, (a) => {
      expect(a.params).toMatch(new RegExp(`^t-${dir}-`));
    });
  });
});

describe('across the whole bundle', () => {
  const all = SCOPED.map(([, dir]) => read(dir)).join('\n');

  it('no custom property is defined outside a theme wrapper (would be set for every theme)', () => {
    const unscoped = styleRules(all)
      .filter((r) => r.props.some((p) => p.startsWith('--')))
      .flatMap((r) => r.selectors)
      .filter((s) => !/^(html\[lang='(bn|en)'\] )?\.t-[a-z-]+( |$)/.test(s));
    expect(unscoped).toEqual([]);
  });

  it('no two themes define the same @keyframes name', () => {
    const names: string[] = [];
    postcss.parse(all).walkAtRules(/keyframes$/, (a) => names.push(a.params));
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---- contrast -------------------------------------------------------------------------------------------
type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Resolve `--name` from a theme's CSS text: `color-mix(in srgb, var(--a) N%, var(--b))` or `var(--a)`. */
function token(css: string, name: string, v: Record<string, Rgb>): Rgb | undefined {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (!m) return undefined;
  const mix = /color-mix\(in srgb,\s*var\(--(\w+)\)\s*([\d.]+)%,\s*var\(--(\w+)\)\)/.exec(m[1]);
  if (mix) {
    const p = Number(mix[2]) / 100;
    return v[mix[1]].map((c, i) => c * p + v[mix[3]][i] * (1 - p)) as Rgb;
  }
  const one = /^var\(--(\w+)\)$/.exec(m[1].trim());
  return one ? v[one[1]] : undefined;
}

const THEME_DIRS = [
  ['basic', SiteTheme.BASIC] as const,
  ...SCOPED.map(([id, dir]) => [dir, id] as const),
];
describe.each(THEME_DIRS)('%s text contrast, every palette (WCAG AA 4.5:1)', (dir, id) => {
  const css = read(dir);
  const basic = read('basic');
  for (const p of THEMES[id].palettes) {
    it(`${p.id}: --ink-3 (dates, captions, hints) and links read on the surface and on --bg-2`, () => {
      const v = Object.fromEntries(
        Object.entries(p.vars).map(([k, x]) => [k, hex(x as string)]),
      ) as Record<string, Rgb>;
      const bg2 = token(css, '--bg-2', v) ?? token(basic, '--bg-2', v)!;
      const ink3 = token(css, '--ink-3', v) ?? token(basic, '--ink-3', v)!;
      expect(ratio(ink3, v.surface), 'ink-3 on surface').toBeGreaterThanOrEqual(4.5);
      expect(ratio(ink3, bg2), 'ink-3 on bg-2').toBeGreaterThanOrEqual(4.5);
      // Bare links: Basic colours them --secondary; a theme that finds that too light sets --link.
      const link = token(css, '--link', v) ?? v.secondary;
      expect(ratio(link, v.surface), 'link on surface').toBeGreaterThanOrEqual(4.5);
      expect(ratio(link, bg2), 'link on bg-2').toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('accent as text only sits on a dark ground', () => {
  // The accent is a rule or ornament colour (1.5-4:1 on the surface). Where a theme prints it as text, the
  // ground is --primary or --secondary and the pair must still read.
  const onGround: [SiteTheme, 'primary' | 'secondary'][] = [
    [SiteTheme.HIGH_SCHOOL, 'secondary'], // letterhead
    [SiteTheme.INTERNATIONAL, 'primary'], // hero kicker, dates
    [SiteTheme.INTERNATIONAL, 'secondary'], // footer headings
  ];
  it.each(onGround)('%s accent on %s', (id, ground) => {
    for (const p of THEMES[id].palettes) {
      const v = p.vars as Record<string, string>;
      expect(ratio(hex(v.accent), hex(v[ground])), p.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});
