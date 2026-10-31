/**
 * [8.15.27] The "table of counts" (glossary: ছক): rows down the side, columns across the top, a
 * "মোট" at the end of every row and column. One or two fields can name the columns (for example
 * gender, then religion), which gives a two-level header.
 *
 * Wide tables are hard on a phone, so a table that would not fit its box opens as a plain list
 * instead ("৬ষ্ঠ শ্রেণি — ছাত্র ৪০, ছাত্রী ৩৮, মোট ৭৮") with a "ছক হিসেবে দেখুন" switch. Nobody has to
 * scroll a grid sideways unless they ask for it.
 *
 * The sums come from `pivot.ts`; a total that includes a count hidden for privacy is shown hidden
 * (see there). Not exported from `index.ts`: `[8.15.29]` imports it by path.
 */
import * as React from 'react';

import { useContainerWidth } from '../../hooks/use-container-width';
import { useLocale, useRegionConfig, useTranslation, type RegionConfig } from '../../i18n';
import { cn } from '../../primitives/lib/utils';
import { Button } from '../button';
import { EmptyState } from '../empty-state';

import type { DrillLinks, DrillTarget, ReportDrilling } from './drill';
import {
  formatCell,
  columnLabel,
  isAdditiveType,
  toneFor,
  type AddedUp,
  type CellWords,
  type FormatTone,
  type ReportFormatting,
} from './format-cell';
import { pivot, type PivotColNode, type PivotKey } from './pivot';
import { DrillLink, HiddenCellMark, ToneMark } from './report-table';
import type { ReportColumn, ReportLayoutProps, ReportRunResult } from './types';

/** Rough widths, in px, used only to decide whether the table fits its box. */
const FIRST_COLUMN_WIDTH = 128;
const LEAF_COLUMN_WIDTH = 80;
const NARROW_MAX_WIDTH = 767;
const SEPARATOR = ' › ';

type ReportCrosstabView = 'auto' | 'table' | 'list';

export interface ReportCrosstabProps {
  result: ReportRunResult;
  layout: ReportLayoutProps;
  caption?: string;
  /** `auto` shows the list when the table would not fit; `table` / `list` force one. */
  view?: ReportCrosstabView;
  /** Colour rules ([8.15.42]): a count that meets one is coloured, with an icon and a word. */
  format?: ReportFormatting;
  /** Counts that open the list of those people ([8.15.42]); hidden counts never do. */
  drill?: ReportDrilling;
}

function useFormat() {
  const { t } = useTranslation('reportView');
  const config = useRegionConfig();
  const words: CellWords = { yes: t('yes'), no: t('no') };
  return (value: unknown, column: ReportColumn | undefined) =>
    formatCell(value, column?.type ?? 'TEXT', config, words);
}

/** What a number cell shows: the number, a hidden dash, or a plain 0 where nothing was counted. */
function MatrixCell({
  total,
  measure,
  suppressed,
  config,
  tone,
  link,
}: {
  total: AddedUp | undefined;
  measure: ReportColumn;
  suppressed: boolean;
  config: RegionConfig;
  tone?: { tone: FormatTone; label: string } | undefined;
  link?: { links: DrillLinks; target: DrillTarget; what: string } | undefined;
}) {
  // A hidden count is a dash: no colour, and no link (opening the list would show who is hidden).
  if (total?.incomplete && suppressed) return <HiddenCellMark />;
  const text = matrixText(total, measure, suppressed, config);
  let content: React.ReactNode = text;
  if (tone) {
    content = (
      <ToneMark tone={tone.tone} label={tone.label}>
        {content}
      </ToneMark>
    );
  }
  // A cell nobody was counted in (0) has nobody to list.
  if (link && total && total.value !== null && total.value > 0) {
    content = (
      <DrillLink
        href={link.links.href(link.target)}
        label={link.links.label(link.what, text)}
        onOpen={() => link.links.open(link.target)}
      >
        {content}
      </DrillLink>
    );
  }
  return <>{content}</>;
}

export function ReportCrosstab({
  result,
  layout,
  caption,
  view = 'auto',
  format: formatting,
  drill,
}: ReportCrosstabProps) {
  const { t } = useTranslation('reportView');
  const { locale } = useLocale();
  const config = useRegionConfig();
  const format = useFormat();
  const { columns, rows, suppressed } = result;
  const name = caption ?? t('crosstab.caption');

  const byKey = (key: string) => columns.find((c) => c.key === key);
  const rowCols = (layout.rows ?? []).map(byKey).filter((c): c is ReportColumn => !!c);
  const colCols = (layout.columns ?? []).map(byKey).filter((c): c is ReportColumn => !!c);
  const measure =
    (layout.cell_measure ? byKey(layout.cell_measure) : undefined) ??
    columns.find((c) => c.kind === 'measure') ??
    columns[columns.length - 1];
  const showTotals = measure !== undefined && isAdditiveType(measure.type);

  const matrix = React.useMemo(
    () =>
      measure
        ? pivot(rows, {
            rows: rowCols.map((c) => c.key),
            columns: colCols.map((c) => c.key),
            measure: measure.key,
            type: measure.type,
          })
        : null,
    // The column lists are derived from `columns` + `layout`; those are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, columns, layout.rows, layout.columns, layout.cell_measure],
  );

  const containerRef = React.useRef<HTMLDivElement>(null);
  const measured = useContainerWidth(containerRef);
  const [narrowGuess] = React.useState(
    () =>
      typeof matchMedia === 'function' && matchMedia(`(max-width: ${NARROW_MAX_WIDTH}px)`).matches,
  );
  const [chosen, setChosen] = React.useState<'table' | 'list' | null>(null);

  if (!measure || !matrix || rows.length === 0) {
    return (
      <div ref={containerRef}>
        <EmptyState
          kind="no-results"
          title={t('empty.title')}
          explanation={t('empty.explanation')}
        />
      </div>
    );
  }

  const needed =
    FIRST_COLUMN_WIDTH + (matrix.leaves.length + (showTotals ? 1 : 0)) * LEAF_COLUMN_WIDTH;
  const wontFit = measured !== null ? measured < needed : narrowGuess;
  const shown: 'table' | 'list' = view !== 'auto' ? view : (chosen ?? (wontFit ? 'list' : 'table'));

  const rowLabel = (key: PivotKey) =>
    key.parts.map((v, i) => format(v, rowCols[i])).join(SEPARATOR) || t('total');
  const leafLabel = (key: PivotKey) =>
    key.parts.map((v, i) => format(v, colCols[i])).join(SEPARATOR);
  const cell = (rowId: string, leafId: string) => matrix.cells[rowId]?.[leafId];
  const rowHeading = rowCols.map((c) => columnLabel(c, locale)).join(SEPARATOR);
  const depth = colCols.length;

  // What names a cell: its row's and column's own values, by field. A total names only one side.
  const named = (row: PivotKey | null, leaf: PivotKey | null) => {
    const values: Record<string, unknown> = {};
    const words: string[] = [];
    const add = (cols: ReportColumn[], key: PivotKey | null) =>
      key?.parts.forEach((part, i) => {
        const column = cols[i];
        if (!column) return;
        values[column.key] = part;
        words.push(format(part, column));
      });
    add(rowCols, row);
    add(colCols, leaf);
    return { values, what: words.join(', ') };
  };
  /** The link of one cell (or total), or nothing when no rule applies or the screen may not follow it. */
  const linkOf = (row: PivotKey | null, leaf: PivotKey | null) => {
    if (!drill) return undefined;
    const { values, what } = named(row, leaf);
    const fields = [...rowCols, ...colCols, measure].map((c) => c.key);
    const target = drill.links.resolve({ fields, values });
    return target ? { links: drill.links, target, what } : undefined;
  };
  /** The colour of one cell: a rule on the count, read against the count and the fields that name it. */
  const toneOf = (total: AddedUp | undefined, row: PivotKey, leaf: PivotKey) => {
    if (!formatting || !total || total.value === null) return undefined;
    const tone = toneFor(
      formatting.rules,
      measure.key,
      { ...named(row, leaf).values, [measure.key]: total.value },
      columns,
    );
    return tone ? { tone, label: formatting.toneLabels[tone] } : undefined;
  };

  // Header rows, one per column field: every node of that depth, left to right.
  const levels: PivotColNode[][] = Array.from({ length: depth }, () => []);
  const collect = (nodes: PivotColNode[]) =>
    nodes.forEach((n) => {
      levels[n.depth]!.push(n);
      collect(n.children);
    });
  collect(matrix.colKeys);

  const list = (
    <>
      <ul aria-label={name} className="flex flex-col gap-2">
        {[...matrix.rowKeys, ...(showTotals ? [null] : [])].map((key) => {
          const totals = key ? matrix.rowTotals[key.id] : undefined;
          const parts = matrix.leaves.map((leaf) => {
            const total = key ? cell(key.id, leaf.id) : matrix.colTotals[leaf.id];
            return t('crosstab.listPart', {
              label: leafLabel(leaf) || columnLabel(measure, locale),
              value: matrixText(total, measure, suppressed, config),
            });
          });
          if (showTotals) {
            parts.push(
              t('crosstab.listPart', {
                label: t('total'),
                value: matrixText(key ? totals : matrix.grand, measure, suppressed, config),
              }),
            );
          }
          return (
            <li
              key={key?.id ?? 'column-totals'}
              className={cn(
                'rounded-lg border border-border-subtle bg-card p-3 text-body',
                !key && 'bg-muted font-medium',
              )}
            >
              {t('crosstab.listLine', {
                row: key ? rowLabel(key) : t('total'),
                parts: parts.join(', '),
              })}
            </li>
          );
        })}
      </ul>
      {suppressed && <p className="mt-2 text-label text-text-secondary">{t('hidden')}</p>}
    </>
  );

  const table = (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex --
        WCAG SCR29: a focusable, labelled scroll container keeps a wide table reachable by keyboard.
        Same exemption as `data-table.tsx`. */}
      <div
        role="region"
        tabIndex={0}
        aria-label={name}
        className="max-h-[70vh] w-full overflow-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{name}</caption>
          <thead className="text-label text-text-secondary">
            {(depth === 0 ? [[]] : levels).map((level, d) => (
              <tr key={d}>
                {d === 0 && (
                  <th
                    scope="col"
                    rowSpan={Math.max(depth, 1)}
                    className="sticky start-0 top-0 z-20 min-w-32 border-b border-border-subtle bg-muted p-2 text-start font-medium"
                  >
                    {rowHeading}
                  </th>
                )}
                {level.length === 0 && (
                  <th
                    scope="col"
                    className="sticky top-0 z-10 border-b border-border-subtle bg-muted p-2 text-end font-medium"
                  >
                    {columnLabel(measure, locale)}
                  </th>
                )}
                {level.map((node) => (
                  <th
                    key={node.id}
                    scope={node.children.length > 0 ? 'colgroup' : 'col'}
                    colSpan={node.span}
                    className={cn(
                      'sticky top-0 z-10 border-b border-border-subtle bg-muted p-2 font-medium',
                      node.children.length > 0 ? 'text-center' : 'text-end',
                    )}
                    style={d > 0 ? { top: `${d * 2.5}rem` } : undefined}
                  >
                    {format(node.value, colCols[node.depth])}
                  </th>
                ))}
                {d === 0 && showTotals && (
                  <th
                    scope="col"
                    rowSpan={Math.max(depth, 1)}
                    className="sticky top-0 z-10 border-b border-border-subtle bg-muted p-2 text-end font-medium"
                  >
                    {t('total')}
                  </th>
                )}
              </tr>
            ))}
          </thead>
          <tbody>
            {matrix.rowKeys.map((key) => (
              <tr key={key.id} className="border-b border-border-subtle">
                <th
                  scope="row"
                  className="sticky start-0 z-10 bg-surface p-2 text-start font-normal"
                >
                  {rowLabel(key)}
                </th>
                {matrix.leaves.map((leaf) => (
                  <td key={leaf.id} className="p-2 text-end tabular-nums">
                    <MatrixCell
                      total={cell(key.id, leaf.id)}
                      measure={measure}
                      suppressed={suppressed}
                      config={config}
                      tone={toneOf(cell(key.id, leaf.id), key, leaf)}
                      link={linkOf(key, leaf)}
                    />
                  </td>
                ))}
                {showTotals && (
                  <td className="p-2 text-end font-medium tabular-nums">
                    <MatrixCell
                      total={matrix.rowTotals[key.id]}
                      measure={measure}
                      suppressed={suppressed}
                      config={config}
                      link={linkOf(key, null)}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {showTotals && (
            <tfoot className="border-t-2 border-border font-medium">
              <tr>
                <th scope="row" className="sticky start-0 z-10 bg-muted p-2 text-start font-medium">
                  {t('total')}
                </th>
                {matrix.leaves.map((leaf) => (
                  <td key={leaf.id} className="bg-muted p-2 text-end tabular-nums">
                    <MatrixCell
                      total={matrix.colTotals[leaf.id]}
                      measure={measure}
                      suppressed={suppressed}
                      config={config}
                      link={linkOf(null, leaf)}
                    />
                  </td>
                ))}
                <td className="bg-muted p-2 text-end tabular-nums">
                  <MatrixCell
                    total={matrix.grand}
                    measure={measure}
                    suppressed={suppressed}
                    config={config}
                  />
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className="flex w-full flex-col gap-2">
      {view === 'auto' && wontFit && (
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setChosen(shown === 'list' ? 'table' : 'list')}
          >
            {shown === 'list' ? t('crosstab.seeAsTable') : t('crosstab.seeAsList')}
          </Button>
        </div>
      )}
      {shown === 'list' ? list : table}
    </div>
  );
}

/** Text twin of `MatrixCell`, for the list. A hidden count is a plain dash; a note explains it. */
function matrixText(
  total: AddedUp | undefined,
  measure: ReportColumn,
  suppressed: boolean,
  config: RegionConfig,
): string {
  if (total?.incomplete && suppressed) return '—';
  if (!total) return isAdditiveType(measure.type) ? formatCell(0, measure.type, config) : '—';
  return formatCell(total.value, measure.type, config);
}
