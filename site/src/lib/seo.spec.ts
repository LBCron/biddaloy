import { SitePage } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import {
  alternatesFor,
  canonicalFor,
  escapeXml,
  jsonLdBreadcrumbs,
  jsonLdPost,
  jsonLdSchool,
  jsonLdScript,
  llmsTxt,
  pageRests,
  robotsFor,
  robotsTxt,
  rssXml,
  sitemapXml,
} from './seo';
import type { SiteManifest } from './types';

const site = {
  nav: [{ page: SitePage.ABOUT }, { page: SitePage.BLOG }],
  schoolName: { bn: 'নবীনগর', en: 'Nabinagar <High>' },
  contact: { phone: '0171', address: { bn: 'ঢাকা' } },
} as unknown as SiteManifest;

describe('seo', () => {
  it('canonical and alternates: bn, en, x-default = bn', () => {
    expect(canonicalFor('a.test', 'en', 'about/')).toBe('https://a.test/en/about/');
    expect(alternatesFor('a.test', 'about/')).toEqual([
      { hreflang: 'bn', href: 'https://a.test/bn/about/' },
      { hreflang: 'en', href: 'https://a.test/en/about/' },
      { hreflang: 'x-default', href: 'https://a.test/bn/about/' },
    ]);
  });

  it('robots matrix: noindex x preview', () => {
    expect(robotsFor({ noindex: false }, false)).toBe('index,follow');
    expect(robotsFor({ noindex: true }, false)).toBe('noindex');
    expect(robotsFor({ noindex: false }, true)).toBe('noindex');
    expect(robotsFor({}, false)).toBe('index,follow');
    expect(robotsTxt('a.test', false)).toBe('User-agent: *\nDisallow: /\n');
    expect(robotsTxt('a.test', true)).toContain('Sitemap: https://a.test/sitemap.xml');
  });

  it('json-ld omits empty fields and never lets a value close the script tag', () => {
    const ld = jsonLdSchool(site, 'a.test', 'en');
    expect(ld['@type']).toBe('EducationalOrganization');
    expect(ld).not.toHaveProperty('email');
    expect(ld).not.toHaveProperty('logo');
    const out = jsonLdScript(
      jsonLdPost({ title: '</script><script>x</script> ', url: 'u', author: 'a' }),
    );
    expect(out).not.toContain('<');
    expect(out).not.toContain(' ');
    expect(JSON.parse(out).headline).toContain('</script>');
    expect(jsonLdBreadcrumbs([{ name: 'a', url: 'u' }]).itemListElement[0].position).toBe(1);
  });

  it('a switched-off page is in no output (nav is the enabled list)', () => {
    const s = { ...site, nav: [{ page: SitePage.ABOUT }] } as unknown as SiteManifest;
    expect(pageRests(s)).toEqual(['', 'about/']);
    expect(sitemapXml('a.test', pageRests(s))).not.toContain('blog');
    expect(llmsTxt('a.test', s, [])).not.toContain('blog');
  });

  it('sitemap pairs every url with bn/en/x-default alternates', () => {
    const xml = sitemapXml('a.test', pageRests(site));
    expect(xml).toContain('<loc>https://a.test/bn/</loc>');
    expect(xml).toContain('<loc>https://a.test/en/about/</loc>');
    expect(xml).toContain('hreflang="x-default" href="https://a.test/bn/about/"');
  });

  it('xml is escaped in rss', () => {
    expect(escapeXml(`<a&"'>`)).toBe('&#60;a&#38;&#34;&#39;&#62;');
    const rss = rssXml('a.test', 'en', site, [
      { slug: 'p', title: '<b>&', publishedAt: '2026-01-02T00:00:00Z' },
    ]);
    expect(rss).toContain('<title>&#60;b&#62;&#38;</title>');
    expect(rss).toContain('Nabinagar &#60;High&#62;');
    expect(rss).toContain('<pubDate>Fri, 02 Jan 2026');
  });
});
