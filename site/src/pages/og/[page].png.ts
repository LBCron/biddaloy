import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { SitePage } from '@biddaloy/shared';
import { t } from '../../i18n/t';
import { themeCss } from '../../lib/css-vars';
import { pick } from '../../lib/pick';
import { robotsFor, stripXmlControl } from '../../lib/seo';

const MAX = 200;
// ponytail: memory only, per process; move to Redis when OG traffic shows up.
const cache = new Map<string, Buffer>();

const esc = (s: string) => stripXmlControl(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const color = (v: string | undefined, fallback: string) =>
  v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;

/** 1200x630 card: palette background, school name, page title. No fetches: nothing user-controlled is loaded. */
export const GET: APIRoute = async ({ locals, params, url, rewrite }) => {
  const { site, host } = locals;
  const page = params.page as SitePage;
  const known =
    !!site &&
    robotsFor(site, !!(locals.preview || locals.previewToken)) !== 'noindex' &&
    Object.values(SitePage).includes(page) &&
    (page === SitePage.HOME || site.nav.some((n) => n.page === page));
  if (!known) return rewrite('/404/');

  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'bn';
  const name = (pick(site.schoolName, lang) ?? host).slice(0, 80);
  const title = page === SitePage.HOME ? '' : t(lang, `nav.${page}`);
  const key = [host, page, lang, site.theme, site.palette, name].join('|');
  let png = cache.get(key);
  if (png) {
    cache.delete(key); // re-insert below: Map order = recency
  } else {
    const vars = themeCss(site).vars;
    const bg = color(vars['--primary'], '#1a4fd6');
    const fg = color(vars['--surface'], '#ffffff');
    const font = 'Hind Siliguri, Inter, Noto Sans Bengali, sans-serif';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${bg}"/><text x="80" y="${title ? 300 : 340}" font-family="${font}" font-size="68" font-weight="700" fill="${fg}">${esc(name)}</text>${title ? `<text x="80" y="400" font-family="${font}" font-size="44" fill="${fg}" fill-opacity="0.85">${esc(title)}</text>` : ''}</svg>`;
    try {
      png = await sharp(Buffer.from(svg)).png().toBuffer();
    } catch {
      return rewrite('/404/'); // never a 500 for a card
    }
  }
  cache.set(key, png);
  if (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' },
  });
};
