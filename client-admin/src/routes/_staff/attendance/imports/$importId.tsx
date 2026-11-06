/** [76.4.03] `/attendance/imports/$importId` stub — one upload's detail. Real body lands in W5. */
import { useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/attendance/imports/$importId')({
  loader: () =>
    loadRouteNamespaces('attendanceImport', 'attendance', 'common').catch(swallowUnlessOffline),
  component: AttendanceImportDetailPage,
});

function AttendanceImportDetailPage() {
  const { t } = useTranslation('attendanceImport');
  const { importId } = Route.useParams();
  return (
    <DetailShell name={t('detail.title', { when: importId })}>
      <div />
    </DetailShell>
  );
}
