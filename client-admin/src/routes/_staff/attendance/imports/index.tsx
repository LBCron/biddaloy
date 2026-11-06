/** [76.4.03] `/attendance/imports` stub — the uploads list. Real table lands in W5. */
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/attendance/imports/')({
  loader: () =>
    loadRouteNamespaces('attendanceImport', 'attendance', 'common').catch(swallowUnlessOffline),
  component: AttendanceImportsPage,
});

function AttendanceImportsPage() {
  const { t } = useTranslation('attendanceImport');
  return (
    <ListShell
      title={t('imports.title')}
      tableId="attendance-imports"
      caption={t('imports.title')}
      columns={[]}
      data={[]}
      getRowId={(row: { id: string }) => row.id}
      sorting={null}
      onSortingChange={() => undefined}
      paginated={false}
      totalCount={0}
    />
  );
}
