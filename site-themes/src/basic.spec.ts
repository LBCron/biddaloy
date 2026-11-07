import { SiteTheme } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import { BASIC } from './basic';
import { THEMES, defaultConfigFor, validateSiteConfig } from './index';

describe('basic manifest', () => {
  it('every required text field has a non-empty bn and en default', () => {
    for (const s of BASIC.sections) {
      for (const f of s.fields.filter((x) => x.kind !== 'images' && x.required)) {
        expect(f.defaults?.bn.trim(), `${s.key}.${f.key}`).toBeTruthy();
        expect(f.defaults?.en.trim(), `${s.key}.${f.key}`).toBeTruthy();
      }
    }
  });

  it('palette vars are six-digit hex', () => {
    for (const p of BASIC.palettes) {
      for (const v of Object.values(p.vars)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('default typography uses listed fonts', () => {
    expect(BASIC.fonts.bn.map((f) => f.id)).toContain(BASIC.defaultTypography.bn.body);
    expect(BASIC.fonts.en.map((f) => f.id)).toContain(BASIC.defaultTypography.en.body);
  });

  it('defaultConfigFor(BASIC) validates and has no empty bn text', () => {
    const cfg = defaultConfigFor(SiteTheme.BASIC);
    expect(validateSiteConfig(cfg, BASIC).ok).toBe(true);
    for (const p of cfg.pages) {
      for (const s of p.sections) {
        for (const v of Object.values(s.data)) expect((v as { bn: string }).bn.trim()).not.toBe('');
      }
    }
  });

  it('has an academics page with academics and routine, and optional contact links', () => {
    const cfg = defaultConfigFor(SiteTheme.BASIC);
    const academics = cfg.pages.find((p) => p.page === 'academics');
    expect(academics?.sections.map((s) => s.key)).toEqual(['academics', 'routine']);
    const contact = BASIC.sections.find((s) => s.key === 'contact')!;
    for (const k of ['lat', 'lng', 'whatsapp', 'facebook']) {
      expect(
        contact.fields.find((f) => f.key === k),
        k,
      ).toMatchObject({ required: false });
    }
  });

  it('a draft saved before the new fields still validates (the new fields are optional)', () => {
    const cfg = defaultConfigFor(SiteTheme.BASIC);
    const contact = cfg.pages.find((p) => p.page === 'contact')!.sections[0];
    expect(Object.keys(contact.data)).toEqual(['title', 'address']);
    expect(validateSiteConfig(cfg, BASIC).ok).toBe(true);
  });

  it('each stub has its own id and validates its own default config', () => {
    for (const id of Object.values(SiteTheme)) {
      expect(THEMES[id].id).toBe(id);
      expect(validateSiteConfig(defaultConfigFor(id), THEMES[id]).ok).toBe(true);
    }
  });
});
