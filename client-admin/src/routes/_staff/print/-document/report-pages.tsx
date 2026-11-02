/**
 * [8.15.30] `/print/document?doc=report&definitionId=<id>&params=<JSON of the prompt answers>`:
 * any defined report on A4, with the school header, a plain line saying what was chosen, the
 * print date, "page X of Y" in the foot margin, and Bangla shaped by the browser (Epic 32 D1).
 *
 * ```
 *   runner  ──Print──►  /print/document?doc=report&definitionId=…&params={"academic_year":"2026"}
 *                          │  POST /reports/run  (mode RUN, every page of the answer)
 *                          ▼
 *                       A4Document  ── school header · title · "২০২৬ · ৬ষ্ঠ শ্রেণি" · table
 *                                   ── @page margin box: "পাতা ১ / ৩"
 * ```
 *
 * What it reuses: `ReportTable`, `ReportGrouped`, `ReportCrosstab` and `ReportChart`, forced into
 * their table form (a printed page has no phone layout), inside `A4Document`.
 *
 * Which layout: a designer (REPORTS_DESIGN) reads `GET /reports/definitions/:id`; everyone else reads
 * `GET /reports/catalogue/:id/definition` (the published version's look, under the catalogue's own
 * visibility, no dataset). Either says grouped, table of counts or chart. Only when neither can be
 * read (a 404: the report is hidden or gone) does the result print by its columns, as a plain table.
 *
 * Audit: no `document-prints` row. That endpoint is for one student's document
 * (`POST /students/:id/document-prints`). A report print is the run itself: `POST /reports/run`
 * writes a `report_runs` row for this person, these params and this version (D8). The Print button
 * only calls `window.print()`.
 *
 * The footer: browsers that support `@page` margin boxes (Chrome, Edge) number the pages; others
 * print the page without a number. The date is in the page body, so it prints everywhere.
 */
import { Permission, ReportLayoutType, type ReportLayout, type ReportPage } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import {
  A4Document,
  Button,
  EmptyState,
  ErrorState,
  ReportChart,
  ReportCrosstab,
  ReportGrouped,
  ReportTable,
  Skeleton,
  type IssuerSnapshot,
  type ReportLayoutProps,
  type ReportRunResult,
} from '@biddaloy/ui/components';
import { useHasPermission, useSchoolProfile } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatDate, formatDateRange, formatDateTime, renderDigits } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { MonitorIcon, PrinterIcon, XIcon } from 'lucide-react';
import * as React from 'react';

import { copyPageLink, useIsWide } from '../../../../components/print/desktop-only-gate';

/** The run returns 100 rows a page and at most 100 pages (D20); a print asks for all of them. */
const MAX_PAGES = 100;
/** Pages asked for together, so a long report does not wait for 100 round trips one by one. */
const PAGES_AT_ONCE = 4;
/** A table of counts with more column values than this prints on a landscape sheet. */
const WIDE_CROSSTAB_COLUMNS = 5;
/** A flat table with more columns than this prints on a landscape sheet. */
const WIDE_TABLE_COLUMNS = 7;

export type PrintOrientation = 'portrait' | 'landscape';
/** `ReportPage` plus the hint the designer will set (not in the shared type yet). */
type PageHints = Partial<ReportPage> & { break_groups?: boolean };

export interface ReportPrintPagesProps {
  result: ReportRunResult;
  /** The definition's layout; without it (the look could not be read) the result prints as a plain table. */
  layout?: (ReportLayoutProps & { type?: ReportLayout['type'] }) | undefined;
  page?: PageHints | undefined;
  title: string;
  /** What was chosen, in plain words. Empty prints no line. */
  chosen: string;
  issuer: IssuerSnapshot;
  logoUrl?: string | null;
  activeLanguage: string;
  printedOn: string;
}

/** A cell as a grouping key: a label or a number, never "[object Object]". */
function cellKey(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** `landscape` when the definition says so, or when the table is too wide for a portrait sheet. */
export function pickOrientation(
  result: Pick<ReportRunResult, 'columns' | 'rows'>,
  layout: (ReportLayoutProps & { type?: ReportLayout['type'] }) | undefined,
  page: PageHints | undefined,
): PrintOrientation {
  if (page?.orientation === 'landscape') return 'landscape';
  if (layout?.type === ReportLayoutType.CROSSTAB) {
    const keys = layout.columns ?? [];
    const seen = new Set(
      result.rows.map((row) => keys.map((key) => cellKey(row[key])).join('\u0000')),
    );
    return seen.size > WIDE_CROSSTAB_COLUMNS ? 'landscape' : (page?.orientation ?? 'portrait');
  }
  if (layout?.type !== ReportLayoutType.CHART && result.columns.length > WIDE_TABLE_COLUMNS) {
    return 'landscape';
  }
  return page?.orientation ?? 'portrait';
}

/**
 * The `@page` box: sheet size and the foot margin that numbers the pages. `pageOf` is the
 * translated sentence with `{{page}}` and `{{total}}` left in it; the numbers come from the
 * browser's own counters, in Bangla digits when the school writes Bangla.
 */
export function pageCss(
  orientation: PrintOrientation,
  pageOf: string,
  numerals: RegionConfig['numerals'],
): string {
  const style = numerals === 'bengali' ? 'bengali' : 'decimal';
  const content = pageOf
    .split(/(\{\{page\}\}|\{\{total\}\})/)
    .filter((part) => part !== '')
    .map((part) => {
      if (part === '{{page}}') return `counter(page, ${style})`;
      if (part === '{{total}}') return `counter(pages, ${style})`;
      return `"${part.replace(/["\\\n]/g, ' ')}"`;
    })
    .join(' ');
  return `@media print { @page { size: A4 ${orientation}; margin: 10mm 10mm 14mm; @bottom-center { content: ${content}; font-size: 9pt; } } }`;
}

/** The answers in the URL as one plain line: "২০২৬ · ৬ষ্ঠ শ্রেণি · ১ – ৩১ অক্টোবর". */
export function describeParams(params: Record<string, unknown>, config: RegionConfig): string {
  const parts: string[] = [];
  for (const value of Object.values(params)) {
    if (typeof value === 'string' && value.trim() !== '') {
      parts.push(
        /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? formatDate(value, config)
          : renderDigits(value.trim(), config.numerals),
      );
    } else if (typeof value === 'number') {
      parts.push(renderDigits(String(value), config.numerals));
    } else if (Array.isArray(value)) {
      const list = value.filter((v): v is string => typeof v === 'string' && v !== '');
      if (list.length > 0) parts.push(list.join(', '));
    } else if (value && typeof value === 'object') {
      const { from, to } = value as { from?: unknown; to?: unknown };
      if (typeof from === 'string' && typeof to === 'string') {
        parts.push(formatDateRange(from, to, config));
      }
    }
  }
  return parts.join(' · ');
}

/** The rows of the first group, then the next, each in the order the server sorted them. */
function splitByFirstGroup(result: ReportRunResult, groupKey: string): ReportRunResult[] {
  const chunks: ReportRunResult[] = [];
  let currentKey: string | undefined;
  for (const row of result.rows) {
    const key = cellKey(row[groupKey]);
    if (chunks.length === 0 || key !== currentKey) {
      chunks.push({ ...result, rows: [] });
      currentKey = key;
    }
    chunks[chunks.length - 1]!.rows.push(row);
  }
  return chunks;
}

/**
 * One report body in its printable (table) form. No `caption`: the sheet's own heading already
 * names the report, and the same name on two landmarks fails the unique-landmark rule.
 */
function ReportBody({
  result,
  layout,
  tableId,
}: {
  result: ReportRunResult;
  layout: ReportPrintPagesProps['layout'];
  tableId: string;
}) {
  switch (layout?.type) {
    case ReportLayoutType.GROUPED:
      return <ReportGrouped result={result} layout={layout} view="table" />;
    case ReportLayoutType.CROSSTAB:
      return <ReportCrosstab result={result} layout={layout} view="table" />;
    case ReportLayoutType.CHART:
      return <ReportChart result={result} layout={layout} defaultView="chart" />;
    default:
      return <ReportTable result={result} tableId={tableId} layout="table" />;
  }
}

/**
 * The printable pages for one finished run. Pure of fetching, so a test (and a story) can hand it
 * a fixture. A grouped report whose definition asks for it starts each top group on a new sheet.
 */
export function ReportPrintPages({
  result,
  layout,
  page,
  title,
  chosen,
  issuer,
  logoUrl,
  activeLanguage,
  printedOn,
}: ReportPrintPagesProps) {
  const { t } = useTranslation('common');
  const config = useRegionConfig();
  const orientation = pickOrientation(result, layout, page);
  const pageOf = t('reportPrint.pageOf', {
    page: '{{page}}',
    total: '{{total}}',
    interpolation: { escapeValue: false },
  });
  const firstGroup = layout?.group_by?.[0];
  const breakGroups =
    layout?.type === ReportLayoutType.GROUPED && page?.break_groups === true && firstGroup;
  const chunks = breakGroups ? splitByFirstGroup(result, firstGroup) : [result];

  return (
    <>
      {/* Scoped to this page: it unmounts with it, so the next document gets its own sheet size. */}
      <style data-slot="report-print-page">{pageCss(orientation, pageOf, config.numerals)}</style>
      {chunks.map((chunk, index) => {
        const last = index === chunks.length - 1;
        // A grand total belongs to the whole report, not to each group's sheet.
        const chunkLayout =
          chunks.length > 1 && !last && layout ? { ...layout, totals: false } : layout;
        return (
          <A4Document
            key={index}
            issuer={issuer}
            logoUrl={logoUrl ?? null}
            activeLanguage={activeLanguage}
            title={title}
            {...(chosen ? { subtitle: chosen } : {})}
            orientation={orientation}
            printedOn={printedOn}
          >
            <ReportBody result={chunk} layout={chunkLayout} tableId={`report-print-${index}`} />
            {last && result.truncated && (
              <p role="note" className="text-caption text-text-secondary">
                {t('reportPrint.truncated', { n: result.rows.length })}
              </p>
            )}
          </A4Document>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

export interface ReportDocumentPageProps {
  definitionId: string | undefined;
  /** The prompt answers from the URL, by parameter key. */
  params: Record<string, unknown> | undefined;
  /** An in-app path to go back to. */
  from?: string | undefined;
}

interface CatalogueFolder {
  reports: { id: string; name_en: string; name_bn: string }[];
}

interface DefinitionDetail {
  name_en: string;
  name_bn: string;
  draft: { layout?: ReportLayout; page?: ReportPage } | null;
}

/** `GET /reports/catalogue/:id/definition`: the published version's look, for any viewer. */
interface PresentationDetail {
  layout?: ReportLayout;
  page?: ReportPage;
}

/** Every page of the answer, in order (`truncated` says when the 10,000-row cap cut it short). */
async function runAllPages(
  definitionId: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ReportRunResult> {
  const run = async (page: number) =>
    (
      await apiClient.post<ReportRunResult>(
        '/reports/run',
        { definitionId, params, ...(page > 1 ? { page } : {}) },
        { signal },
      )
    ).data;
  const first = await run(1);
  const total = Math.min(first.total_pages, MAX_PAGES);
  const rows = [...first.rows];
  for (let from = 2; from <= total; from += PAGES_AT_ONCE) {
    const batch = Array.from(
      { length: Math.min(PAGES_AT_ONCE, total - from + 1) },
      (_, i) => from + i,
    );
    for (const next of await Promise.all(batch.map(run))) rows.push(...next.rows);
  }
  return { ...first, rows, page: 1, total_pages: 1, page_size: rows.length };
}

/** The whole `/print/document?doc=report` screen: the bar, the gate for small screens, the pages. */
export function ReportDocumentPage({ definitionId, params, from }: ReportDocumentPageProps) {
  // One hook, several namespaces: each call below names its own (`{ ns }`), which is also how
  // `yarn check:i18n` knows where to look.
  const { t, i18n } = useTranslation(['common', 'examDocuments', 'reportView']);
  const { t: tG } = useTranslation('printTemplates');
  const router = useRouter();
  const wide = useIsWide();
  const config = useRegionConfig();
  const canView = useHasPermission(Permission.REPORTS_VIEW);
  const canDesign = useHasPermission(Permission.REPORTS_DESIGN);
  const lang = i18n.language;
  const bn = lang.startsWith('bn');
  const answers = params ?? {};
  const on = canView && definitionId !== undefined;

  const profile = useSchoolProfile();
  // The name, for anyone who may run reports (the definition itself is for designers).
  const catalogue = useQuery({
    queryKey: ['report-print', 'catalogue'],
    queryFn: async ({ signal }) =>
      (await apiClient.get<CatalogueFolder[]>('/reports/catalogue', { signal })).data,
    enabled: on,
    staleTime: Infinity,
    retry: false,
  });
  const definition = useQuery({
    queryKey: ['report-print', 'definition', definitionId],
    queryFn: async ({ signal }) =>
      (await apiClient.get<DefinitionDetail>(`/reports/definitions/${definitionId}`, { signal }))
        .data,
    enabled: on && canDesign,
    staleTime: Infinity,
    retry: false,
  });
  // Everyone else reads the published version's look. A 404 (hidden, gone) is not an error here:
  // the report then prints as a plain table.
  const presentation = useQuery({
    queryKey: ['report-print', 'presentation', definitionId],
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<PresentationDetail>(`/reports/catalogue/${definitionId}/definition`, {
          signal,
        })
      ).data,
    enabled: on && !canDesign,
    staleTime: Infinity,
    retry: false,
  });
  // A run is written to the run log, so it never repeats on focus, remount or reconnect.
  const run = useQuery({
    queryKey: ['report-print', 'run', definitionId, JSON.stringify(answers)],
    queryFn: ({ signal }) => runAllPages(definitionId!, answers, signal),
    enabled: on,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const entry = catalogue.data?.flatMap((f) => f.reports).find((r) => r.id === definitionId);
  const named = entry ?? definition.data;
  const name = named ? (bn ? named.name_bn : named.name_en) : '';
  const title = name || t('reportPrint.title');

  const p = profile.data;
  const issuer: IssuerSnapshot | undefined = p && {
    name: p.name,
    name_bn: p.name_bn,
    address: p.address,
    phone: p.phone,
    email: p.email,
    registration_id: p.registration_id,
    logo_key: p.logo_url ? 'active' : null,
  };

  const loading =
    profile.isLoading || run.isLoading || definition.isLoading || presentation.isLoading;
  const failed = profile.isError || run.isError;
  const ready = on && !loading && !failed && issuer !== undefined && run.data !== undefined;
  const hasRows = (run.data?.rows.length ?? 0) > 0;

  const close = () => router.history.push(from ?? '/reports');

  const bar = (printable: boolean) => (
    <header className="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 py-3 print:hidden">
      <div className="min-w-0">
        <h1 className="truncate text-h3 font-semibold text-text-primary">{title}</h1>
        {printable && (
          <p className="text-body-sm truncate text-text-secondary">
            {describeParams(answers, config)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" onClick={close}>
          <XIcon aria-hidden /> {t('page.close', { ns: 'examDocuments' })}
        </Button>
        <Button disabled={!printable} onClick={() => window.print()}>
          <PrinterIcon aria-hidden /> {t('page.print', { ns: 'examDocuments' })}
        </Button>
      </div>
    </header>
  );

  // Printing needs a big screen and a printer.
  if (!wide) {
    return (
      <>
        {bar(false)}
        <EmptyState
          icon={<MonitorIcon aria-hidden />}
          title={tG('gate.title')}
          explanation={tG('gate.body')}
          action={{ label: tG('gate.copy'), onClick: () => void copyPageLink(tG) }}
        />
      </>
    );
  }

  let body: React.ReactNode;
  if (definitionId === undefined) {
    body = (
      <EmptyState
        title={t('page.empty', { ns: 'examDocuments' })}
        explanation={t('reportPrint.missingHint')}
      />
    );
  } else if (!canView) {
    body = (
      <EmptyState title={t('reportPrint.noAccess')} explanation={t('reportPrint.noAccessHint')} />
    );
  } else if (failed) {
    body = (
      <ErrorState
        message={t('page.loadError', { ns: 'examDocuments' })}
        onRetry={() => {
          if (profile.isError) void profile.refetch();
          if (run.isError) void run.refetch();
        }}
      />
    );
  } else if (loading || !issuer || !run.data) {
    body = (
      <Skeleton
        role="status"
        aria-label={t('page.loading', { ns: 'examDocuments' })}
        className="h-96 w-full max-w-[210mm]"
      />
    );
  } else if (!hasRows) {
    // The report ran and nobody matched: say what to change (glossary), not "check the link".
    body = (
      <EmptyState
        title={t('empty.title', { ns: 'reportView' })}
        explanation={t('empty.explanation', { ns: 'reportView' })}
      />
    );
  } else {
    const detail = canDesign ? definition.data?.draft : presentation.data;
    body = (
      <ReportPrintPages
        result={run.data}
        {...(detail?.layout ? { layout: detail.layout } : {})}
        page={detail?.page}
        title={title}
        chosen={describeParams(answers, config)}
        issuer={issuer}
        logoUrl={p?.logo_url ?? null}
        activeLanguage={lang}
        printedOn={t('reportPrint.printedOn', { date: formatDateTime(new Date(), config) })}
      />
    );
  }

  return (
    <div className="min-h-screen bg-muted print:min-h-0 print:bg-transparent">
      {bar(ready && hasRows)}
      <main className="flex flex-col items-center gap-6 p-6 print:block print:gap-0 print:p-0">
        {body}
      </main>
    </div>
  );
}
