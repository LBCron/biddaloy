/**
 * [169.3-1874] `at-risk-students` widget (D7, D24): the list is precomputed
 * nightly, the client only shows it. One DOM for every width: a table from
 * `md` up, stacked cards below it (3 rows before "See all", D16).
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { Button, StatTile, StatusBadge, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatTime } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { InfoIcon } from 'lucide-react';
import * as React from 'react';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

import { SignalChip } from './signal-chip';

export const widgetKey = DashboardWidgetKey.AT_RISK_STUDENTS;

export type AtRiskDto = components['schemas']['AtRiskStudentsWidgetDto'];

const K = widgetKey;
const DESKTOP_ROWS = 5;
const PHONE_ROWS = 3;

function useAtRiskStudents() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'at-risk-students'],
    queryFn: async () =>
      (
        await apiClient.get<AtRiskDto>('/dashboard/widgets/at-risk-students', {
          params: { limit: 200 },
        })
      ).data,
    ...dashboardQueryOptions,
  });
}

export interface AtRiskViewProps {
  data?: AtRiskDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  /** Stories: start with every row showing. */
  defaultExpanded?: boolean;
}

export function AtRiskView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
  defaultExpanded = false,
}: AtRiskViewProps) {
  const { t } = useTranslation(['dashboard', 'signal']);
  const region = useTenantRegionConfig();
  const [showAll, setShowAll] = React.useState(defaultExpanded);
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const n = (v: number) => formatNumber(v, region);
  const title = tw('title');
  const linkClass = 'text-primary underline';

  const ready = data?.state === 'READY';
  const empty = !!data && ready && data.total === 0;
  const diff = data?.week_ago_total != null ? data.total - data.week_ago_total : null;
  const trend =
    diff == null || diff === 0
      ? undefined
      : tw(diff > 0 ? 'moreThanLastWeek' : 'fewerThanLastWeek', { diff: n(Math.abs(diff)) });
  const summary = data && !ready ? tw('computing') : trend;
  const value =
    data && ready ? tw('value', { count: data.total, value: n(data.total) }) : undefined;

  if (variant === 'tile' && data && ready && !empty) {
    return (
      <StatTile
        label={title}
        value={n(data.total)}
        {...(diff != null && trend
          ? {
              trend: {
                direction: diff > 0 ? 'up' : 'down',
                text: trend,
                tone: diff > 0 ? 'bad' : 'good',
              },
            }
          : {})}
      />
    );
  }

  const students = data?.students ?? [];
  const canToggle = students.length > PHONE_ROWS;
  const shown = showAll ? students : students.slice(0, DESKTOP_ROWS);
  const body =
    data && ready ? (
      <div className="flex flex-col gap-3">
        {data.stale ? <StatusBadge tone="warning" label={tw('stale')} /> : null}
        <table className="w-full text-body">
          <caption className="sr-only">{title}</caption>
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-border-subtle text-label">
              <th scope="col" className="px-2 py-1 text-left font-medium">
                {tw('colStudent')}
              </th>
              <th scope="col" className="px-2 py-1 text-left font-medium">
                {t('widgets.common.colClass')}
              </th>
              <th scope="col" className="px-2 py-1 text-left font-medium">
                {tw('colSignals')}
              </th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group">
            {shown.map((s, i) => (
              <tr
                key={s.student_id}
                className={
                  'flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border-subtle py-2 last:border-0 md:table-row' +
                  (!showAll && i >= PHONE_ROWS ? ' hidden md:table-row' : '')
                }
              >
                <td className="font-medium md:table-cell md:px-2 md:py-2">{s.full_name}</td>
                <td className="text-text-secondary md:table-cell md:px-2 md:py-2">
                  {`${s.class_name}, ${s.section_name}`}
                </td>
                <td className="basis-full md:table-cell md:basis-auto md:px-2 md:py-2">
                  <span className="flex flex-wrap gap-1">
                    {s.signals.map((sig) => (
                      <SignalChip key={sig.kind} signal={sig} />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="flex items-center gap-1 text-caption text-text-secondary">
          <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
          {tw('rule')}
        </p>
        {canToggle ? (
          <Button
            variant="ghost"
            className={
              'min-h-11 self-start md:min-h-0' +
              (students.length <= DESKTOP_ROWS ? ' md:hidden' : '')
            }
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? tw('showFewer') : tw('seeAll', { count: n(students.length) })}
          </Button>
        ) : null}
      </div>
    ) : null;

  const sigOn = !failed && ready && !empty && !!data;

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(value && !empty ? { value } : {})}
      {...(summary && !empty ? { summary } : {})}
      {...(data?.computed_at && variant === 'full'
        ? { updatedLabel: tw('computedAt', { time: formatTime(data.computed_at, region) }) }
        : {})}
      {...(sigOn ? { signal: 'critical' as const, signalLabel: t('signal:needsAction') } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty
        ? {
            empty: {
              reason: tw('emptyReason'),
              // ponytail: section=dashboard arrives with 2-12; plain /settings until then.
              action: (
                <Link to="/settings" className={linkClass}>
                  {tw('emptyAction')}
                </Link>
              ),
            },
          }
        : {})}
    >
      {body}
    </WidgetCard>
  );
}

export default function AtRiskStudentsWidget({ variant }: WidgetProps) {
  const q = useAtRiskStudents();
  return (
    <AtRiskView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
