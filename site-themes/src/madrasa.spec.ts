import { SiteTheme } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import { BASIC } from './basic';
import { THEMES, defaultConfigFor, validateSiteConfig } from './index';
import { MADRASA_THEME } from './madrasa';

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

describe('madrasa manifest', () => {
  it('is registered under its own id with three palettes and two font pairs per language', () => {
    expect(THEMES[SiteTheme.MADRASA]).toBe(MADRASA_THEME);
    expect(MADRASA_THEME.palettes.map((p) => p.id)).toEqual([
      'forest-sand',
      'teal-ivory',
      'earth-olive',
    ]);
    expect(MADRASA_THEME.fonts.bn.length).toBeGreaterThanOrEqual(2);
    expect(MADRASA_THEME.fonts.en.length).toBeGreaterThanOrEqual(2);
  });

  for (const p of MADRASA_THEME.palettes) {
    it(`palette ${p.id} passes WCAG AA`, () => {
      const v = p.vars;
      for (const x of Object.values(v)) expect(x).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(v.ink, v.surface), 'ink on surface').toBeGreaterThanOrEqual(4.5);
      // primary carries the header, buttons (white text), links and headings on the surface.
      expect(contrast('#ffffff', v.primary), 'white on primary').toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.primary, v.surface), 'primary on surface').toBeGreaterThanOrEqual(4.5);
      // secondary is the band behind white text (footer, stripes); accent is rules and markers only, never text.
      expect(contrast('#ffffff', v.secondary), 'white on secondary').toBeGreaterThanOrEqual(4.5);
      // large display text (motto, section titles) in ink.
      expect(contrast(v.ink, v.surface), 'display').toBeGreaterThanOrEqual(3);
    });
  }

  it('default typography uses listed fonts and every font file is under madrasa/ or shared', () => {
    expect(MADRASA_THEME.fonts.bn.map((f) => f.id)).toContain(
      MADRASA_THEME.defaultTypography.bn.heading,
    );
    expect(MADRASA_THEME.fonts.bn.map((f) => f.id)).toContain(
      MADRASA_THEME.defaultTypography.bn.body,
    );
    expect(MADRASA_THEME.fonts.en.map((f) => f.id)).toContain(
      MADRASA_THEME.defaultTypography.en.heading,
    );
    expect(MADRASA_THEME.fonts.en.map((f) => f.id)).toContain(
      MADRASA_THEME.defaultTypography.en.body,
    );
    for (const f of [...MADRASA_THEME.fonts.bn, ...MADRASA_THEME.fonts.en])
      for (const file of f.files)
        expect(file).toMatch(/^(madrasa\/)?[a-z0-9-]+-\d{3}-(bengali|latin)\.woff2$/);
  });

  it('carries every section and field Basic has, so switching themes loses nothing (D25)', () => {
    expect(MADRASA_THEME.sections.map((s) => [s.key, s.fields.map((f) => f.key)])).toEqual(
      BASIC.sections.map((s) => [s.key, s.fields.map((f) => f.key)]),
    );
    expect(MADRASA_THEME.pages).toEqual(BASIC.pages);
  });

  it('every required text field has a non-empty bn and en default of its own', () => {
    for (const s of MADRASA_THEME.sections) {
      for (const f of s.fields.filter((x) => x.kind !== 'images' && x.required)) {
        expect(f.defaults?.bn.trim(), `${s.key}.${f.key}`).toBeTruthy();
        expect(f.defaults?.en.trim(), `${s.key}.${f.key}`).toBeTruthy();
      }
    }
    const hero = MADRASA_THEME.sections[0].fields.find((f) => f.key === 'headline');
    expect(hero?.defaults).not.toEqual(
      BASIC.sections[0].fields.find((f) => f.key === 'headline')?.defaults,
    );
  });

  it('validate() accepts the manifest own defaults', () => {
    expect(validateSiteConfig(defaultConfigFor(SiteTheme.MADRASA), MADRASA_THEME).ok).toBe(true);
  });
});
