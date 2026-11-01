/** [53.4.01] `/portal/notices/$noticeId` — one notice, full page (shared links, push). Gated in `portal.tsx`. */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';

import { MyNoticeDetail } from '../../../features/notices/read/my-notice-detail';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/portal/notices/$noticeId')({
  loader: () => loadRouteNamespaces('portal', 'portalNotices'),
  pendingComponent: PortalNoticePending,
  component: PortalNoticePage,
});

function PortalNoticePage() {
  const { noticeId } = Route.useParams();
  const { t } = useTranslation('nav');
  // The page's h1: the detail's own heading is the notice title (an h2, it is also shown in a dialog).
  return (
    <PageContainer>
      <PageHeader title={t('items.portalNotices')} />
      <MyNoticeDetail id={noticeId} />
    </PageContainer>
  );
}

function PortalNoticePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label')} />;
}
