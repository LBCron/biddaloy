import type { SitePage } from '@biddaloy/shared';
import { fetchByHost } from './api';
import type { SitePageData } from './types';

/**
 * The read every inner page starts with. `rewrite` is the error page to show: the same "no page"
 * template for a switched-off page as for an unknown site, and 503 when the API is down.
 * A header preview carries a demo home only, so an inner page has nothing to show there.
 */
export async function loadPage(
  locals: { host: string; preview?: string; previewToken?: string },
  page: SitePage,
): Promise<{ page: SitePageData; rewrite?: undefined } | { rewrite: '/404/' | '/503/' }> {
  if (locals.preview) return { rewrite: '/404/' };
  const r = await fetchByHost<SitePageData>(locals.host, `page/${page}`, {
    preview: locals.previewToken,
  });
  if (r.kind === 'ok') return { page: r.data };
  return { rewrite: r.kind === 'none' ? '/404/' : '/503/' };
}
