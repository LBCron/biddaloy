/** [52.5.4] Application reports: totals, waiting, on leave today, by type/month, staff leave days. */
import { EmptyState, ErrorState } from '@biddaloy/ui/components';
import { useAcademicYears, useApplicationReports } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import { formatDate, formatDateRange, formatNumber } from '@biddaloy/ui/utils';
import { getRouteApi } from '@tanstack/react-router';

import {
  MonthTable,
  OnLeaveToday,
  StaffLeaveTable,
  StalePendingTable,
  TypeStatusTable,
} from './report-tables';

const route = getRouteApi('/_staff/applications/reports');

export function ApplicationsReports() {
  const { t } = useTranslation('applicationsReports');
  const { t: tNav } = useTranslation('nav');
  const config = useRegionConfig();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const years = useAcademicYears({ limit: 100 }).data?.data ?? [];
  const current = years.find((y) => y.is_current) ?? years[0];
  const year = years.find((y) => y.id === search.academic_year_id) ?? current;

  const filters: Record<string, string> = {};
  if (search.academic_year_id) filters.academic_year_id = search.academic_year_id;
  if (search.from) filters.from = search.from;
  if (search.to) filters.to = search.to;
  const hasFilter = Object.keys(filters).length > 0;

  const yearApplies = Boolean(search.academic_year_id) || !(search.from || search.to);
  const query = useApplicationReports(filters);
  const report = query.data;

  const fields: readonly FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'academic_year_id',
      label: t('filterYear'),
      helpId: 'reports.applications.field.academicYear',
      // Dates with no year: the server counts every year, so say so.
      allLabel: !(search.from || search.to)
        ? t('filterCurrentYear', { name: current?.name ?? '' })
        : t('filterAllYears'),
      options: years.map((y) => ({ value: y.id, label: y.name })),
    },
    {
      kind: 'date-range',
      fromKey: 'from',
      toKey: 'to',
      label: t('filterSubmitted'),
      helpId: 'reports.applications.field.submitted',
      fromLabel: t('filterFrom'),
      toLabel: t('filterTo'),
    },
  ];
  const setFilters = (patch: Record<string, string | null>) =>
    void navigate({
      search: (p) => ({
        ...p,
        ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v ?? undefined])),
      }),
      replace: true,
    });

  const sum = (...statuses: string[]) =>
    (report?.by_type_status ?? [])
      .filter((r) => statuses.length === 0 || statuses.includes(r.status))
      .reduce((n, r) => n + r.count, 0);
  const total = sum();
  const fmt = (n: number) => formatNumber(n, config);
  const pct = (n: number) => (total ? fmt(Math.round((n * 100) / total)) : '—');
  const tiles = [
    {
      label: t('tileSubmitted'),
      value: report && fmt(total),
      // #3059: dates alone count every year, so "this academic year" would be wrong.
      detail: t(yearApplies ? 'tileSubmittedCaption' : 'tileSubmittedCaptionDates'),
    },
    {
      label: t('tileApproved'),
      value: report && fmt(sum('APPROVED')),
      detail: t('tilePct', { pct: pct(sum('APPROVED')) }),
    },
    {
      label: t('tileRejected'),
      value: report && fmt(sum('REJECTED')),
      detail: t('tilePct', { pct: pct(sum('REJECTED')) }),
    },
    {
      label: t('tileAvgDecision'),
      value:
        report &&
        (report.avg_decision_hours === null
          ? '—'
          : t('hours', { n: formatNumber(report.avg_decision_hours, config, { decimals: 1 }) })),
    },
  ];

  const range =
    search.from && search.to
      ? formatDateRange(search.from, search.to, config)
      : search.from
        ? t('rangeFrom', { date: formatDate(search.from, config) })
        : search.to
          ? t('rangeTo', { date: formatDate(search.to, config) })
          : undefined;
  const subtitle =
    [yearApplies && year ? t('subtitle', { year: year.name }) : undefined, range]
      .filter(Boolean)
      .join(' · ') || undefined;

  return (
    <PageContainer>
      <PageHeader title={tNav('items.applicationsReportsNav')} subtitle={subtitle} />
      <FilterBar fields={fields} values={filters} onChange={setFilters} />
      {query.isError ? (
        <ErrorState message={t('errorMessage')} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <dl
            aria-label={t('tilesLabel')}
            aria-busy={query.isLoading}
            className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4"
          >
            {tiles.map(({ label, value, detail }) => (
              <div
                key={label}
                className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
              >
                <dt className="text-label text-text-secondary">{label}</dt>
                {value === undefined ? (
                  <dd className="mt-2 block h-7 w-12 rounded-sm bg-muted" />
                ) : (
                  <dd className="mt-1 text-h1 tabular-nums">{value}</dd>
                )}
                {detail && <dd className="mt-0.5 text-caption text-text-secondary">{detail}</dd>}
              </div>
            ))}
          </dl>
          {report && total === 0 ? (
            <EmptyState
              title={t('emptyTitle')}
              explanation={t('emptyExplanation')}
              {...(hasFilter
                ? {
                    secondaryAction: {
                      label: t('clearFilters'),
                      onClick: () => setFilters({ academic_year_id: null, from: null, to: null }),
                    },
                  }
                : {})}
            />
          ) : (
            <>
              <StalePendingTable rows={report?.stale_pending} loading={query.isLoading} />
              <div className="grid gap-6 lg:grid-cols-2">
                <TypeStatusTable rows={report?.by_type_status} loading={query.isLoading} />
                <MonthTable rows={report?.by_month} loading={query.isLoading} />
              </div>
            </>
          )}
          {/* From leave_records, which holds pre-cut-over leave too: shown even with no applications. */}
          <OnLeaveToday data={report?.on_leave_today} />
          <StaffLeaveTable rows={report?.staff_leave_days} loading={query.isLoading} />
        </>
      )}
    </PageContainer>
  );
}
