/**
 * [169.3-1871] `attendance-today` widget: full / compact / tile (D6, D16).
 * The hook feeds the pure `AttendanceTodayView`, which the stories render.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { ChartTableToggle, Sparkline, StatTile, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber, formatScore } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.ATTENDANCE_TODAY;

export type AttendanceTodayDto = components['schemas']['AttendanceTodayWidgetDto'];

const K = widgetKey;
/** Same default as the at-risk rule (monthlyAttendancePct); the DTO carries no tenant value (D9). */
const LOW_ATTENDANCE_PCT = 75;

function useAttendanceToday() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'attendance-today'],
    queryFn: async () =>
      (await apiClient.get<AttendanceTodayDto>('/dashboard/widgets/attendance-today')).data,
    ...dashboardQueryOptions,
  });
}

export interface AttendanceTodayViewProps {
  data?: AttendanceTodayDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  updatedLabel?: string;
}

export function AttendanceTodayView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
  updatedLabel,
}: AttendanceTodayViewProps) {
  const { t } = useTranslation(['dashboard', 'signal']);
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const pct = (v: number) => `${formatNumber(v, region, { decimals: 1 })}%`;

  const title = tw('title');
  const counts = data?.counts;
  const closed = data?.is_working_day === false;
  const empty =
    !!data &&
    !closed &&
    !!counts &&
    counts.present + counts.late + counts.absent + counts.leave === 0;

  const values = (data?.series ?? [])
    .map((s) => s.percentage)
    .filter((v): v is number => v != null);
  const min = values.length ? pct(Math.min(...values)) : '—';
  const max = values.length ? pct(Math.max(...values)) : '—';

  let summary: string | undefined;
  if (closed) summary = tw('closedToday');
  else if (data?.percentage != null && data.week_ago_percentage != null) {
    const diff = Math.round((data.percentage - data.week_ago_percentage) * 10) / 10;
    summary =
      diff === 0
        ? tw('vsWeekSame')
        : tw(diff > 0 ? 'vsWeekUp' : 'vsWeekDown', { diff: formatScore(Math.abs(diff), region) });
  }
  const value = !closed && data?.percentage != null ? pct(data.percentage) : undefined;

  const sparkLabel = tw('sparkLabel', { min, max });
  const spark = <Sparkline values={values} label={sparkLabel} showLastDot />;

  if (variant === 'tile' && data && value && !empty) {
    return (
      <StatTile label={tw('compactTitle')} value={value}>
        {spark}
      </StatTile>
    );
  }

  const pending = data?.pending_sections.length ?? 0;
  const low =
    !failed &&
    !closed &&
    !empty &&
    data?.percentage != null &&
    data.percentage < LOW_ATTENDANCE_PCT;
  const linkClass = 'text-primary underline';
  const body = data ? (
    <ChartTableToggle
      summary={tw('rangeSummary', { min, max })}
      table={{
        caption: title,
        columns: [t('widgets.common.colDate'), tw('colPercent')],
        rows: data.series.map((s) => [
          formatDate(s.date, region),
          s.percentage == null ? tw('noRegister') : pct(s.percentage),
        ]),
        numeric: [false, true],
      }}
      showTableLabel={t('widgets.common.showTable')}
      showChartLabel={t('widgets.common.showChart')}
    >
      <div className="flex flex-col gap-1">
        {spark}
        <div className="flex justify-between text-caption text-text-secondary">
          <span>{tw('axisStart')}</span>
          <span>{tw('axisEnd')}</span>
        </div>
      </div>
    </ChartTableToggle>
  ) : null;

  return (
    <WidgetCard
      title={variant === 'full' ? title : tw('compactTitle')}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(value ? { value } : {})}
      {...(summary ? { summary } : {})}
      {...(updatedLabel && variant === 'full' ? { updatedLabel } : {})}
      {...(low ? { signal: 'warn' as const, signalLabel: t('signal:watch') } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty
        ? {
            empty: {
              reason: tw('emptyReason'),
              action: (
                <Link to="/attendance" className={linkClass}>
                  {tw('emptyAction')}
                </Link>
              ),
            },
          }
        : {})}
      footer={
        data && !closed ? (
          <Link to="/attendance" className={linkClass}>
            {pending === 0 ? tw('allMarked') : tw('pendingLink', { count: pending })}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function AttendanceTodayWidget({ variant }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const q = useAttendanceToday();
  const minutes = q.dataUpdatedAt ? Math.floor((Date.now() - q.dataUpdatedAt) / 60_000) : null;
  const updatedLabel =
    minutes == null
      ? undefined
      : minutes < 1
        ? t('widgets.common.updatedJustNow')
        : t('widgets.common.updatedMinutes', { count: minutes });
  return (
    <AttendanceTodayView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
      {...(updatedLabel ? { updatedLabel } : {})}
    />
  );
}
