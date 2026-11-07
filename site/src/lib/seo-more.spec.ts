import { SitePage } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import {
  escapeXml,
  jsonLdSchool,
  llmsTxt,
  metaDescription,
  pageRests,
  robotsTxt,
  sitemapXml,
} from './seo';
import type { SiteManifest } from './types';

const base = {
  nav: [{ page: SitePage.ABOUT }],
  schoolName: { bn: 'ক', en: 'Nabinagar' },
} as unknown as SiteManifest;

describe('seo (review fixes)', () => {
  it('lists only pages that have a route: results never reaches the sitemap', () => {
    const s = { ...base, nav: [{ page: SitePage.ABOUT }, { page: SitePage.RESULTS }] };
    expect(pageRests(s as SiteManifest)).toEqual(['', 'about/']);
    expect(sitemapXml('a.test', pageRests(s as SiteManifest))).not.toContain('results');
  });

  it('indexable robots.txt always blocks ?preview=', () => {
    expect(robotsTxt('a.test', true)).toContain('Disallow: /?preview=');
  });

  it('strips XML-illegal control characters', () => {
    expect(escapeXml('a\u0000b\u000bc\u001fd\te')).toBe('abcd\te');
  });

  it('caps the description at 155 characters, whitespace collapsed', () => {
    expect(metaDescription('x'.repeat(300))).toHaveLength(155);
    expect(metaDescription('a \n  b')).toBe('a b');
  });

  it('school JSON-LD: PostalAddress, ImageObject logo, https-only sameAs', () => {
    const site = {
      ...base,
      logo: '/media/abc',
      contact: {
        address: { bn: 'ঢাকা', en: 'Dhaka' },
        facebook: 'https://facebook.com/x',
        whatsapp: 'javascript:alert(1)',
      },
    } as unknown as SiteManifest;
    const ld = jsonLdSchool(site, 'a.test', 'en') as Record<string, unknown>;
    expect(ld.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Dhaka',
      addressCountry: 'BD',
    });
    expect(ld.logo).toEqual({ '@type': 'ImageObject', url: 'https://a.test/media/abc' });
    expect(ld.sameAs).toEqual(['https://facebook.com/x']);
  });

  it('llms.txt collapses whitespace in the name', () => {
    const s = { ...base, schoolName: { bn: 'ক', en: 'A\n# injected' } } as unknown as SiteManifest;
    expect(llmsTxt('a.test', s, [])).toContain('# A # injected');
  });
});
