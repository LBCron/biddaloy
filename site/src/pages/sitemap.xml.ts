import type { APIRoute } from 'astro';
import { SitePage } from '@biddaloy/shared';
import { blogRows, pageRests, robotsFor, sitemapXml } from '../lib/seo';

export const GET: APIRoute = async ({ locals, rewrite }) => {
  const { site, host } = locals;
  // Same 404 body as an unknown host; a noindex or preview site lists nothing.
  if (!site || robotsFor(site, !!(locals.preview || locals.previewToken)) === 'noindex') {
    return rewrite('/404/');
  }
  const rests = pageRests(site);
  if (site.nav.some((n) => n.page === SitePage.BLOG)) {
    rests.push(...(await blogRows(host, 'bn')).map((p) => `blog/${p.slug}/`));
  }
  return new Response(sitemapXml(host, rests), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
