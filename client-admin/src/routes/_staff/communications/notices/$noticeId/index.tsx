/** [53.4.01] `/communications/notices/$noticeId` — notice detail + read report. Gated by `NOTICE_POST`. */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { NoticeDetail } from '../../../../../features/notices/manage/notice-detail';
import { loadRouteNamespaces } from '../../../../../route-loaders';

export const Route = createFileRoute('/_staff/communications/notices/$noticeId/')({
  loader: () => loadRouteNamespaces('notices', 'nav'),
  pendingComponent: NoticeDetailPending,
  component: NoticeDetailPage,
});

function NoticeDetailPage() {
  const { noticeId } = Route.useParams();
  return <NoticeDetail noticeId={noticeId} />;
}

function NoticeDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label')} />;
}
