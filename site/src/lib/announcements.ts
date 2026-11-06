import { isSiteRelativeHref } from '@biddaloy/shared';
import { pick } from './pick';
import type { Lang, SiteManifest } from './types';

export interface BarItem {
  text: string;
  href?: string;
}

/**
 * Enabled items inside their date window, with text. A link is kept only when it stays on this
 * site (same rule as the server validator), so a bad row that slipped past it never renders
 * as `<a href="javascript:...">` or a link to another host.
 */
export function barItems(
  bar: SiteManifest['announcements'] | undefined,
  lang: Lang,
  now: number,
): BarItem[] {
  const out: BarItem[] = [];
  for (const i of bar?.items ?? []) {
    if (!i.enabled) continue;
    if (i.from && Date.parse(i.from) > now) continue;
    if (i.until && Date.parse(i.until) < now) continue;
    const text = pick(i.text, lang);
    if (!text) continue;
    out.push(isSiteRelativeHref(i.href) ? { text, href: i.href } : { text });
  }
  return out;
}
