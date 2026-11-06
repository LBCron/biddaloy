/**
 * [76.4.03] `/attendance/import` stub — a full-page modal (D8). The wizard
 * body lands in W5; this exists so every registry guard is satisfied first.
 */
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { createFileRoute, useRouter } from '@tanstack/react-router';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/attendance/import')({
  // `_staff.tsx` renders this route without the sidebar and header (D22).
  staticData: { chromeless: true },
  loader: () =>
    loadRouteNamespaces('attendanceImport', 'attendance', 'common').catch(swallowUnlessOffline),
  component: AttendanceImportPage,
});

function AttendanceImportPage() {
  const { t } = useTranslation('attendanceImport');
  const router = useRouter();
  return (
    <FullPageShell title={t('pageTitle')} size="wide" onClose={() => router.history.back()}>
      <div />
    </FullPageShell>
  );
}
