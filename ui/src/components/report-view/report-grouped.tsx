/**
 * [8.15.26] A banded report: rows are gathered under the layout's `group_by` keys, each group gets a
 * header, its detail rows and (when the layout asks) a "মোট" / "Total" line; the end gets one
 * "সর্বমোট" / "Grand total" line. Never "Σ", never "aggregate" (glossary, D21).
 *
 * Grouping is client-side and keeps the server's order: the first time a value appears it opens a
 * group. Totals add the rows of a group in whole paisa (`addUp`). A total that includes a count
 * hidden for privacy is itself shown as a hidden dash, not as a smaller number.
 *
 * Why not `DataTable`: it has no header or footer rows. This renders its own semantic `<table>`
 * (one `<tbody>` per top-level group, `<tfoot>` for the grand total) on a wide container and a list
 * of cards on a narrow one, choosing by the component's own width like `DataTable` does.
 */
import * as React from 'react';

import { useContainerWidth } from '../../hooks/use-container-width';
import { useLocale, useRegionConfig, useTranslation, type RegionConfig } from '../../i18n';
import { cn } from '../../primitives/lib/utils';
import { Card } from '../card';
import { EmptyState } from '../empty-state';

import {
  addUp,
  columnLabel,
  formatCell,
  isNumericType,
  type AddedUp,
  type CellWords,
} from './format-cell';
import { HiddenCellMark, ReportCell } from './report-table';
import type {
  ReportColumn,
  ReportLayoutProps,
  ReportRow,
  ReportRunResult,
  ReportViewMode,
} from './types';

const CARD_MODE_MAX_WIDTH = 768;

type Totals = Record<string, AddedUp>;

type Line =
  | { kind: 'header'; id: string; depth: number; label: string }
  | { kind: 'row'; id: string; row: ReportRow }
  | { kind: 'subtotal'; id: string; depth: number; label: string; totals: Totals }
  | { kind: 'grand'; id: string; totals: Totals };

interface Plan {
  groupCols: ReportColumn[];
  detailCols: ReportColumn[];
  /** Leading detail columns that are labels; a total line's name spans them. */
  leadCount: number;
}

/** Which columns become group headers and which stay in the rows. */
function plan(columns: ReportColumn[], groupBy: readonly string[] | undefined): Plan {
  const groupCols = (groupBy ?? [])
    .map((key) => columns.find((c) => c.key === key))
    .filter((c): c is ReportColumn => c !== undefined);
  let detailCols = columns.filter((c) => !groupCols.includes(c));
  // Nothing but numbers left: the innermost group would be a header over single rows with no name
  // on them. Keep it as the row's label instead.
  if (groupCols.length > 0 && !detailCols.some((c) => c.kind === 'dimension')) {
    detailCols = [groupCols.pop()!, ...detailCols];
  }
  let leadCount = 0;
  while (detailCols[leadCount]?.kind === 'dimension') leadCount++;
  return { groupCols, detailCols, leadCount };
}

function totalsOf(rows: ReportRow[], detailCols: ReportColumn[]): Totals {
  const totals: Totals = {};
  for (const c of detailCols) {
    if (c.kind === 'measure') {
      totals[c.key] = addUp(
        rows.map((r) => r[c.key]),
        c.type,
      );
    }
  }
  return totals;
}

function buildLines(
  rows: ReportRow[],
  p: Plan,
  layout: ReportLayoutProps,
  text: {
    group: (value: unknown, column: ReportColumn) => string;
    subtotal: (group: string) => string;
  },
): Line[] {
  const lines: Line[] = [];
  const walk = (subset: ReportRow[], depth: number, path: string) => {
    const column = p.groupCols[depth];
    if (!column) {
      subset.forEach((row, i) => lines.push({ kind: 'row', id: `${path}/r${i}`, row }));
      return;
    }
    const groups = new Map<unknown, ReportRow[]>();
    for (const row of subset) {
      const key = row[column.key] ?? null;
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
    let n = 0;
    for (const [value, members] of groups) {
      const id = `${path}/g${n++}`;
      const label = text.group(value, column);
      lines.push({ kind: 'header', id: `${id}/h`, depth, label });
      walk(members, depth + 1, id);
      if (layout.subtotals) {
        lines.push({
          kind: 'subtotal',
          id: `${id}/s`,
          depth,
          label: text.subtotal(label),
          totals: totalsOf(members, p.detailCols),
        });
      }
    }
  };
  walk(rows, 0, '');
  if (layout.totals)
    lines.push({ kind: 'grand', id: 'grand', totals: totalsOf(rows, p.detailCols) });
  return lines;
}

function TotalCell({
  column,
  total,
  suppressed,
}: {
  column: ReportColumn;
  total?: AddedUp | undefined;
  suppressed: boolean;
}) {
  const config = useRegionConfig();
  if (!total) return null;
  if (total.incomplete && suppressed) return <HiddenCellMark />;
  if (total.value === null) return null;
  return <>{formatCell(total.value, column.type, config)}</>;
}

const numericClass = (c: ReportColumn) =>
  isNumericType(c.type) ? 'text-end tabular-nums' : 'text-start';

export interface ReportGroupedProps {
  result: ReportRunResult;
  layout: ReportLayoutProps;
  caption?: string;
  /** `auto` picks cards below 768 px of this component's own width. */
  view?: ReportViewMode;
}

export function ReportGrouped({ result, layout, caption, view = 'auto' }: ReportGroupedProps) {
  const { t } = useTranslation('reportView');
  const { locale } = useLocale();
  const config = useRegionConfig();
  const { columns, rows, suppressed } = result;
  const name = caption ?? t('table.caption');

  const containerRef = React.useRef<HTMLDivElement>(null);
  const measured = useContainerWidth(containerRef);
  const [narrowGuess] = React.useState(
    () =>
      typeof matchMedia === 'function' &&
      matchMedia(`(max-width: ${CARD_MODE_MAX_WIDTH - 1}px)`).matches,
  );
  const cardMode =
    view === 'cards'
      ? true
      : view === 'table'
        ? false
        : measured !== null
          ? measured < CARD_MODE_MAX_WIDTH
          : narrowGuess;

  const p = React.useMemo(() => plan(columns, layout.group_by), [columns, layout.group_by]);
  const lines = React.useMemo(
    () =>
      buildLines(rows, p, layout, {
        group: (value, column) => groupLabel(value, column, config, { yes: t('yes'), no: t('no') }),
        subtotal: (group) => t('subtotalFor', { group }),
      }),
    [rows, p, layout, config, t],
  );

  if (rows.length === 0 || p.detailCols.length === 0) {
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

  const label = (c: ReportColumn) => columnLabel(c, locale);
  const totalName = (line: Line) =>
    line.kind === 'grand' ? t('grandTotal') : 'label' in line ? line.label : '';
  const first = p.detailCols[0]!;

  return (
    <div ref={containerRef} className="w-full">
      {cardMode ? (
        <ul aria-label={name} className="flex flex-col gap-2">
          {lines.map((line) => {
            if (line.kind === 'header') {
              return (
                <li key={line.id} style={{ marginInlineStart: `${line.depth * 0.75}rem` }}>
                  <p className="pt-2 text-label font-medium text-text-secondary">{line.label}</p>
                </li>
              );
            }
            const isTotal = line.kind === 'subtotal' || line.kind === 'grand';
            const title =
              line.kind === 'row'
                ? undefined
                : line.kind === 'grand'
                  ? t('grandTotal')
                  : line.label;
            const fields = isTotal
              ? p.detailCols.filter((c) => c.kind === 'measure')
              : p.detailCols.slice(1);
            return (
              <li key={line.id}>
                <Card padded className={cn('flex flex-col gap-2', isTotal && 'bg-muted')}>
                  <p
                    className={cn(
                      'text-body',
                      isTotal ? 'font-medium' : 'font-medium text-foreground',
                    )}
                  >
                    {title ??
                      (line.kind === 'row' && (
                        <ReportCell
                          value={line.row[first.key]}
                          column={first}
                          suppressed={suppressed}
                        />
                      ))}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border-subtle pt-2">
                    {fields.map((c) => (
                      <div key={c.key}>
                        <dt className="text-caption text-text-secondary">{label(c)}</dt>
                        <dd className={cn('text-sm', numericClass(c))}>
                          {line.kind === 'row' ? (
                            <ReportCell
                              value={line.row[c.key]}
                              column={c}
                              suppressed={suppressed}
                            />
                          ) : (
                            <TotalCell
                              column={c}
                              total={line.totals[c.key]}
                              suppressed={suppressed}
                            />
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
          {/* eslint-disable jsx-a11y/no-noninteractive-tabindex --
            WCAG SCR29: a focusable, labelled scroll container is how a table wider than its box
            stays reachable by keyboard. Same exemption as `data-table.tsx`. */}
          <div
            role="region"
            tabIndex={0}
            aria-label={name}
            className="w-full overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{name}</caption>
              <thead className="border-b border-border-subtle bg-muted text-label text-text-secondary">
                <tr>
                  {p.detailCols.map((c) => (
                    <th key={c.key} scope="col" className={cn('p-2 font-medium', numericClass(c))}>
                      {label(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              {blocks(lines).map((block, b) => {
                const grand = block[0]?.kind === 'grand';
                const Section = grand ? 'tfoot' : 'tbody';
                return (
                  <Section key={b} className={cn(grand && 'border-t-2 border-border')}>
                    {block.map((line) => {
                      if (line.kind === 'header') {
                        return (
                          <tr key={line.id} className="border-b border-border-subtle bg-muted/50">
                            <th
                              scope="rowgroup"
                              colSpan={p.detailCols.length}
                              className="p-2 text-start font-medium"
                              style={{ paddingInlineStart: `${0.5 + line.depth * 1}rem` }}
                            >
                              <span className="sr-only">{`${label(p.groupCols[line.depth]!)}: `}</span>
                              {line.label}
                            </th>
                          </tr>
                        );
                      }
                      if (line.kind === 'row') {
                        return (
                          <tr key={line.id} className="border-b border-border-subtle">
                            {p.detailCols.map((c) => (
                              <td key={c.key} className={cn('p-2', numericClass(c))}>
                                <ReportCell
                                  value={line.row[c.key]}
                                  column={c}
                                  suppressed={suppressed}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      }
                      return (
                        <tr
                          key={line.id}
                          className={cn(
                            'border-b border-border-subtle font-medium',
                            line.kind === 'grand' ? 'bg-muted' : 'bg-muted/50',
                          )}
                        >
                          {p.leadCount > 0 && (
                            <th
                              scope="row"
                              colSpan={p.leadCount}
                              className="p-2 text-start font-medium"
                            >
                              {totalName(line)}
                            </th>
                          )}
                          {p.detailCols.slice(p.leadCount).map((c, i) => (
                            <td key={c.key} className={cn('p-2', numericClass(c))}>
                              {/* Numbers only, no label column: the name rides in the first cell. */}
                              {p.leadCount === 0 && i === 0 && (
                                <span className="me-2 font-medium">{totalName(line)}</span>
                              )}
                              <TotalCell
                                column={c}
                                total={line.totals[c.key]}
                                suppressed={suppressed}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </Section>
                );
              })}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** A table body per top-level group; the grand total is its own block (the `<tfoot>`). */
function blocks(lines: Line[]): Line[][] {
  const out: Line[][] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (line.kind === 'grand' || (line.kind === 'header' && line.depth === 0) || !last)
      out.push([line]);
    else last.push(line);
  }
  return out;
}

function groupLabel(
  value: unknown,
  column: ReportColumn,
  config: RegionConfig,
  words: CellWords,
): string {
  return formatCell(value, column.type, config, words);
}
