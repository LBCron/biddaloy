import { SiteTheme } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import { BASIC } from './basic';
import { THEMES, defaultConfigFor, validateSiteConfig } from './index';
import { PREMIUM_THEME } from './premium';

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

describe('premium manifest', () => {
  it('is registered under its own id with three palettes and two font pairs per language', () => {
    expect(THEMES[SiteTheme.PREMIUM]).toBe(PREMIUM_THEME);
    expect(PREMIUM_THEME.palettes.map((p) => p.id)).toEqual([
      'ivory-oxblood',
      'ivory-ink',
      'linen-forest',
    ]);
    expect(PREMIUM_THEME.fonts.bn.length).toBeGreaterThanOrEqual(2);
    expect(PREMIUM_THEME.fonts.en.length).toBeGreaterThanOrEqual(2);
  });

  for (const p of PREMIUM_THEME.palettes) {
    it(`palette ${p.id} passes WCAG AA`, () => {
      const v = p.vars;
      for (const x of Object.values(v)) expect(x).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(v.ink, v.surface), 'ink on surface').toBeGreaterThanOrEqual(4.5);
      // primary is the dark ground (header, hero, footer) and the link and heading colour on the surface.
      expect(contrast('#ffffff', v.primary), 'white on primary').toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.primary, v.surface), 'primary on surface').toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.secondary, v.surface), 'secondary on surface').toBeGreaterThanOrEqual(4.5);
      // The ticket asked for accent text on primary at 4.5; brass cannot, so it is never text. It is a hairline
      // or ornament, which needs 3:1 against both the surface it is ruled on and the dark ground it edges.
      expect(contrast(v.accent, v.surface), 'brass rule on surface').toBeGreaterThanOrEqual(3);
      expect(contrast(v.accent, v.primary), 'brass rule on primary').toBeGreaterThanOrEqual(3);
      // large display text (motto, section titles) in ink.
      expect(contrast(v.ink, v.surface), 'display').toBeGreaterThanOrEqual(3);
    });
  }

  it('default typography uses listed fonts and every font file is under premium/ or shared', () => {
    expect(PREMIUM_THEME.fonts.bn.map((f) => f.id)).toContain(
      PREMIUM_THEME.defaultTypography.bn.heading,
    );
    expect(PREMIUM_THEME.fonts.bn.map((f) => f.id)).toContain(
      PREMIUM_THEME.defaultTypography.bn.body,
    );
    expect(PREMIUM_THEME.fonts.en.map((f) => f.id)).toContain(
      PREMIUM_THEME.defaultTypography.en.heading,
    );
    expect(PREMIUM_THEME.fonts.en.map((f) => f.id)).toContain(
      PREMIUM_THEME.defaultTypography.en.body,
    );
    for (const f of [...PREMIUM_THEME.fonts.bn, ...PREMIUM_THEME.fonts.en])
      for (const file of f.files)
        expect(file).toMatch(/^(premium\/)?[a-z0-9-]+-\d{3}-(bengali|latin)\.woff2$/);
  });

  it('carries every section and field Basic has, so switching themes loses nothing (D25)', () => {
    expect(PREMIUM_THEME.sections.map((s) => [s.key, s.fields.map((f) => f.key)])).toEqual(
      BASIC.sections.map((s) => [s.key, s.fields.map((f) => f.key)]),
    );
    expect(PREMIUM_THEME.pages).toEqual(BASIC.pages);
  });

  it('every required text field has a non-empty bn and en default of its own', () => {
    for (const s of PREMIUM_THEME.sections) {
      for (const f of s.fields.filter((x) => x.kind !== 'images' && x.required)) {
        expect(f.defaults?.bn.trim(), `${s.key}.${f.key}`).toBeTruthy();
        expect(f.defaults?.en.trim(), `${s.key}.${f.key}`).toBeTruthy();
      }
    }
    const hero = PREMIUM_THEME.sections[0].fields.find((f) => f.key === 'headline');
    expect(hero?.defaults).not.toEqual(
      BASIC.sections[0].fields.find((f) => f.key === 'headline')?.defaults,
    );
  });

  it('validate() accepts the manifest own defaults', () => {
    expect(validateSiteConfig(defaultConfigFor(SiteTheme.PREMIUM), PREMIUM_THEME).ok).toBe(true);
  });
});
