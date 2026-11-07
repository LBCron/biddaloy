import { describe, expect, it } from 'vitest';

import { SiteMediaSlot } from '../enums/index';
import {
  RESERVED_SUBDOMAINS,
  SITE_GALLERY_CAPTION_MAX_CHARS,
  SITE_GALLERY_CAROUSEL_MAX,
  SITE_GALLERY_MAX_ALBUMS,
  SITE_GALLERY_MAX_PHOTOS_PER_ALBUM,
  SITE_MEDIA_QUOTA_BYTES,
  SITE_MEDIA_SLOT_PX,
  SITE_SUBDOMAIN_RE,
  isSiteRelativeHref,
} from './site';

describe('gallery constants', () => {
  it('slot is 1200x800, quota 100 MB, limits as decided (D46, D47)', () => {
    expect(SITE_MEDIA_SLOT_PX[SiteMediaSlot.GALLERY]).toEqual({ w: 1200, h: 800 });
    expect(SITE_MEDIA_QUOTA_BYTES).toBe(104857600);
    expect(SITE_GALLERY_MAX_ALBUMS).toBe(20);
    expect(SITE_GALLERY_MAX_PHOTOS_PER_ALBUM).toBe(60);
    expect(SITE_GALLERY_CAROUSEL_MAX).toBe(12);
    expect(SITE_GALLERY_CAPTION_MAX_CHARS).toBe(120);
  });
});

describe('SITE_SUBDOMAIN_RE', () => {
  it.each(['rumsc', 'rumsc-2026', 'abc', 'a'.repeat(30)])('accepts %s', (s) => {
    expect(SITE_SUBDOMAIN_RE.test(s)).toBe(true);
  });
  // 'a' and 'ab' are too short: the DB CHECK needs 3-30 chars.
  it.each(['a', '-a', 'a-', 'ab', 'a'.repeat(31), 'Rumsc', 'a_b', ''])('rejects %s', (s) => {
    expect(SITE_SUBDOMAIN_RE.test(s)).toBe(false);
  });
});

describe('RESERVED_SUBDOMAINS', () => {
  it('has no duplicates', () => {
    expect(new Set(RESERVED_SUBDOMAINS).size).toBe(RESERVED_SUBDOMAINS.length);
  });
  it('is made of valid labels or dotted fixed hosts', () => {
    for (const s of RESERVED_SUBDOMAINS) {
      expect(SITE_SUBDOMAIN_RE.test(s) || s.includes('.'), s).toBe(true);
    }
  });
});

describe('isSiteRelativeHref', () => {
  it('accepts a link on the same site', () => {
    expect(isSiteRelativeHref('/')).toBe(true);
    expect(isSiteRelativeHref('/notices')).toBe(true);
    expect(isSiteRelativeHref('/admission?class=6#form')).toBe(true);
  });

  // Each of these would send a visitor to another host or run script (XSS through the bar).
  it('refuses another host, a scheme, and tricks browsers undo', () => {
    expect(isSiteRelativeHref('//evil.com')).toBe(false);
    expect(isSiteRelativeHref('/\\evil.com')).toBe(false);
    expect(isSiteRelativeHref('/\t/evil.com')).toBe(false);
    expect(isSiteRelativeHref('/a b')).toBe(false);
    expect(isSiteRelativeHref('javascript:alert(1)')).toBe(false);
    expect(isSiteRelativeHref('https://evil.com')).toBe(false);
    expect(isSiteRelativeHref('notices')).toBe(false);
    expect(isSiteRelativeHref('')).toBe(false);
    expect(isSiteRelativeHref(42)).toBe(false);
    expect(isSiteRelativeHref('/' + 'a'.repeat(500))).toBe(false);
  });
});
