import type { APIRoute } from 'astro';
import { SitePage } from '@biddaloy/shared';
import { blogRows, llmsTxt, robotsFor } from '../lib/seo';

export const GET: APIRoute = async ({ locals, rewrite }) => {
  const { site, host } = locals;
  if (!site || robotsFor(site, !!(locals.preview || locals.previewToken)) === 'noindex') {
    return rewrite('/404/');
  }
  const posts = site.nav.some((n) => n.page === SitePage.BLOG) ? await blogRows(host, 'en') : [];
  return new Response(llmsTxt(host, site, posts), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
