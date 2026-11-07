/**
 * [169.3-1875] `mark-entry-progress` widget: full + compact, no phone tile.
 * One bar per class with the furthest-behind class emphasised. The deadline
 * line shows only when the server sent one.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { BarWidget, ChartTableToggle, type SignalLevel, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber, parseServerDate, tenantTodayIso } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.MARK_ENTRY_PROGRESS;

export type MarkEntryProgressDto = components['schemas']['MarkEntryProgressWidgetDto'];

const K = widgetKey;

function useMarkEntryProgress() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'mark-entry-progress'],
    queryFn: async () =>
      (await apiClient.get<MarkEntryProgressDto>('/dashboard/widgets/mark-entry-progress')).data,
    ...dashboardQueryOptions,
  });
}

export interface MarkEntryViewProps {
  data?: MarkEntryProgressDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function MarkEntryView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: MarkEntryViewProps) {
  const { t } = useTranslation('dashboard');
  useTranslation('signal'); // [#3592] separate binding: check-i18n-keys reads the first single-quoted call
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const pct = (v: number) => `${formatNumber(v, region)}%`;
  const linkClass = 'text-primary underline';
  const full = variant === 'full';

  const title = tw('title');
  const empty = !!data && (data.classes.length === 0 || data.overall.total === 0);
  const lowest = data?.classes.find((c) => c.class_id === data.lowest_class_id);
  const highest = data?.classes.reduce<(typeof data.classes)[number] | undefined>(
    (best, c) => (!best || c.percentage > best.percentage ? c : best),
    undefined,
  );

  let deadline: string | undefined;
  let daysLeft: number | undefined;
  if (data?.mark_entry_deadline) {
    const day = parseServerDate(data.mark_entry_deadline);
    const today = parseServerDate(tenantTodayIso(region));
    const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
    const date = formatDate(day, region);
    daysLeft = days;
    deadline = days < 0 ? tw('deadlinePassed', { date }) : tw('deadlineIn', { count: days, date });
  }

  // [#3598] done = healthy; past the deadline = needs action; within 3 days = watch (D9).
  let signal: { level: SignalLevel; key: string } | undefined;
  if (data && !empty) {
    if (data.overall.percentage >= 100) signal = { level: 'ok', key: 'done' };
    else if (daysLeft !== undefined && daysLeft < 0)
      signal = { level: 'critical', key: 'pastDeadline' };
    else if (daysLeft !== undefined && daysLeft <= 3)
      signal = { level: 'warn', key: 'approaching' };
  }

  const behind = lowest ? tw('furthestBehind', { class: lowest.class_name }) : undefined;
  const summary = [behind, full ? deadline : undefined].filter(Boolean).join(' ') || undefined;
  const value = data
    ? full
      ? pct(data.overall.percentage)
      : tw('compactValue', { percent: pct(data.overall.percentage) })
    : undefined;

  const body =
    data && full && !empty ? (
      <ChartTableToggle
        summary={
          lowest && highest
            ? tw('summary', {
                low: lowest.class_name,
                lowPct: pct(lowest.percentage),
                high: highest.class_name,
                highPct: pct(highest.percentage),
              })
            : title
        }
        table={{
          caption: title,
          columns: [t('widgets.common.colClass'), tw('colSubmitted')],
          rows: data.classes.map((c) => [c.class_name, pct(c.percentage)]),
          numeric: [false, true],
        }}
        showTableLabel={t('widgets.common.showTable')}
        showChartLabel={t('widgets.common.showChart')}
      >
        <BarWidget
          bare
          emphasis="highlighted"
          emptyLabel={tw('emptyReason')}
          bars={data.classes.map((c) => ({
            label: c.class_name,
            value: c.percentage,
            valueLabel: pct(c.percentage),
            highlight: c.class_id === data.lowest_class_id,
          }))}
        />
      </ChartTableToggle>
    ) : null;

  return (
    <WidgetCard
      title={data?.exam_name ?? title}
      variant={full ? 'full' : 'compact'}
      {...(value && !empty ? { value } : {})}
      {...(summary && !empty ? { summary } : {})}
      {...(signal && !failed
        ? { signal: signal.level, signalLabel: t(`signal:${signal.key}`) }
        : {})}
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
                <Link to="/marks" className={linkClass}>
                  {tw('emptyAction')}
                </Link>
              ),
            },
          }
        : {})}
      footer={
        data && !empty ? (
          <Link to="/marks" className={linkClass}>
            {tw('link', { class: lowest?.class_name ?? '' })}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function MarkEntryProgressWidget({ variant }: WidgetProps) {
  const q = useMarkEntryProgress();
  return (
    <MarkEntryView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
