/**
 * [169.3-1876] `failed-messages` widget (ADMIN, D8 — visibility is the
 * registry's job). 0 is a value, not an empty state.
 */
import { CommunicationMedium, CommunicationStatus, DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { StatusBadge, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.FAILED_MESSAGES;

export type FailedMessagesDto = components['schemas']['FailedMessagesWidgetDto'];

const K = widgetKey;

function useFailedMessages() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'failed-messages'],
    queryFn: async () =>
      (await apiClient.get<FailedMessagesDto>('/dashboard/widgets/failed-messages')).data,
    ...dashboardQueryOptions,
  });
}

export interface FailedMessagesViewProps {
  data?: FailedMessagesDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function FailedMessagesView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: FailedMessagesViewProps) {
  const { t } = useTranslation(['dashboard', 'signal']);
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const title = tw('title');
  const some = !!data && data.failed > 0;

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(data
        ? { value: tw('value', { count: data.failed, value: formatNumber(data.failed, region) }) }
        : {})}
      {...(data && !some ? { summary: tw('none') } : {})}
      loading={loading}
      {...(data && !failed
        ? {
            signal: some ? 'critical' : 'ok',
            signalLabel: t(`signal:${some ? 'needsAction' : 'healthy'}`),
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
            // The window the count covers, so the list shows the same messages.
            search={{
              medium: CommunicationMedium.SMS,
              status: CommunicationStatus.FAILED,
              from_date: data.window.from,
            }}
            className="text-primary underline"
          >
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {some ? <StatusBadge tone="warning" label={tw('sentence')} /> : null}
    </WidgetCard>
  );
}

export default function FailedMessagesWidget({ variant }: WidgetProps) {
  const q = useFailedMessages();
  return (
    <FailedMessagesView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
