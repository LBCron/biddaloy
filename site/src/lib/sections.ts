import type { SitePageData } from './types';

type Row = SitePageData['sections'][number];

/**
 * The sections a page shows, in the admin's order (D31), minus switched-off ones and system-fed
 * ones with nothing to show (D12, D25). `hero` is pinned first and a `footer` section (if a
 * theme ever lists one) last; a key listed twice shows once, at its first place.
 */
export function orderSections(page: Pick<SitePageData, 'sections'>, skip: string[] = []): Row[] {
  const seen = new Set<string>();
  const rows = page.sections.filter((s) => {
    if (s.enabled === false || s.empty || skip.includes(s.key) || seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });
  const rank = (s: Row) =>
    (s.key as string) === 'hero' ? 0 : (s.key as string) === 'footer' ? 2 : 1;
  // Array.sort is stable, so the admin's order holds inside each rank.
  return [...rows].sort((a, b) => rank(a) - rank(b));
}
