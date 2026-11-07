/**
 * [8.10.7.7.01] `approvals-pending` widget (ADMIN, EXECUTIVE): applications waiting for
 * THIS caller's decision, split by type, each type linking to the inbox filtered to it.
 * Counts only; no names. The server count is the inbox predicate, so card equals inbox.
 */
import { DashboardWidgetKey, type ApplicationType } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { StatTile, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, renderDigits, formatRelativeAge } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.APPROVALS_PENDING;

export type PendingCountDto = components['schemas']['PendingCountDto'];

const K = widgetKey;

function useApprovalsPending() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'approvals-pending'],
    queryFn: async ({ signal }) =>
      (await apiClient.get<PendingCountDto>('/dashboard/widgets/approvals-pending', { signal }))
        .data,
    ...dashboardQueryOptions,
  });
}

export interface ApprovalsPendingViewProps {
  data?: PendingCountDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function ApprovalsPendingView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: ApprovalsPendingViewProps) {
  const { t } = useTranslation('dashboard');
  useTranslation('applications'); // [#3592] load namespace before first render
  useTranslation('signal'); // [#3592] separate binding: check-i18n-keys reads the first single-quoted call
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) =>
    t(`dashboard:widgets.${K}.${key}`, opts);
  const title = tw('title');
  const full = variant === 'full';

  const oldest = data?.oldest_pending_at
    ? tw('oldest', {
        ago: renderDigits(
          formatRelativeAge(new Date(data.oldest_pending_at).getTime(), region.locale),
          region.numerals,
        ),
      })
    : '';

  // Computed before the tile return so the phone tile carries the same signal (#3594).
  const urgentSignal =
    !data || failed
      ? {}
      : data.total > 0
        ? { signal: 'critical' as const, signalLabel: t('needsAction', { ns: 'signal' }) }
        : { signal: 'ok' as const, signalLabel: t('healthy', { ns: 'signal' }) };

  if (variant === 'tile' && data && !failed) {
    return (
      <StatTile
        label={tw('tileLabel')}
        value={formatNumber(data.total, region)}
        note={oldest || tw('none')}
        {...urgentSignal}
      />
    );
  }

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data ? { value: tw('value', { count: data.total }) } : {})}
      {...(data ? { summary: data.total === 0 ? tw('none') : oldest } : {})}
      {...urgentSignal}
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
      footer={
        data ? (
          <Link to="/applications" search={{ view: 'inbox' }} className="text-primary underline">
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {data && data.by_type.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {data.by_type.map((row) => (
            <li key={row.type} className="flex items-center justify-between gap-2">
              <Link
                to="/applications"
                search={{ view: 'inbox', type: row.type as ApplicationType }}
                className="text-primary underline"
              >
                {t(`applications:types.${row.type}`)}
              </Link>
              <span className="tabular-nums">{formatNumber(row.count, region)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </WidgetCard>
  );
}

export default function ApprovalsPendingWidget({ variant }: WidgetProps) {
  const q = useApprovalsPending();
  return (
    <ApprovalsPendingView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
