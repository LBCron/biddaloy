/**
 * [76.5.06] `/attendance/imports` — every saved attendance sheet, newest first.
 * "Superseded" is derived from the loaded page: an upload is superseded when
 * another listed upload points at it through `supersedes_import_id`.
 * Teachers only get their own uploads — the server scopes the list.
 */
import { Permission } from '@biddaloy/shared';
import { StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  useAttendanceImports,
  useCurrentUserId,
  useHasPermission,
  type AttendanceImportSummary,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import { formatDateTime, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/attendance/imports/')({
  loader: () =>
    loadRouteNamespaces('attendanceImport', 'attendance', 'common').catch(swallowUnlessOffline),
  component: AttendanceImportsPage,
});

function AttendanceImportsPage() {
  const { t } = useTranslation('attendanceImport');
  const regionConfig = useTenantRegionConfig();
  const navigate = useNavigate();
  // Uploading writes marks, so the buttons need ATTENDANCE_MARK; reading the list does not.
  const canMark = useHasPermission(Permission.ATTENDANCE_MARK);
  const [page, setPage] = React.useState(1);
  const query = useAttendanceImports(page);
  const items = query.data?.items ?? [];

  const supersededIds = new Set(
    items.flatMap((item) => (item.supersedes_import_id ? [item.supersedes_import_id] : [])),
  );
  const num = (n: number) => formatNumber(n, regionConfig);
  const me = useCurrentUserId();
  const uploaderLabel = (id: string | null) =>
    id === null ? '—' : t(id === me ? 'history.you' : 'history.someone');

  const columns: DataTableColumn<AttendanceImportSummary>[] = [
    {
      id: 'when',
      header: t('history.columnWhen'),
      accessorFn: (row) => formatDateTime(row.created_at, regionConfig),
      card: 'title',
    },
    {
      id: 'file',
      header: t('history.columnFile'),
      accessorFn: (row) => row.file_name,
      card: 'subtitle',
    },
    {
      id: 'who',
      header: t('history.columnWho'),
      // The server sends the uploader's id only, never a name (#3659 adds it): "You" or a plain fallback.
      accessorFn: (row) => uploaderLabel(row.uploaded_by_user_id),
    },
    {
      id: 'new',
      header: t('history.columnNew'),
      accessorFn: (row) => num(row.counts.new),
      align: 'end',
    },
    {
      id: 'changed',
      header: t('history.columnChanged'),
      accessorFn: (row) => num(row.counts.changed),
      align: 'end',
    },
    {
      id: 'errors',
      header: t('history.columnErrors'),
      accessorFn: (row) => num(row.counts.error),
      align: 'end',
    },
    {
      id: 'status',
      header: t('history.columnStatus'),
      accessorFn: (row) =>
        supersededIds.has(row.id) ? (
          <StatusBadge tone="warning" label={t('history.superseded')} />
        ) : (
          <StatusBadge tone="success" label={t('history.statusCurrent')} />
        ),
      card: 'badge',
    },
  ];

  return (
    <ListShell
      title={t('history.title')}
      subtitle={t('history.description')}
      actions={
        canMark
          ? [
              {
                id: 'upload',
                label: t('history.uploadNew'),
                priority: 'primary',
                onClick: () => void navigate({ to: '/attendance/import' }),
              },
            ]
          : []
      }
      tableId="attendance-imports"
      caption={t('history.title')}
      columns={columns}
      data={items}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => undefined}
      page={page}
      pageSize={query.data?.limit ?? 25}
      onPageChange={setPage}
      totalCount={query.data?.total ?? 0}
      loading={query.isLoading}
      isFetching={query.isFetching}
      {...(query.isError ? { error: t('history.loadFailed') } : {})}
      rowActions={(row) => [
        {
          intent: 'view',
          label: row.file_name,
          to: `/attendance/imports/${row.id}`,
        },
      ]}
      emptyState={{
        title: t('history.emptyTitle'),
        explanation: t('history.emptyExplanation'),
        ...(canMark
          ? {
              action: {
                label: t('history.emptyAction'),
                onClick: () => void navigate({ to: '/attendance/import' }),
              },
            }
          : {}),
      }}
    />
  );
}
