/** [53.4.01] `/communications/notices/new` — compose a notice. Gated by `NOTICE_POST`. */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { NoticeCompose } from '../../../../features/notices/compose/notice-compose';
import { loadRouteNamespaces } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/communications/notices/new')({
  loader: () => loadRouteNamespaces('noticeCompose', 'notices', 'nav'),
  pendingComponent: NoticeFormPending,
  component: NewNoticePage,
});

function NewNoticePage() {
  const navigate = useNavigate();
  const close = useCloseFullPage(() => void navigate({ to: '/communications/notices' }));
  return (
    <NoticeCompose
      onClose={close}
      onPublished={(noticeId) =>
        void navigate({ to: '/communications/notices/$noticeId', params: { noticeId } })
      }
    />
  );
}

function NoticeFormPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label')} />;
}
