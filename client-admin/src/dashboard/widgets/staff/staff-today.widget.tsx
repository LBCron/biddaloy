/**
 * [169.3-1872] `staff-today` widget: full + compact, no phone tile.
 * Never shows the profile id or the raw leave-type enum (P4).
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.STAFF_TODAY;

export type StaffTodayDto = components['schemas']['StaffTodayWidgetDto'];

const K = widgetKey;

function useStaffToday() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'staff-today'],
    queryFn: async () =>
      (await apiClient.get<StaffTodayDto>('/dashboard/widgets/staff-today')).data,
    ...dashboardQueryOptions,
  });
}

export interface StaffTodayViewProps {
  data?: StaffTodayDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function StaffTodayView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: StaffTodayViewProps) {
  // One array call: the namespaces load in parallel. Every t() names its ns explicitly.
  const { t } = useTranslation(['dashboard', 'leave', 'signal']);
  const region = useTenantRegionConfig();
  const tw = (key: string, opts?: Record<string, unknown>) =>
    t(`widgets.${K}.${key}`, { ns: 'dashboard', ...opts });
  const n = (v: number) => formatNumber(v, region);
  const compact = variant !== 'full';
  const title = tw('title');
  const linkClass = 'text-primary underline';

  const empty = !!data && data.unmarked === data.staff_total;
  const value = data
    ? tw('value', { present: n(data.present + data.late), total: n(data.staff_total) })
    : undefined;
  const summary = data
    ? tw(data.absent_without_leave === 0 ? 'sentenceNoAbsent' : 'sentence', {
        onLeave: n(data.leave),
        absent: n(data.absent_without_leave),
      })
    : undefined;

  const watch = !failed && !!data && !empty && data.absent_without_leave > 0;

  return (
    <WidgetCard
      title={title}
      variant={compact ? 'compact' : 'full'}
      {...(value && !empty ? { value } : {})}
      {...(summary && !empty ? { summary } : {})}
      {...(watch ? { signal: 'warn' as const, signalLabel: t('watch', { ns: 'signal' }) } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { ns: 'dashboard', title })}
      {...(failed && onRetry
        ? {
            error: {
              message: t('states.error', { ns: 'dashboard' }),
              retryLabel: t('states.retry', { ns: 'dashboard' }),
              onRetry,
            },
          }
        : {})}
      {...(empty
        ? {
            empty: {
              reason: tw('emptyReason'),
              action: (
                <Link to="/attendance/staff" className={linkClass}>
                  {tw('emptyAction')}
                </Link>
              ),
            },
          }
        : {})}
      footer={
        data ? (
          <Link to="/attendance/staff" className={linkClass}>
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {data ? (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {data.on_leave.slice(0, compact ? 3 : 5).map((s) => (
            <li key={s.staff_profile_id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 truncate">{s.full_name}</span>
              <span className="flex flex-col items-end text-caption text-text-secondary">
                <span>{t(`type.${s.leave_type}`, { ns: 'leave' })}</span>
                <span>{tw('untilDate', { date: formatDate(s.end_date, region) })}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </WidgetCard>
  );
}

export default function StaffTodayWidget({ variant }: WidgetProps) {
  const q = useStaffToday();
  return (
    <StaffTodayView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
