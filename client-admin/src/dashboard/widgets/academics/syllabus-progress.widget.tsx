/**
 * [169.3-1875] `syllabus-progress` widget: full + compact, no phone tile.
 * [8.10.7.7.04] The dashed "expected by today" marker and the "N classes behind" line appear
 * once any class has a study plan; otherwise the muted `noPace` line stays.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { BarWidget, ChartTableToggle, type SignalLevel, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.SYLLABUS_PROGRESS;

export type SyllabusProgressDto = components['schemas']['SyllabusProgressWidgetDto'];

const K = widgetKey;

function useSyllabusProgress() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'syllabus-progress'],
    queryFn: async () =>
      (await apiClient.get<SyllabusProgressDto>('/dashboard/widgets/syllabus-progress')).data,
    ...dashboardQueryOptions,
  });
}

export interface SyllabusViewProps {
  data?: SyllabusProgressDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function SyllabusView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: SyllabusViewProps) {
  const { t } = useTranslation(['dashboard', 'signal']);
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const pct = (v: number) => `${formatNumber(v, region)}%`;
  const linkClass = 'text-primary underline';
  const full = variant === 'full';

  const title = tw('title');
  const empty = !!data && (data.classes.length === 0 || data.overall.total === 0);
  const least = data?.classes.reduce<(typeof data.classes)[number] | undefined>(
    (low, c) => (!low || c.percentage < low.percentage ? c : low),
    undefined,
  );
  const average = data ? tw('average', { percent: pct(data.overall.percentage) }) : undefined;
  const leastText = least
    ? tw('leastCovered', { class: least.class_name, percent: pct(least.percentage) })
    : undefined;
  // BarWidget draws one marker for every bar, so it shows the mean expected % of planned classes.
  const planned = data?.classes.filter((c) => c.expected_percentage != null) ?? [];
  const expected = planned.length
    ? Math.round(planned.reduce((n, c) => n + (c.expected_percentage ?? 0), 0) / planned.length)
    : undefined;
  const isBehind = (c: NonNullable<typeof data>['classes'][number]) =>
    c.expected_percentage != null && c.expected_percentage > c.percentage;
  const paceText =
    expected === undefined || !data
      ? tw('noPace')
      : data.behind_count > 0
        ? tw('behindClasses', { count: data.behind_count })
        : tw('onPace');
  // [#3598] behind the expected pace = watch, on pace = healthy; no study plan = no signal (D9).
  const signal: { level: SignalLevel; key: string } | undefined =
    !data || empty || expected === undefined
      ? undefined
      : data.behind_count > 0
        ? { level: 'warn', key: 'behind' }
        : { level: 'ok', key: 'onTrack' };
  const summary = full ? leastText : [average, leastText].filter(Boolean).join(' ');

  const body =
    data && full && !empty ? (
      <div className="flex flex-col gap-2">
        <ChartTableToggle
          summary={average ?? title}
          table={{
            caption: title,
            columns: [
              t('widgets.common.colClass'),
              tw('colCovered'),
              tw('colExpected'),
              tw('colGap'),
            ],
            rows: data.classes.map((c) => [
              c.class_name,
              pct(c.percentage),
              c.expected_percentage == null ? '–' : pct(c.expected_percentage),
              isBehind(c) ? pct((c.expected_percentage ?? 0) - c.percentage) : '–',
            ]),
            numeric: [false, true, true, true],
          }}
          showTableLabel={t('widgets.common.showTable')}
          showChartLabel={t('widgets.common.showChart')}
        >
          <BarWidget
            bare
            emptyLabel={tw('emptyReason')}
            {...(expected !== undefined
              ? {
                  emphasis: 'highlighted' as const,
                  target: {
                    value: expected,
                    label: tw('expectedMarker', { percent: pct(expected) }),
                  },
                }
              : {})}
            bars={data.classes.map((c) => ({
              label: c.class_name,
              value: c.percentage,
              valueLabel: pct(c.percentage),
              ...(isBehind(c)
                ? {
                    highlight: true,
                    note: tw('gap', { percent: pct((c.expected_percentage ?? 0) - c.percentage) }),
                  }
                : {}),
            }))}
          />
        </ChartTableToggle>
        <p className="text-caption text-text-secondary">{paceText}</p>
      </div>
    ) : null;

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty ? { value: pct(data.overall.percentage) } : {})}
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
                <Link to="/academics/syllabus" className={linkClass}>
                  {tw('emptyAction')}
                </Link>
              ),
            },
          }
        : {})}
      footer={
        data && !empty ? (
          <Link to="/academics/syllabus" className={linkClass}>
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function SyllabusProgressWidget({ variant }: WidgetProps) {
  const q = useSyllabusProgress();
  return (
    <SyllabusView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
