/**
 * [8.15.27] A report drawn as columns (`bar`) or a line, always inside `ChartTableToggle`: the chart
 * has a one-sentence text summary under it and a "ছক হিসেবে দেখুন" switch to the same numbers as a
 * table (the accessibility rule from [169]). The chart itself is the dashboard's `ColumnChart` /
 * `LineChart`; nothing is drawn here.
 *
 * Choices worth knowing:
 * - A count hidden for privacy is never drawn as 0. A column chart leaves that column empty and
 *   labels it "—"; a line chart leaves the point out. The summary says why.
 * - `ColumnChart` stacks two or more series and has three category colours, so at most three
 *   series are drawn. Every series is in the table view.
 * - A `pie` kind from the definition is drawn as columns: the renderer has no pie.
 * - Not exported from `index.ts`: `[8.15.29]` imports it by path.
 */
import * as React from 'react';

import { useLocale, useRegionConfig, useTranslation } from '../../i18n';
import { formatScore } from '../../utils';
import { ChartTableToggle } from '../dashboard/chart-table-toggle';
import type { ChartColor } from '../dashboard/chart-utils';
import { ColumnChart, type ColumnDatum } from '../dashboard/column-chart';
import { LineChart, type LineChartPoint } from '../dashboard/line-chart';
import { EmptyState } from '../empty-state';

import {
  DASH,
  columnLabel,
  formatCell,
  isHiddenCell,
  isNumericType,
  toNumber,
} from './format-cell';
import type { ReportColumn, ReportLayoutProps, ReportRunResult } from './types';

const SERIES_COLORS: ChartColor[] = ['primary', 'cat-2', 'cat-3'];
/** Few enough columns that a value label above each one stays readable. */
const LABEL_ALL_UP_TO = 8;

export interface ReportChartProps {
  result: ReportRunResult;
  layout: ReportLayoutProps;
  caption?: string;
  defaultView?: 'chart' | 'table';
}

export function ReportChart({ result, layout, caption, defaultView }: ReportChartProps) {
  const { t } = useTranslation('reportView');
  const { locale } = useLocale();
  const config = useRegionConfig();
  const { columns, rows, suppressed } = result;
  const chart = layout.chart;

  const xCol = chart ? columns.find((c) => c.key === chart.x) : undefined;
  const yCols = (chart?.y ?? [])
    .map((key) => columns.find((c) => c.key === key))
    .filter((c): c is ReportColumn => c !== undefined);

  if (!chart || !xCol || yCols.length === 0 || rows.length === 0) {
    return (
      <EmptyState kind="no-results" title={t('empty.title')} explanation={t('empty.explanation')} />
    );
  }

  const words = { yes: t('yes'), no: t('no') };
  const xs = rows.map((r) => formatCell(r[xCol.key], xCol.type, config, words));
  const hidden = (row: Record<string, unknown>, c: ReportColumn) =>
    isHiddenCell(row[c.key], c, suppressed);
  const labelOf = (c: ReportColumn) => columnLabel(c, locale);
  const tick = (n: number) => formatScore(n, config);

  // One sentence per series: highest and lowest of what is shown.
  const summaryFor = (c: ReportColumn): string => {
    const shown = rows
      .map((r, i) => ({ x: xs[i]!, n: toNumber(r[c.key]) }))
      .filter((p): p is { x: string; n: number } => p.n !== null);
    if (shown.length === 0) return t('hidden');
    const text = (n: number) => formatCell(n, c.type, config);
    const hi = shown.reduce((a, b) => (b.n > a.n ? b : a));
    const lo = shown.reduce((a, b) => (b.n < a.n ? b : a));
    const sentence =
      shown.length === 1
        ? t('chart.summaryOne', { label: hi.x, value: text(hi.n) })
        : t('chart.summary', {
            maxLabel: hi.x,
            max: text(hi.n),
            minLabel: lo.x,
            min: text(lo.n),
          });
    return yCols.length > 1 ? `${labelOf(c)}: ${sentence}` : sentence;
  };
  const anyHidden = suppressed && rows.some((r) => yCols.some((c) => hidden(r, c)));
  const summaries = yCols.map(summaryFor);
  const everythingHidden = summaries.every((s) => s === t('hidden'));
  const summary = summaries.join(' ') + (anyHidden && !everythingHidden ? ` ${t('hidden')}` : '');

  const table = {
    caption: caption ?? t('chart.caption'),
    columns: [columnLabel(xCol, locale), ...yCols.map(labelOf)],
    rows: rows.map((r, i) => [
      xs[i]!,
      ...yCols.map((c) => (hidden(r, c) ? DASH : formatCell(r[c.key], c.type, config, words))),
    ]),
    numeric: [isNumericType(xCol.type), ...yCols.map((c) => isNumericType(c.type))],
  };

  let drawing: React.ReactNode;
  if (chart.kind === 'line') {
    drawing = (
      <div className="flex flex-col gap-4">
        {yCols.map((c) => {
          const points: LineChartPoint[] = [];
          rows.forEach((r, i) => {
            const n = toNumber(r[c.key]);
            if (n !== null) {
              points.push({ x: xs[i]!, y: n, valueLabel: formatCell(n, c.type, config, words) });
            }
          });
          return (
            <div key={c.key}>
              {yCols.length > 1 && <p className="text-label font-medium">{labelOf(c)}</p>}
              <LineChart label={summaryFor(c)} points={points} formatTick={tick} />
            </div>
          );
        })}
      </div>
    );
  } else {
    const drawn = yCols.slice(0, SERIES_COLORS.length);
    const data: ColumnDatum[] = rows.map((r, i) => {
      const values: Record<string, number> = {};
      const valueLabels: Record<string, string> = {};
      for (const c of drawn) {
        values[c.key] = toNumber(r[c.key]) ?? 0;
        valueLabels[c.key] = hidden(r, c) ? DASH : formatCell(r[c.key], c.type, config, words);
      }
      const total = Object.values(values).reduce((acc, n) => acc + n, 0);
      // A hidden (suppressed) part makes the sum a lie, so the total hides too.
      const anyHidden = drawn.some((c) => hidden(r, c));
      return {
        x: xs[i]!,
        values,
        valueLabels,
        totalLabel: anyHidden ? DASH : formatScore(total, config),
      };
    });
    drawing = (
      <ColumnChart
        label={summary}
        series={drawn.map((c, i) => ({ id: c.key, label: labelOf(c), color: SERIES_COLORS[i]! }))}
        data={data}
        formatTick={tick}
        labelled={drawn.length === 1 && rows.length <= LABEL_ALL_UP_TO ? rows.map((_, i) => i) : []}
      />
    );
  }

  return (
    <ChartTableToggle
      summary={summary}
      table={table}
      showTableLabel={t('chart.seeAsTable')}
      showChartLabel={t('chart.seeAsChart')}
      {...(defaultView ? { defaultView } : {})}
    >
      {drawing}
    </ChartTableToggle>
  );
}
