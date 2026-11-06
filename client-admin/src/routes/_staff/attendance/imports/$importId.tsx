/**
 * [76.5.06] `/attendance/imports/$importId` — one saved upload: who, when,
 * counts, every row, and the way to upload a corrected file (D12).
 * Title is "file · date". The breadcrumb's entity label is resolved by
 * `use-breadcrumbs.ts` (outside this lane) — it shows the generic noun until then.
 */
import { Permission } from '@biddaloy/shared';
import { ErrorState, Skeleton } from '@biddaloy/ui/components';
import {
  useAttendanceImport,
  useAttendanceImports,
  useCurrentUserId,
  useHasPermission,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatDateTime, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ImportRowsTable } from '../-imports/import-rows-table';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/attendance/imports/$importId')({
  params: { parse: (raw) => ({ importId: z.string().uuid().parse(raw.importId) }) },
  loader: () =>
    loadRouteNamespaces('attendanceImport', 'attendance', 'common').catch(swallowUnlessOffline),
  component: AttendanceImportDetailPage,
});

function AttendanceImportDetailPage() {
  const { t } = useTranslation('attendanceImport');
  const regionConfig = useTenantRegionConfig();
  const { importId } = Route.useParams();
  const canMark = useHasPermission(Permission.ATTENDANCE_MARK);
  const me = useCurrentUserId();
  const query = useAttendanceImport(importId);
  // The newer upload that corrects this one, if it is on the first page of the list.
  const newer = useAttendanceImports(1).data?.items.find(
    (item) => item.supersedes_import_id === importId,
  );

  const data = query.data;
  if (!data) {
    return (
      <DetailShell name={t('detail.title', { when: '…' })}>
        {query.isError ? (
          <ErrorState
            message={t('detail.loadFailed')}
            onRetry={() => void query.refetch()}
            retryLabel={t('history.retry')}
          />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </DetailShell>
    );
  }

  const num = (n: number) => formatNumber(n, regionConfig);
  const when = formatDateTime(data.created_at, regionConfig);
  return (
    <DetailShell
      name={`${data.file_name} · ${when}`}
      facts={[
        // The server sends the uploader's id only, never a name (#3659 adds it).
        {
          label: t('history.columnWho'),
          value:
            data.uploaded_by_user_id === null
              ? '—'
              : t(data.uploaded_by_user_id === me ? 'history.you' : 'history.someone'),
        },
        { label: t('history.columnNew'), value: num(data.counts.new) },
        { label: t('history.columnChanged'), value: num(data.counts.changed) },
        { label: t('history.columnErrors'), value: num(data.counts.error) },
      ]}
      actions={[
        ...(canMark
          ? [
              {
                id: 'corrected',
                label: t('detail.uploadCorrected'),
                priority: 'primary' as const,
                to: '/attendance/import',
                search: { supersedes: data.id },
              },
            ]
          : []),
        ...(newer
          ? [
              {
                id: 'newer',
                label: t('history.superseded'),
                priority: 'secondary' as const,
                to: `/attendance/imports/${newer.id}`,
              },
            ]
          : []),
      ]}
    >
      <ImportRowsTable rows={data.rows} />
    </DetailShell>
  );
}
