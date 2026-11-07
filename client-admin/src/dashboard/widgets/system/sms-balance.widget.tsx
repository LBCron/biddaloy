/**
 * [169.3-1876] `sms-balance` widget (ADMIN, D8 — visibility is the registry's
 * job). `metering: OFF` shows "not metered", never 0.
 */
import { CommunicationMedium, DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { WidgetCard, type SignalLevel } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.SMS_BALANCE;

export type SmsBalanceDto = components['schemas']['SmsBalanceWidgetDto'];

const K = widgetKey;
/** Server default of `smsCreditLowThreshold`. The school's own value is in the ADMIN-only
 * settings read (SETTINGS_MANAGE), which EXECUTIVE cannot call, and D9 adds no DTO field. */
const SMS_LOW = 200;

function useSmsBalance() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'sms-balance'],
    queryFn: async () =>
      (await apiClient.get<SmsBalanceDto>('/dashboard/widgets/sms-balance')).data,
    ...dashboardQueryOptions,
  });
}

export interface SmsBalanceViewProps {
  data?: SmsBalanceDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function SmsBalanceView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: SmsBalanceViewProps) {
  const { t } = useTranslation('dashboard');
  useTranslation('signal'); // [#3592] separate binding: check-i18n-keys reads the first single-quoted call
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  // `count` picks the plural; `value` is the grouped display (১,২৪০).
  const n = (v: number) => formatNumber(v, region);
  const title = tw('title');
  const metered = !!data && data.metering !== 'OFF';
  // ponytail: no `ok` level — the school may set its low mark above 200, and "All good" must not
  // contradict its own sms_credit_low alert. Add `ok` once the DTO carries the school's threshold.
  const level: SignalLevel | undefined =
    !metered || failed
      ? undefined
      : data.available <= 0
        ? 'critical'
        : data.available < SMS_LOW
          ? 'warn'
          : undefined;

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(metered
        ? { value: tw('value', { count: data.available, value: n(data.available) }) }
        : {})}
      {...(data && !metered ? { summary: tw('notMetered') } : {})}
      {...(metered && data.reserved > 0
        ? { summary: tw('reserved', { value: n(data.reserved) }) }
        : {})}
      loading={loading}
      {...(level
        ? {
            signal: level,
            signalLabel: t(`signal:${level === 'warn' ? 'low' : 'needsAction'}`),
          }
        : {})}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      footer={
        data ? (
          <Link
            to="/communications/message-log"
            search={{ medium: CommunicationMedium.SMS }}
            className="text-primary underline"
          >
            {tw('link')}
          </Link>
        ) : undefined
      }
    />
  );
}

export default function SmsBalanceWidget({ variant }: WidgetProps) {
  const q = useSmsBalance();
  return (
    <SmsBalanceView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
