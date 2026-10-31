/**
 * [8.15.55] `/reports-usage` — which reports are used and found useful (Epic 8.15 D24). The platform
 * console is a pathless layout, so this file's URL is `/reports-usage`, like `/subscriptions`.
 *
 * ```
 *  How reports are used                 Period [Last 30 days v]
 *  Counts only. No student, guardian or money rows, and no names.
 *
 *  Public exam results                       <- least helpful first; "nobody answered" last
 *   Times opened 42   Schools 6   People 11   Found useful 38%
 *   Too slow 3   Nothing to show 9   Large downloads 0
 *   What people said:  - "Needs the pass mark"  - "Wrong year"
 * ```
 *
 * Data: `GET /platform/reports/usage` (platform SUPER_ADMIN only; the server is the boundary, the
 * layout's `RequireRole` is the UX gate). The answer holds counts and the latest comments, no ids.
 * A comment is text a person typed, so it is always shown as a plain text node, never as HTML, and
 * has no link. A key that is not one of the ready reports is a school's own report (`custom`).
 * Sort: found useful, lowest first; a report nobody answered about has no share and goes last; ties
 * go to the one opened more. Words: `platform.json` `reportsUsage.*` (the 8.15 glossary).
 */
import {
  EmptyState,
  ErrorState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@biddaloy/ui/components';
import { usePlatformReportUsage, type PlatformReportUsageRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../route-loaders';

export const Route = createFileRoute('/_platform/reports-usage')({
  loader: () => loadRouteNamespaces('platform', 'nav'),
  component: ReportsUsagePage,
});

const PERIODS = ['30', '90', '365'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Least helpful first; no answers last; then the more opened one first. */
export function sortByLeastHelpful(
  rows: readonly PlatformReportUsageRow[],
): PlatformReportUsageRow[] {
  return [...rows].sort((a, b) => {
    if (a.helpful_pct === null && b.helpful_pct !== null) return 1;
    if (a.helpful_pct !== null && b.helpful_pct === null) return -1;
    if (a.helpful_pct !== null && b.helpful_pct !== null && a.helpful_pct !== b.helpful_pct) {
      return a.helpful_pct - b.helpful_pct;
    }
    return b.runs - a.runs;
  });
}

function ReportsUsagePage() {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();
  const [period, setPeriod] = React.useState<(typeof PERIODS)[number]>('30');
  // Computed once per choice: a new `from` on every render would be a new request every render.
  const from = React.useMemo(
    () => toIsoDate(new Date(Date.now() - Number(period) * DAY_MS)),
    [period],
  );
  const usage = usePlatformReportUsage({ from });
  const rows = React.useMemo(() => sortByLeastHelpful(usage.data?.reports ?? []), [usage.data]);
  const n = (value: number) => formatNumber(value, config);

  const nameOf = (key: string) =>
    key === 'custom'
      ? t('reportsUsage.custom')
      : t(`reportsUsage.names.${key}`, { defaultValue: key });

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader title={t('reportsUsage.title')} subtitle={t('reportsUsage.subtitle')} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as (typeof PERIODS)[number])}>
            <SelectTrigger aria-label={t('reportsUsage.rangeLabel')} className="w-auto min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`reportsUsage.range.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {usage.data && (
            <span className="text-text-secondary">
              {t('reportsUsage.period', {
                from: formatDate(usage.data.from, config),
                to: formatDate(usage.data.to, config),
              })}
            </span>
          )}
        </div>
        <p className="text-text-secondary">{t('reportsUsage.sortNote')}</p>

        {usage.isPending ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : usage.isError ? (
          <ErrorState
            message={t('reportsUsage.errorMessage')}
            retryLabel={t('reportsUsage.retry')}
            onRetry={() => void usage.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('reportsUsage.emptyTitle')}
            explanation={t('reportsUsage.emptyExplanation')}
          />
        ) : (
          <ul aria-label={t('reportsUsage.caption')} className="flex flex-col gap-3">
            {rows.map((row) => (
              <li
                key={row.report_key}
                className="rounded-lg border border-border-subtle bg-surface p-4 md:p-5"
              >
                <h2 className="text-h3">{nameOf(row.report_key)}</h2>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4 xl:grid-cols-7">
                  <Metric label={t('reportsUsage.columns.runs')} value={n(row.runs)} />
                  <Metric label={t('reportsUsage.columns.schools')} value={n(row.schools)} />
                  <Metric label={t('reportsUsage.columns.people')} value={n(row.unique_users)} />
                  <Metric
                    label={t('reportsUsage.columns.helpful')}
                    value={
                      row.helpful_pct === null
                        ? t('reportsUsage.helpfulNone')
                        : `${n(row.helpful_pct)}%`
                    }
                  />
                  <Metric label={t('reportsUsage.columns.slow')} value={n(row.too_slow)} />
                  <Metric label={t('reportsUsage.columns.empty')} value={n(row.empty_results)} />
                  <Metric
                    label={t('reportsUsage.columns.big')}
                    hint={t('reportsUsage.columnHelp.big')}
                    value={n(row.large_exports)}
                  />
                </dl>
                <div className="mt-3">
                  <h3 className="text-label text-text-secondary">
                    {t('reportsUsage.columns.comments')}
                  </h3>
                  {row.latest_comments.length === 0 ? (
                    <p className="text-text-secondary">{t('reportsUsage.noComments')}</p>
                  ) : (
                    <ul className="mt-1 flex list-disc flex-col gap-1 ps-5">
                      {/* Typed by a person: a text node, never HTML. */}
                      {row.latest_comments.map((comment, index) => (
                        <li key={index}>{comment}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-label text-text-secondary">{label}</dt>
      <dd className="text-h3 tabular-nums">{value}</dd>
      {hint && <dd className="text-caption text-text-secondary">{hint}</dd>}
    </div>
  );
}
