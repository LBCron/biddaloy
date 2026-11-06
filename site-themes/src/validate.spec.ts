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
});
