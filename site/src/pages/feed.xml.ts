import type { APIRoute } from 'astro';
import { SitePage } from '@biddaloy/shared';
import { blogRows, robotsFor, rssXml } from '../lib/seo';

export const GET: APIRoute = async ({ locals, url, rewrite }) => {
  const { site, host } = locals;
  const off = !site || robotsFor(site, !!(locals.preview || locals.previewToken)) === 'noindex';
  // No blog page (switched off, D12) is a 404 like an unknown host.
  if (off || !site.nav.some((n) => n.page === SitePage.BLOG)) return rewrite('/404/');
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'bn';
  return new Response(rssXml(host, lang, site, await blogRows(host, lang)), {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
