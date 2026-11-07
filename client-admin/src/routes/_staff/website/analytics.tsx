/**
 * [40.5.04] Website › Visitors: pageviews and visitors for the last 30 days, as two plain numbers
 * (no chart library). The numbers come from the analytics service; when it is off or down the
 * server answers `{ available: false }` and the tab says so instead of showing zeros.
 */
import { Card, EmptyState, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useWebsiteAnalytics } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { ChartNoAxesColumnIcon } from 'lucide-react';

import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/website/analytics')({
  loader: () => loadRouteNamespaces('website', 'common'),
  component: WebsiteAnalytics,
});

function WebsiteAnalytics() {
  const { t } = useTranslation('website');
  const region = useTenantRegionConfig();
  const analytics = useWebsiteAnalytics();

  if (analytics.isPending) return <Skeleton className="h-32 w-full" />;
  if (analytics.isError) {
    return (
      <ErrorState
        message={t('analytics.loadError')}
        retryLabel={t('address.own.check')}
        onRetry={() => void analytics.refetch()}
      />
    );
  }
  const data = analytics.data;
  if (!data.available) {
    return (
      <EmptyState
        icon={<ChartNoAxesColumnIcon aria-hidden="true" />}
        title={t('analytics.off.title')}
        explanation={t('analytics.off.body')}
      />
    );
  }
  if (!data.visitors && !data.pageviews) {
    return (
      <EmptyState
        icon={<ChartNoAxesColumnIcon aria-hidden="true" />}
        title={t('analytics.empty')}
        explanation={t('analytics.subtitle')}
      />
    );
  }
  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5">
      <h2 className="text-h3">
        {t('analytics.title')} · {t('analytics.subtitle')}
      </h2>
      <dl className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <dt className="text-caption text-text-secondary">{t('analytics.visitors')}</dt>
          <dd className="text-end text-h2">{formatNumber(data.visitors, region)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-caption text-text-secondary">{t('analytics.pageviews')}</dt>
          <dd className="text-end text-h2">{formatNumber(data.pageviews, region)}</dd>
        </div>
      </dl>
    </Card>
  );
}
