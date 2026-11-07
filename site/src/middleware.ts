import { defineMiddleware } from 'astro:middleware';
import { SitePage, SiteTheme } from '@biddaloy/shared';
import { defaultConfigFor, THEMES } from '@biddaloy/site-themes';
import { fetchByHost } from './lib/api';
import { LANGS, type Lang, type SiteManifest, type SitePageData } from './lib/types';

const PREVIEW_HEADER = () => (process.env.SITE_PREVIEW_HEADER ?? 'X-Site-Preview').toLowerCase();

/** Preview content comes from the theme's own defaults (D33). */
function demoFor(theme: SiteTheme): { site: SiteManifest; home: SitePageData } | undefined {
  const m = THEMES[theme];
  if (!m) return undefined;
  const cfg = defaultConfigFor(theme);
  const home = cfg.pages.find((p) => p.page === SitePage.HOME);
  return {
    site: {
      theme,
      palette: cfg.palette,
      typography: cfg.typography,
      announcements: cfg.announcements,
      nav: cfg.pages.filter((p) => p.enabled).map((p) => ({ page: p.page })),
      noindex: true,
      schoolName: m.name,
    },
    home: { page: SitePage.HOME, sections: home?.sections ?? [] },
  };
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname, search } = ctx.url;
  if (pathname === '/healthz' || pathname === '/healthz/') return new Response('ok');
  if (pathname.startsWith('/_api/') || pathname.startsWith('/_astro/')) return next();

  const host = (ctx.request.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase();
  const seg = pathname.split('/')[1];
  const lang: Lang = seg === 'en' ? 'en' : 'bn';
  ctx.locals.host = host;
  ctx.locals.lang = lang;

  // The error pages are rendered by rewrite below; do not look the site up again.
  if (pathname === '/404/' || pathname === '/503/') return next();

  if (pathname === '/') return ctx.redirect('/bn/', 302);

  const previewTheme = ctx.request.headers.get(PREVIEW_HEADER()) ?? undefined;
  let res: Response;
  if (previewTheme) {
    const demo = demoFor(previewTheme as SiteTheme);
    if (!demo) return withNoindex(await next('/404/'));
    ctx.locals.preview = previewTheme;
    ctx.locals.site = demo.site;
    ctx.locals.previewHome = demo.home;
    // Only robots.txt answers in a preview (Disallow: /); sitemap, feed, cards are a 404 there.
    res =
      LANGS.includes(seg as Lang) || pathname === '/robots.txt'
        ? await next()
        : await next('/404/');
    return withNoindex(res);
  }

  const token = ctx.url.searchParams.get('preview') ?? undefined;
  ctx.locals.previewToken = token;
  const r = await fetchByHost<SiteManifest>(host, 'manifest', { preview: token });
  if (r.kind === 'redirect') return Response.redirect(`https://${r.to}${pathname}${search}`, 301);
  if (r.kind === 'none') return next('/404/');
  if (r.kind === 'down') return next('/503/');
  ctx.locals.site = r.data;
  if (!LANGS.includes(seg as Lang) && !SEO_FILES.has(seg)) return next('/404/');
  return next();
});

/** Root files of a school site (#3645); they answer only for a resolved host, so an unknown host gets the page 404. */
const SEO_FILES = new Set(['sitemap.xml', 'robots.txt', 'feed.xml', 'llms.txt', 'og']);

function withNoindex(res: Response): Response {
  res.headers.set('X-Robots-Tag', 'noindex');
  return res;
}
