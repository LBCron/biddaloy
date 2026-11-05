/** [53.4.01] `/portal/notices/$noticeId` — one notice, full page (shared links, push). Gated in `portal.tsx`. */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { MyNoticePage } from '../../../features/notices/read/my-notice-detail';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/portal/notices/$noticeId')({
  loader: () => loadRouteNamespaces('portal', 'portalNotices'),
  pendingComponent: PortalNoticePending,
  component: PortalNoticePage,
});

function PortalNoticePage() {
  const { noticeId } = Route.useParams();
  return <MyNoticePage id={noticeId} />;
}

function PortalNoticePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label')} />;
}
