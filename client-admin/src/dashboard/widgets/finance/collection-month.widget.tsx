/**
 * [169.3-1873] `collection-month` widget: full / compact / tile. Shows the
 * server's money figures as given; the only client arithmetic is the
 * percentage-point difference (D25: a missing last year shows "—").
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import {
  ChartTableToggle,
  type SignalLevel,
  Meter,
  StatTile,
  WidgetCard,
} from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatServerAmount } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.COLLECTION_MONTH;

export type CollectionMonthDto = components['schemas']['CollectionMonthWidgetDto'];

const K = widgetKey;

function useCollectionMonth() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'collection-month'],
    queryFn: async () =>
      (await apiClient.get<CollectionMonthDto>('/dashboard/widgets/collection-month')).data,
    ...dashboardQueryOptions,
  });
}

export interface CollectionMonthViewProps {
  data?: CollectionMonthDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function CollectionMonthView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: CollectionMonthViewProps) {
  const { t } = useTranslation('dashboard');
  useTranslation('signal'); // [#3592] separate binding: check-i18n-keys reads the first single-quoted call
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const pct = (v: number) => `${formatNumber(v, region)}%`;
  const amount = (v: number) => formatServerAmount(v, region);
  const linkClass = 'text-primary underline';

  const title = tw('title');
  const empty = !!data && data.billed_for_month === 0;
  const lm = data?.last_month_same_point ?? null;
  const ly = data?.last_year_same_point ?? null;
  const diff =
    data?.received_pct != null && lm?.received_pct != null
      ? data.received_pct - lm.received_pct
      : null;
  const diffText = diff == null ? '' : formatNumber(Math.abs(diff), region);
  // ponytail: 10+ points behind last month's pace = "well behind"; tune with product.
  const level: SignalLevel | undefined =
    empty || failed || diff == null
      ? undefined
      : diff <= -10
        ? 'critical'
        : diff < 0
          ? 'warn'
          : 'ok';
  const value = data?.received_pct != null ? pct(data.received_pct) : undefined;

  const delta = diff == null ? undefined : tw('compactDelta', { diff: diffText });

  if (variant === 'tile' && data && value && !empty) {
    return (
      <StatTile
        label={tw('compactTitle')}
        value={value}
        {...(diff != null && delta
          ? {
              trend: {
                direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
                text: delta,
                tone: diff > 0 ? 'good' : diff < 0 ? 'bad' : 'neutral',
              },
            }
          : {})}
      />
    );
  }

  const received = data ? amount(data.received) : '';
  const body = data ? (
    <div className="flex flex-col gap-2">
      <ChartTableToggle
        summary={tw('target', { amount: amount(data.billed_for_month) })}
        table={{
          caption: title,
          columns: [tw('colFigure'), tw('colAmount')],
          rows: [
            [tw('rowReceived'), received],
            [tw('rowBilled'), amount(data.billed_for_month)],
            [tw('rowLastMonth'), lm ? amount(lm.received) : '—'],
            [tw('rowLastYear'), ly ? amount(ly.received) : '—'],
          ],
          numeric: [false, true],
        }}
        showTableLabel={t('widgets.common.showTable')}
        showChartLabel={t('widgets.common.showChart')}
      >
        <Meter
          label={tw('meterLabel')}
          value={data.received_pct ?? 0}
          max={100}
          valueText={pct(data.received_pct ?? 0)}
          endText={tw('target', { amount: amount(data.billed_for_month) })}
          {...(lm?.received_pct != null
            ? {
                marker: {
                  value: lm.received_pct,
                  label: tw('lastMonthMarker', { percent: pct(lm.received_pct) }),
                },
              }
            : {})}
        />
      </ChartTableToggle>
      <p className="text-caption text-text-secondary">
        {ly ? tw('lastYear', { amount: amount(ly.received) }) : tw('lastYearNone')}
      </p>
    </div>
  ) : null;

  const summary =
    variant === 'full'
      ? diff
        ? tw(diff > 0 ? 'ahead' : 'behind', { diff: diffText })
        : undefined
      : delta;

  return (
    <WidgetCard
      title={variant === 'full' ? title : tw('compactTitle')}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(data && !empty ? { value: variant === 'full' ? received : (value ?? received) } : {})}
      {...(summary && !empty ? { summary } : {})}
      loading={loading}
      {...(level
        ? {
            signal: level,
            signalLabel: t(
              `signal:${level === 'ok' ? (diff! > 0 ? 'ahead' : 'onTrack') : level === 'warn' ? 'behind' : 'needsAction'}`,
            ),
          }
        : {})}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty
        ? {
            empty: {
              reason: tw('emptyReason'),
              action: (
                <Link to="/fees/generate" className={linkClass}>
                  {tw('emptyAction')}
                </Link>
              ),
            },
          }
        : {})}
      footer={
        data ? (
          <Link to="/fees/dues" className={linkClass}>
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function CollectionMonthWidget({ variant }: WidgetProps) {
  const q = useCollectionMonth();
  return (
    <CollectionMonthView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
