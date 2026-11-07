import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SiteTheme } from '@biddaloy/shared';
import { THEMES } from '@biddaloy/site-themes';
import { describe, expect, it } from 'vitest';
import { themeCss } from '../../lib/css-vars';
import { portalUrl, tx } from './text';

const here = import.meta.dirname;
const css = readFileSync(resolve(here, 'theme.css'), 'utf8');
const m = THEMES[SiteTheme.MADRASA];

describe('madrasa theme.css', () => {
  it('has brand hex only in the first token block (a palette switch needs no CSS change, D28)', () => {
    const outside = css.replace(/\.t-madrasa\s*\{[^}]*\}/, '');
    expect(outside.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });

  it('scopes every rule under its wrapper class, since every theme CSS shares each page', () => {
    // Astro bundles all Layouts into every page: an unscoped rule would leak into (or be overridden by) another theme.
    const rules = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@font-face\s*\{[^}]*\}/g, '')
      .replace(/@media[^{]*\{/g, '')
      .split('}')
      .map((r) => r.split('{')[0].trim())
      .filter(Boolean);
    expect(rules.length).toBeGreaterThan(50);
    for (const r of rules)
      for (const sel of r.split(/,\s*(?![^(]*\))/))
        expect(sel.trim(), sel).toMatch(/^(html\[lang='(bn|en)'\] )?\.t-madrasa( |$)/);
  });

  it('never styles a section from a neighbour (D31)', () => {
    expect(css).not.toMatch(
      /:first-child|:last-child|:nth-of-type|\.(sec|hero|band)[a-z-]*\s*[+~]/,
    );
  });

  it('keeps the danger red fixed and readable on every palette surface', () => {
    const danger = /--danger:\s*(#[0-9a-f]{6})/i.exec(css)![1];
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const p of m.palettes) {
      const [hi, lo] = [lum(danger), lum(p.vars.surface)].sort((a, b) => b - a);
      expect((hi + 0.05) / (lo + 0.05), p.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses the hidden attribute, not specificity, for anything language related', () => {
    expect(css).not.toMatch(/\[lang-(bn|en)\]|\[data-lang=/);
  });
});

describe('madrasa fonts', () => {
  const pub = resolve(here, '../../../public/fonts');
  const files = [...m.fonts.bn, ...m.fonts.en].flatMap((f) => f.files);

  it('every woff2 the manifest lists exists on disk', () => {
    for (const f of files) expect(existsSync(resolve(pub, f)), f).toBe(true);
  });

  it('each own font has a licence file and total font weight per language pair stays small', () => {
    const own = readdirSync(resolve(pub, 'madrasa'));
    for (const id of [
      'noto-serif-bengali',
      'tiro-bangla',
      'noto-sans-bengali',
      'source-serif-4',
      'source-sans-3',
      'inter',
      'noto-serif',
      'amiri',
    ])
      expect(own, id).toContain(`OFL-${id}.txt`);
    const kb = (names: string[]) =>
      names.reduce((n, f) => n + readFileSync(resolve(pub, f)).length, 0) / 1024;
    const pair = (lang: 'bn' | 'en') => {
      const d = m.defaultTypography[lang];
      const ids = new Set([d.heading, d.body]);
      return kb(m.fonts[lang].filter((f) => ids.has(f.id)).flatMap((f) => f.files));
    };
    // Default pairs only: the school loads just what it picked (css-vars.ts).
    expect(pair('bn')).toBeLessThan(160);
    expect(pair('en')).toBeLessThan(100);
  });

  it('emits font-display: swap rules only for the chosen fonts, from the right folder', () => {
    const out = themeCss({
      theme: SiteTheme.MADRASA,
      palette: 'sunlit',
      typography: m.defaultTypography,
    });
    expect(out.fontFaces).toContain('/fonts/madrasa/noto-serif-bengali-400-bengali.woff2');
    expect(out.fontFaces).toContain('/fonts/madrasa/source-sans-3-400-latin.woff2');
    expect(out.fontFaces).not.toContain('tiro-bangla');
    expect(out.fontFaces).toContain('font-display:swap');
  });
});

describe('madrasa palettes through css-vars', () => {
  it.each(m.palettes.map((p) => p.id))('%s sets exactly the five colour vars', (id) => {
    const { vars } = themeCss({
      theme: SiteTheme.MADRASA,
      palette: id,
      typography: m.defaultTypography,
    });
    const palette = m.palettes.find((p) => p.id === id)!;
    for (const k of ['primary', 'secondary', 'accent', 'surface', 'ink'] as const)
      expect(vars[`--${k}`]).toBe(palette.vars[k]);
  });
});

describe('madrasa header text', () => {
  it('has bn and en for every key', () => {
    for (const k of ['menu', 'portal', 'main'] as const) {
      expect(tx('bn', k)).toBeTruthy();
      expect(tx('en', k)).toBeTruthy();
    }
  });
  it('portal button needs an https address, otherwise it is left out', () => {
    expect(portalUrl('https://app.example.com/')).toBe('https://app.example.com/');
    expect(portalUrl('http://x')).toBeUndefined();
    expect(portalUrl('javascript:alert(1)')).toBeUndefined();
    expect(portalUrl(undefined)).toBeUndefined();
  });
});
