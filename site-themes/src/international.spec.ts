import { SiteTheme } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import { BASIC } from './basic';
import { THEMES, defaultConfigFor, validateSiteConfig } from './index';
import { INTERNATIONAL_THEME } from './international';

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('international manifest', () => {
  it('is registered under its own id with three palettes and two font pairs per language', () => {
    expect(THEMES[SiteTheme.INTERNATIONAL]).toBe(INTERNATIONAL_THEME);
    expect(INTERNATIONAL_THEME.palettes.map((p) => p.id)).toEqual([
      'midnight-gold',
      'graphite-lime',
      'bordeaux-cream',
    ]);
    expect(INTERNATIONAL_THEME.fonts.bn.length).toBeGreaterThanOrEqual(2);
    expect(INTERNATIONAL_THEME.fonts.en.length).toBeGreaterThanOrEqual(2);
  });

  for (const p of INTERNATIONAL_THEME.palettes) {
    it(`palette ${p.id} passes WCAG AA`, () => {
      const v = p.vars;
      for (const x of Object.values(v)) expect(x).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(v.ink, v.surface), 'ink on surface').toBeGreaterThanOrEqual(4.5);
      // primary is the dark ground (header, hero, footer) and the link and heading colour on the surface.
      expect(contrast('#ffffff', v.primary), 'white on primary').toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.primary, v.surface), 'primary on surface').toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.secondary, v.surface), 'secondary on surface').toBeGreaterThanOrEqual(4.5);
      // accent text (kicker, numerals, the italic headline word) sits on a dark ground, never on the surface.
      expect(contrast(v.accent, v.primary), 'accent on primary').toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.accent, v.secondary), 'accent on secondary').toBeGreaterThanOrEqual(4.5);
      // large display text (motto, section titles) in ink.
      expect(contrast(v.ink, v.surface), 'display').toBeGreaterThanOrEqual(3);
    });
  }

  it('default typography uses listed fonts and every font file is under international/ or shared', () => {
    expect(INTERNATIONAL_THEME.fonts.bn.map((f) => f.id)).toContain(
      INTERNATIONAL_THEME.defaultTypography.bn.heading,
    );
    expect(INTERNATIONAL_THEME.fonts.bn.map((f) => f.id)).toContain(
      INTERNATIONAL_THEME.defaultTypography.bn.body,
    );
    expect(INTERNATIONAL_THEME.fonts.en.map((f) => f.id)).toContain(
      INTERNATIONAL_THEME.defaultTypography.en.heading,
    );
    expect(INTERNATIONAL_THEME.fonts.en.map((f) => f.id)).toContain(
      INTERNATIONAL_THEME.defaultTypography.en.body,
    );
    for (const f of [...INTERNATIONAL_THEME.fonts.bn, ...INTERNATIONAL_THEME.fonts.en])
      for (const file of f.files)
        expect(file).toMatch(/^(international\/)?[a-z0-9-]+-\d{3}-(bengali|latin)\.woff2$/);
  });

  it('carries every section and field Basic has, so switching themes loses nothing (D25)', () => {
    expect(INTERNATIONAL_THEME.sections.map((s) => [s.key, s.fields.map((f) => f.key)])).toEqual(
      BASIC.sections.map((s) => [s.key, s.fields.map((f) => f.key)]),
    );
    expect(INTERNATIONAL_THEME.pages).toEqual(BASIC.pages);
  });

  it('every required text field has a non-empty bn and en default of its own', () => {
    for (const s of INTERNATIONAL_THEME.sections) {
      for (const f of s.fields.filter((x) => x.kind !== 'images' && x.required)) {
        expect(f.defaults?.bn.trim(), `${s.key}.${f.key}`).toBeTruthy();
        expect(f.defaults?.en.trim(), `${s.key}.${f.key}`).toBeTruthy();
      }
    }
    const hero = INTERNATIONAL_THEME.sections[0].fields.find((f) => f.key === 'headline');
    expect(hero?.defaults).not.toEqual(
      BASIC.sections[0].fields.find((f) => f.key === 'headline')?.defaults,
    );
  });

  it('validate() accepts the manifest own defaults', () => {
    expect(
      validateSiteConfig(defaultConfigFor(SiteTheme.INTERNATIONAL), INTERNATIONAL_THEME).ok,
    ).toBe(true);
  });
});
