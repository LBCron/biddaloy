/**
 * [8.15.26] A flat report: one row per result row, typed cells, server-side order.
 *
 * Wraps `DataTable`, so the phone gets cards for free (`layout="auto"` measures the table's own
 * width). Sorting is off because the server sorts (D4); paging, when the caller passes
 * `onPageChange`, is the server's page too.
 *
 * Also home to `ReportCell`, the one place a report cell turns into text, shared by the grouped and
 * the table-of-counts renderers. A count hidden for privacy shows "—" with a tooltip in plain
 * words, never 0 (D14, glossary rule).
 */
import { ArrowUpRight } from 'lucide-react';
import * as React from 'react';

import { useLocale, useRegionConfig, useTranslation, type RegionConfig } from '../../i18n';
import { cn } from '../../primitives/lib/utils';
import { DataTable, type DataTableColumn } from '../data-table';
import { FORMAT_TONES } from '../report-designer/format-rules-editor';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip';

import type { DrillLinks, DrillTarget, ReportDrilling } from './drill';
import {
  DASH,
  columnLabel,
  formatCell,
  isHiddenCell,
  isNumericType,
  toneFor,
  type FormatTone,
  type ReportFormatting,
} from './format-cell';
import type { ReportColumn, ReportRunResult, ReportViewMode } from './types';

/** A dash a keyboard user can reach, so the plain-words reason is not hover-only. */
export function HiddenCellMark() {
  const { t } = useTranslation('reportView');
  const text = t('hidden');
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={text}
            className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-sm text-text-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {DASH}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 whitespace-normal">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * A colour is never the whole message (D21, ui/CONTRIBUTING): each tone has its own icon, and the
 * colour's word is read out after the number ("৫,০০০ (লাল)"). The sentence that explains the colour
 * sits under the report, as a legend.
 */
export function ToneMark({
  tone,
  label,
  children,
}: {
  tone: FormatTone;
  label: string;
  children: React.ReactNode;
}) {
  const { fg, bg, icon: Icon } = FORMAT_TONES[tone];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5', bg, fg)}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
      <span className="sr-only"> ({label})</span>
    </span>
  );
}

/**
 * A number or name that opens another page: a real link (so "open in a new tab" works) that goes
 * through the router on a plain click. The small arrow and the underline on hover say it is
 * clickable; the spoken name says where it goes.
 */
export function DrillLink({
  href,
  label,
  onOpen,
  children,
}: {
  href: string;
  /** The spoken name: where it goes, and the number it shows. */
  label: string;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="group inline-flex min-h-6 items-center gap-0.5 rounded-sm text-text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={(event) => {
        // Let the browser handle "open in a new tab" and friends.
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen();
      }}
    >
      {children}
      <ArrowUpRight
        aria-hidden="true"
        className="size-3.5 text-text-secondary group-hover:text-text-primary"
      />
    </a>
  );
}

export interface ReportCellProps {
  value: unknown;
  column: ReportColumn;
  /** The run's `suppressed` flag. */
  suppressed: boolean;
  /** A colour rule met by this cell. */
  tone?: { tone: FormatTone; label: string } | undefined;
  /** Where this cell opens, if anywhere. A hidden cell never opens anything. */
  link?: { links: DrillLinks; target: DrillTarget; what: string } | undefined;
}

export function ReportCell({ value, column, suppressed, tone, link }: ReportCellProps) {
  const { t } = useTranslation('reportView');
  const config = useRegionConfig();
  // A cell hidden for privacy is a dash: no colour, and no link that would open the hidden people.
  if (isHiddenCell(value, column, suppressed)) return <HiddenCellMark />;
  const text = formatCell(value, column.type, config, { yes: t('yes'), no: t('no') });
  let content: React.ReactNode = text;
  if (tone) {
    content = (
      <ToneMark tone={tone.tone} label={tone.label}>
        {content}
      </ToneMark>
    );
  }
  if (link && text !== DASH) {
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

export interface ReportTableProps {
  result: ReportRunResult;
  /** The report's title; names the table for screen readers. */
  caption?: string;
  /** Unique per table on a page; `DataTable` keys its saved state by it. */
  tableId?: string;
  /** Passing it shows the server's pager; leave it out for a single page. */
  onPageChange?: (page: number) => void;
  layout?: ReportViewMode;
  loading?: boolean;
  isFetching?: boolean;
  /** Colour rules ([8.15.42]); no rules, no colour. */
  format?: ReportFormatting;
  /** Cells that open another page ([8.15.42]); none, no links. */
  drill?: ReportDrilling;
}

interface Line {
  id: string;
  row: Record<string, unknown>;
}

const noSort = () => {};

/** What a clicked cell is about, in the viewer's words: its own text for a label, else the row's labels. */
function whatOf(
  column: ReportColumn,
  row: Record<string, unknown>,
  columns: readonly ReportColumn[],
  locale: string,
  config: RegionConfig,
): string {
  const own = (c: ReportColumn) =>
    `${columnLabel(c, locale)}: ${formatCell(row[c.key], c.type, config)}`;
  if (column.kind === 'dimension') return own(column);
  return columns
    .filter((c) => c.kind === 'dimension' && row[c.key] !== null && row[c.key] !== undefined)
    .slice(0, 3)
    .map(own)
    .join(', ');
}

export function ReportTable({
  result,
  caption,
  tableId = 'report-table',
  onPageChange,
  layout = 'auto',
  loading,
  isFetching,
  format,
  drill,
}: ReportTableProps) {
  const { t } = useTranslation('reportView');
  const { locale } = useLocale();
  const config = useRegionConfig();
  const { columns, rows, suppressed, page, page_size, total_rows } = result;

  const lines = React.useMemo<Line[]>(
    () => rows.map((row, i) => ({ id: `${page}-${i}`, row })),
    [rows, page],
  );
  const tableColumns = React.useMemo<DataTableColumn<Line>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        header: columnLabel(column, locale),
        accessorFn: (line) => {
          const value = line.row[column.key];
          const tone = format ? toneFor(format.rules, column.key, line.row, columns) : null;
          const target = drill?.links.resolve({ fields: [column.key], values: line.row }) ?? null;
          return (
            <ReportCell
              value={value}
              column={column}
              suppressed={suppressed}
              tone={tone && format ? { tone, label: format.toneLabels[tone] } : undefined}
              link={
                drill && target
                  ? {
                      links: drill.links,
                      target,
                      what: whatOf(column, line.row, columns, locale, config),
                    }
                  : undefined
              }
            />
          );
        },
        ...(isNumericType(column.type) ? { align: 'end' as const } : {}),
      })),
    [columns, locale, config, suppressed, format, drill],
  );

  return (
    <DataTable<Line>
      tableId={tableId}
      caption={caption ?? t('table.caption')}
      columns={tableColumns}
      data={lines}
      getRowId={(line) => line.id}
      sorting={null}
      onSortingChange={noSort}
      page={page}
      pageSize={page_size}
      totalCount={total_rows}
      {...(onPageChange ? { onPageChange } : { paginated: false })}
      layout={layout}
      {...(loading !== undefined ? { loading } : {})}
      {...(isFetching !== undefined ? { isFetching } : {})}
      emptyState={{
        kind: 'no-results',
        title: t('empty.title'),
        explanation: t('empty.explanation'),
      }}
    />
  );
}
