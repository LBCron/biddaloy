/**
 * [53.4.01] `/communications/notices` — the staff notice list. Gated by
 * `route-permissions.ts` (`NOTICE_POST`); the component checks nothing itself.
 */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { NoticeList } from '../../../../features/notices/manage/notice-list';
import { loadRouteNamespaces } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/communications/notices/')({
  loader: () => loadRouteNamespaces('notices', 'nav'),
  pendingComponent: NoticesPending,
  component: NoticeList,
});

function NoticesPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label')} />;
}
