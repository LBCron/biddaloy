/** [53.4.01] `/portal/notices` — the reader's notice list (current · archive). Gated in `portal.tsx`. */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { MyNoticesList } from '../../../features/notices/read/my-notices-list';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/portal/notices/')({
  loader: () => loadRouteNamespaces('portal', 'portalNotices'),
  pendingComponent: PortalNoticesPending,
  component: MyNoticesList,
});

function PortalNoticesPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label')} />;
}
