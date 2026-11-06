import { isSiteRelativeHref } from '@biddaloy/shared';
import { pick } from './pick';
import { LANGS, type Lang, type SiteManifest } from './types';

export interface BarItem {
  text: string;
  href?: string;
}

/**
 * `/admissions` → `/bn/admissions`. The site answers 404 for any path whose first segment is not
 * a language (middleware.ts), but schools and the validator write plain site paths. A path that
 * already starts with `/bn` or `/en` is kept as it is.
 */
export function withLang(href: string, lang: Lang): string {
  const seg = href.slice(1).split(/[/?#]/)[0];
  return (LANGS as readonly string[]).includes(seg) ? href : `/${lang}${href}`;
}

/**
 * Enabled items with text. The date window is not checked here: the server already applies it
 * per request in Asia/Dhaka days (`inWindow`, page-read-model.ts); a second check here read bare
 * dates as UTC and hid an item 6 hours early (#3621 gate). A link is kept only when it stays on
 * this site (same rule as the server validator), so a bad row that slipped past it never renders
 * as `<a href="javascript:...">` or a link to another host.
 */
export function barItems(bar: SiteManifest['announcements'] | undefined, lang: Lang): BarItem[] {
  const out: BarItem[] = [];
  for (const i of bar?.items ?? []) {
    if (!i.enabled) continue;
    const text = pick(i.text, lang);
    if (!text) continue;
    out.push(isSiteRelativeHref(i.href) ? { text, href: withLang(i.href, lang) } : { text });
  }
  return out;
}
