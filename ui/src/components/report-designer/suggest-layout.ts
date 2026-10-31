/**
 * [8.15.39] Picks the layout that fits what a person chose in the field picker, and says why.
 * Pure: no words live here. The reason is a code; the screen turns it into a sentence from the
 * glossary (`designer.layout.reason.*` in `reports.json`).
 *
 * ```
 *  split by          count / add up     layout                reason code
 *  nothing           anything           TABLE                 noSplit
 *  something         nothing            TABLE                 noCount
 *  one date          one or more        CHART (line)          dateSplit
 *  one other         one or more        GROUPED + subtotals   oneSplit
 *  two               exactly one        CROSSTAB              twoSplits
 *  two               two or more        GROUPED               twoSplitsManyCounts
 *  three or more     one or more        GROUPED               manySplits
 * ```
 *
 * A table of counts (CROSSTAB) shows one number per cell, so two splits with several counts fall
 * back to the grouped list instead of hiding a count.
 */
import type { ReportLayout, ReportLayoutType } from '@biddaloy/shared';

/** What the person picked. Keys are the registry's field and measure keys from `GET /reports/meta`. */
export interface LayoutPicks {
  /** Fields under "split by", in the order chosen. `isDate` is true for a DATE field. */
  splitBy: { key: string; isDate: boolean }[];
  /** Keys of the measures under "count / add up". */
  counts: string[];
}

export type LayoutReason =
  | 'noSplit'
  | 'noCount'
  | 'dateSplit'
  | 'oneSplit'
  | 'twoSplits'
  | 'twoSplitsManyCounts'
  | 'manySplits';

export interface LayoutSuggestion {
  layout: ReportLayoutType;
  reason: LayoutReason;
}

export function suggestLayout(picks: LayoutPicks): LayoutSuggestion {
  const { splitBy, counts } = picks;
  if (splitBy.length === 0) return { layout: 'TABLE', reason: 'noSplit' };
  if (counts.length === 0) return { layout: 'TABLE', reason: 'noCount' };
  if (splitBy.length === 1) {
    return splitBy[0]!.isDate
      ? { layout: 'CHART', reason: 'dateSplit' }
      : { layout: 'GROUPED', reason: 'oneSplit' };
  }
  if (splitBy.length === 2) {
    return counts.length === 1
      ? { layout: 'CROSSTAB', reason: 'twoSplits' }
      : { layout: 'GROUPED', reason: 'twoSplitsManyCounts' };
  }
  return { layout: 'GROUPED', reason: 'manySplits' };
}

/**
 * The definition's `layout` for a chosen type. A manual choice is always allowed, so this adapts
 * to what is picked instead of refusing: a table of counts with one split uses it as the rows, a
 * chart with no date split plots the first split.
 */
export function buildLayout(type: ReportLayoutType, picks: LayoutPicks): ReportLayout {
  const keys = picks.splitBy.map((s) => s.key);
  switch (type) {
    case 'TABLE':
      return { type, totals: false };
    case 'GROUPED':
      return { type, group_by: keys, subtotals: true, totals: true };
    case 'CROSSTAB':
      return {
        type,
        rows: keys.slice(0, 1),
        columns: keys.slice(1, 2),
        ...(picks.counts[0] ? { cell_measure: picks.counts[0] } : {}),
        totals: true,
      };
    case 'CHART':
      return {
        type,
        chart: {
          kind: picks.splitBy[0]?.isDate ? 'line' : 'bar',
          x: keys[0] ?? '',
          y: picks.counts,
        },
      };
  }
}
