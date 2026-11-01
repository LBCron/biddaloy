/**
 * [8.15.26] The shapes the report renderers read. The server's run result is not typed in
 * `api/schema.d.ts`, so they are written here, once, for every renderer.
 *
 * Plain words for the glossary (docs/ux-research/8.15-reports-glossary.md): a `dimension` column is
 * what a row is "split by", a `measure` column is a count or an amount. Those two words never reach
 * a screen; they are only the server's field names.
 */
import type { ReportLayout } from '@biddaloy/shared';

export type ReportColumnType =
  'TEXT' | 'NUMBER' | 'MONEY' | 'PERCENT' | 'DATE' | 'ENUM' | 'BOOLEAN';

export interface ReportColumn {
  key: string;
  label_en: string;
  label_bn: string;
  type: ReportColumnType;
  /** `dimension`: a label a row is split by. `measure`: a count or an amount. */
  kind: 'dimension' | 'measure';
}

/** Dates arrive as `YYYY-MM-DD` strings, numbers as numbers. A count hidden from a COMMITTEE member is `null`. */
export type ReportRow = Record<string, unknown>;

export interface ReportRunResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Keys of fields the runner hid from this viewer. */
  masked: string[];
  /** True when at least one small count was hidden for privacy (D14). */
  suppressed: boolean;
  /** True when the row cap cut the result short (D20). */
  truncated: boolean;
  total_rows: number;
  page: number;
  page_size: number;
  total_pages: number;
  run_id: string;
}

/** The layout hints a renderer needs, straight from the report definition. */
export type ReportLayoutProps = Pick<
  ReportLayout,
  'group_by' | 'subtotals' | 'totals' | 'rows' | 'columns' | 'cell_measure' | 'chart'
>;

/** `auto` picks cards below 768 px of the component's own width, like `DataTable`. */
export type ReportViewMode = 'auto' | 'table' | 'cards';
