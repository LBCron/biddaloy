import type { APIRoute } from 'astro';
import { robotsFor, robotsTxt } from '../lib/seo';

export const GET: APIRoute = ({ locals, rewrite }) => {
  const { site, host } = locals;
  if (!site) return rewrite('/404/');
  const indexable = robotsFor(site, !!(locals.preview || locals.previewToken)) !== 'noindex';
  return new Response(robotsTxt(host, indexable), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
