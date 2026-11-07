import { SiteTheme } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import { BASIC } from './basic';
import { defaultConfigFor, validateSiteConfig } from './index';

const fresh = () => structuredClone(defaultConfigFor(SiteTheme.BASIC)) as any;
const errorsOf = (cfg: unknown) => {
  const r = validateSiteConfig(cfg, BASIC);
  return r.ok ? [] : r.errors;
};

describe('validateSiteConfig', () => {
  it('rejects an unknown palette without echoing it', () => {
    const c = fresh();
    c.palette = 'SECRET-PALETTE';
    const e = errorsOf(c);
    expect(e).toContain('palette.unknown');
    expect(JSON.stringify(e)).not.toContain('SECRET');
  });

  it('rejects a font id from the wrong language list', () => {
    const c = fresh();
    c.typography.bn.body = 'inter';
    expect(errorsOf(c)).toContain('font.unknown');
  });

  it('rejects home when hero is not first', () => {
    const c = fresh();
    c.pages[0].sections.reverse();
    expect(errorsOf(c)).toContain('hero.notFirst');
  });

  it('rejects 6 hero photos', () => {
    const c = fresh();
    c.pages[0].sections[0].data.images = ['1', '2', '3', '4', '5', '6'];
    expect(errorsOf(c)).toContain('images.tooMany');
  });

  it('rejects over-long text without echoing it', () => {
    const c = fresh();
    c.pages[0].sections[0].data.headline = { bn: 'x'.repeat(2001), en: 'ok' };
    const e = errorsOf(c);
    expect(e).toContain('text.tooLong');
    expect(JSON.stringify(e)).not.toContain('xxxx');
  });

  it('rejects too many announcements', () => {
    const c = fresh();
    c.announcements.items = Array.from({ length: 6 }, () => ({}));
    expect(errorsOf(c)).toContain('announcements.tooMany');
  });

  it('accepts the shipped defaults', () => {
    expect(validateSiteConfig(fresh(), BASIC).ok).toBe(true);
  });

  const item = (href: unknown) => ({ id: 'a1', text: { bn: 'ক', en: 'a' }, href, enabled: true });

  it('keeps a site-relative announcement link', () => {
    const c = fresh();
    c.announcements.items = [item('/notices')];
    const r = validateSiteConfig(c, BASIC);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.announcements.items[0].href).toBe('/notices');
  });

  // An off-site or script link in the bar is an open redirect or XSS on every page.
  it('rejects javascript:, protocol-relative and absolute announcement links', () => {
    for (const href of ['javascript:alert(1)', '//evil.com', 'https://evil.com']) {
      const c = fresh();
      c.announcements.items = [item(href)];
      const e = errorsOf(c);
      expect(e).toContain('href.invalid');
      expect(JSON.stringify(e)).not.toContain('evil');
    }
  });

  it('rejects a broken announcement date and drops unknown item keys', () => {
    const c = fresh();
    c.announcements.items = [{ ...item(undefined), from: 'soon' }];
    expect(errorsOf(c)).toContain('date.invalid');
    c.announcements.items = [{ ...item(undefined), onclick: 'x' }];
    const r = validateSiteConfig(c, BASIC);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.announcements.items[0]).not.toHaveProperty('onclick');
  });

  it('drops unknown keys', () => {
    const c = fresh();
    c.pages[0].sections[0].data.bogus = { bn: 'a', en: 'b' };
    const r = validateSiteConfig(c, BASIC);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pages[0].sections[0].data).not.toHaveProperty('bogus');
  });

  it('rejects a non-object', () => {
    expect(errorsOf('nope')).toEqual(['config.invalid']);
  });

  const sectionData = (c: any, key: string) =>
    c.pages[0].sections.find((s: any) => s.key === key).data;

  it('gallery: keeps null or a UUID albumId, rejects anything else without echoing it', () => {
    const c = fresh();
    sectionData(c, 'gallery').albumId = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
    expect(validateSiteConfig(c, BASIC).ok).toBe(true);
    sectionData(c, 'gallery').albumId = 'NOT-A-UUID-SECRET';
    const e = errorsOf(c);
    expect(e).toContain('field.invalid');
    expect(JSON.stringify(e)).not.toContain('SECRET');
    sectionData(c, 'gallery').albumId = null;
    sectionData(c, 'gallery').showPageLink = 'yes';
    expect(errorsOf(c)).toContain('field.invalid');
  });

  it('gallery: drops unknown keys', () => {
    const c = fresh();
    sectionData(c, 'gallery').bogus = 'x';
    const r = validateSiteConfig(c, BASIC);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const g = r.value.pages[0].sections.find((s) => s.key === 'gallery')!;
      expect(g.data).not.toHaveProperty('bogus');
    }
  });

  it('video: rejects a wrong-length videoId, a bad position and bad seconds', () => {
    const c = fresh();
    sectionData(c, 'video').videoId = 'dQw4w9WgXc';
    expect(errorsOf(c)).toContain('field.invalid');
    sectionData(c, 'video').videoId = '<script>alert(1)</script>';
    const e = errorsOf(c);
    expect(JSON.stringify(e)).not.toContain('script');
    sectionData(c, 'video').videoId = 'dQw4w9WgXcQ';
    sectionData(c, 'video').headingPosition = 'left';
    expect(errorsOf(c)).toContain('field.invalid');
    sectionData(c, 'video').headingPosition = 'below';
    sectionData(c, 'video').startSeconds = 86401;
    expect(errorsOf(c)).toContain('field.invalid');
    sectionData(c, 'video').startSeconds = 90;
    expect(validateSiteConfig(c, BASIC).ok).toBe(true);
  });
});
