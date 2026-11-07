import { SitePage } from '@biddaloy/shared';
import { fetchByHost } from './api';
import { httpsLink, plainValue, whatsappLink } from './contact';
import { pick } from './pick';
import { LANGS, type Lang, type SiteManifest, type SitePageData } from './types';

/** Everything here is pure over the by-host manifest, so it is unit-testable without a server. */

export const canonicalFor = (host: string, lang: Lang, rest = '') =>
  `https://${host}/${lang}/${rest}`;

/** bn + en + `x-default` = bn (D8). */
export const alternatesFor = (host: string, rest = '') => [
  ...LANGS.map((l) => ({ hreflang: l as string, href: canonicalFor(host, l, rest) })),
  { hreflang: 'x-default', href: canonicalFor(host, 'bn', rest) },
];

/** `noindex` when the school switched it on or the request is a preview (D33). */
export const robotsFor = (site: Pick<SiteManifest, 'noindex'>, isPreview: boolean) =>
  site.noindex || isPreview ? 'noindex' : 'index,follow';

/** XML 1.0 cannot carry these control characters, even escaped: strip them first. */
// eslint-disable-next-line no-control-regex
export const stripXmlControl = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

export function escapeXml(s: string): string {
  return stripXmlControl(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** JSON for a `<script type="application/ld+json">`: `<` and U+2028/9 escaped so no value can close the tag. */
export function jsonLdScript(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(new RegExp('[\u2028\u2029]', 'g'), (c) => '\\u' + c.charCodeAt(0).toString(16));
}

const clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));

export function jsonLdSchool(site: SiteManifest, host: string, lang: Lang) {
  const c = site.contact;
  const street = pick(c?.address, lang);
  const sameAs = [httpsLink(plainValue(c?.facebook)), whatsappLink(plainValue(c?.whatsapp))].filter(
    (x): x is string => !!x,
  );
  return clean({
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    name: pick(site.schoolName, lang),
    alternateName: pick(site.schoolName, lang === 'bn' ? 'en' : 'bn'),
    url: canonicalFor(host, lang),
    logo: site.logo?.startsWith('/')
      ? { '@type': 'ImageObject', url: `https://${host}${site.logo}` }
      : undefined,
    address: street
      ? { '@type': 'PostalAddress', streetAddress: street, addressCountry: 'BD' }
      : undefined,
    sameAs: sameAs.length ? sameAs : undefined,
    telephone: c?.phone,
    email: c?.email,
  });
}

export interface PostLd {
  title: string;
  url: string;
  publishedAt?: string;
  image?: string;
  excerpt?: string;
  author: string;
}

export const jsonLdPost = (p: PostLd) =>
  clean({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: p.title.slice(0, 110),
    mainEntityOfPage: p.url,
    datePublished: p.publishedAt,
    image: p.image,
    description: p.excerpt,
    author: { '@type': 'Organization', name: p.author },
  });

export const jsonLdBreadcrumbs = (crumbs: { name: string; url: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.name,
    item: c.url,
  })),
});

/** Paths (after the language prefix) of every enabled page; a switched-off page is not in `nav` (D12). */
export const pageRests = (site: Pick<SiteManifest, 'nav'>): string[] => [
  '',
  ...site.nav
    .filter((n) => n.page !== SitePage.HOME && ROUTED_PAGES.has(n.page))
    .map((n) => `${n.page}/`),
];

/** Pages that have a route in `site/src/pages/[lang]/`; a nav entry without one (results, until Epic 70) would 404 in the sitemap. */
export const ROUTED_PAGES: ReadonlySet<string> = new Set([
  SitePage.ABOUT,
  SitePage.ACADEMICS,
  SitePage.ADMISSIONS,
  SitePage.NEWS,
  SitePage.NOTICES,
  SitePage.BLOG,
  SitePage.TEACHERS,
  SitePage.CONTACT,
]);

/** First 155 characters, whitespace collapsed (search snippets cut there). */
export const metaDescription = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 155);

export function sitemapXml(host: string, rests: string[]): string {
  const urls = rests
    .map((rest) => {
      const links = alternatesFor(host, rest)
        .map(
          (a) =>
            `<xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${escapeXml(a.href)}"/>`,
        )
        .join('');
      return LANGS.map(
        (l) => `<url><loc>${escapeXml(canonicalFor(host, l, rest))}</loc>${links}</url>`,
      ).join('');
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>\n`;
}

export const robotsTxt = (host: string, indexable: boolean) =>
  indexable
    ? `User-agent: *\nAllow: /\nDisallow: /?preview=\nSitemap: https://${host}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';

export interface BlogRow {
  slug: string;
  title: string;
  publishedAt?: string;
  excerpt?: string;
}

/** The newest posts as the blog page feed carries them (12); ponytail: older posts join when a list feed is paged. */
export async function blogRows(host: string, lang: Lang, token?: string): Promise<BlogRow[]> {
  const r = await fetchByHost<SitePageData>(host, `page/${SitePage.BLOG}`, { preview: token });
  if (r.kind !== 'ok') return [];
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return r.data.sections
    .filter((sec) => sec.enabled !== false && !sec.empty)
    .flatMap((sec) => sec.feed ?? [])
    .flatMap((row) => {
      const slug = s(row.slug);
      if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return [];
      const t = row.title as Record<string, string> | string | undefined;
      const title = (typeof t === 'string' ? t : lang === 'en' && t?.en ? t.en : t?.bn) ?? slug;
      return [{ slug, title, publishedAt: s(row.publishedAt), excerpt: s(row.excerpt) }];
    });
}

export function rssXml(host: string, lang: Lang, site: SiteManifest, posts: BlogRow[]): string {
  const name = pick(site.schoolName, lang) ?? host;
  const items = posts
    .slice(0, 50)
    .map((p) => {
      const url = canonicalFor(host, lang, `blog/${p.slug}/`);
      const date = p.publishedAt ? new Date(p.publishedAt) : undefined;
      return (
        `<item><title>${escapeXml(p.title)}</title><link>${escapeXml(url)}</link>` +
        `<guid isPermaLink="true">${escapeXml(url)}</guid>` +
        (date && !Number.isNaN(date.getTime()) ? `<pubDate>${date.toUTCString()}</pubDate>` : '') +
        (p.excerpt ? `<description>${escapeXml(p.excerpt)}</description>` : '') +
        `</item>`
      );
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escapeXml(name)}</title><link>${escapeXml(canonicalFor(host, lang))}</link><description>${escapeXml(name)}</description><language>${lang}</language>${items}</channel></rss>\n`;
}

const one = (s: string) => s.replace(/\s+/g, ' ').trim();

export function llmsTxt(host: string, site: SiteManifest, posts: BlogRow[]): string {
  const name = pick(site.schoolName, 'en') ?? pick(site.schoolName, 'bn') ?? host;
  const about = pick(site.contact?.address, 'en') ?? '';
  const pages = pageRests(site).map((r) => `- ${canonicalFor(host, 'en', r)}`);
  const recent = posts
    .slice(0, 10)
    .map((p) => `- ${one(p.title)}: ${canonicalFor(host, 'en', `blog/${p.slug}/`)}`);
  return [
    `# ${one(name)}`,
    '',
    `> Official website of ${name}${about ? `, ${about}` : ''}. Pages are in Bangla (/bn/) and English (/en/).`,
    '',
    '## Pages',
    ...pages,
    ...(recent.length ? ['', '## Recent posts', ...recent] : []),
    '',
  ].join('\n');
}
