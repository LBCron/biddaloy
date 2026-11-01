/**
 * [83.3.3] One table of coordinator rows, shared by Teaching assignments › Coordinators, the
 * staff detail's Teaching assignments tab and the class detail's Teachers tab (D30, D32).
 * Columns: teacher · kind · class · subject · "assigned by <name> on <date>" · remove.
 * The remove action shows only when `onRemove` is given (class detail is read-only).
 */
import {
  ConfirmDialog,
  DataTable,
  ErrorState,
  StatusBadge,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useRemoveCoordinator, type CoordinatorAssignment } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';

export interface CoordinatorsTableProps {
  tableId: string;
  caption: string;
  rows: CoordinatorAssignment[] | undefined;
  loading: boolean;
  fetching: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Omit the teacher column (staff detail: it is always that teacher). */
  hideTeacher?: boolean;
  /** Omit the class column (class detail: it is always that class). */
  hideClass?: boolean;
  onRemove?: ((row: CoordinatorAssignment) => void) | undefined;
  emptyState: {
    title: string;
    explanation: string;
    action?: { label: string; onClick: () => void };
  };
}

export function CoordinatorsTable({
  tableId,
  caption,
  rows,
  loading,
  fetching,
  isError,
  onRetry,
  hideTeacher,
  hideClass,
  onRemove,
  emptyState,
}: CoordinatorsTableProps) {
  const { t } = useTranslation('teacherAssignments');
  const region = useTenantRegionConfig();

  if (isError) {
    return (
      <ErrorState
        message={t('coordinators.errorMessage')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={onRetry}
      />
    );
  }

  const columns: DataTableColumn<CoordinatorAssignment>[] = [
    ...(hideTeacher
      ? []
      : [
          {
            id: 'teacher',
            header: t('coordinators.columnTeacher'),
            accessorFn: (row: CoordinatorAssignment) => (
              <span className="font-medium">{row.teacher_name}</span>
            ),
            card: 'title' as const,
          },
        ]),
    {
      id: 'kind',
      header: t('coordinators.columnKind'),
      accessorFn: (row) => (
        <StatusBadge
          tone={row.subject_id ? 'info' : 'success'}
          label={t(
            row.subject_id
              ? 'coordinatorKinds.subjectCoordinator'
              : 'coordinatorKinds.classCoordinator',
          )}
        />
      ),
    },
    ...(hideClass
      ? []
      : [
          {
            id: 'class',
            header: t('coordinators.columnClass'),
            accessorFn: (row: CoordinatorAssignment) => row.class_name,
            ...(hideTeacher ? { card: 'title' as const } : {}),
          },
        ]),
    {
      id: 'subject',
      header: t('coordinators.columnSubject'),
      accessorFn: (row) => row.subject_name ?? t('coordinators.allSubjects'),
    },
    {
      id: 'assigned',
      header: t('coordinators.columnAssignedBy'),
      accessorFn: (row) => {
        const date = formatDate(row.created_at, region);
        return row.assigned_by_name
          ? t('coordinators.assignedBy', { name: row.assigned_by_name, date })
          : t('coordinators.assignedOn', { date });
      },
    },
  ];

  return (
    <DataTable
      tableId={tableId}
      caption={caption}
      columns={columns}
      data={rows ?? []}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => undefined}
      totalCount={rows?.length ?? 0}
      paginated={false}
      loading={loading}
      isFetching={fetching}
      {...(onRemove
        ? {
            rowActions: (row: CoordinatorAssignment) => [
              {
                intent: 'remove' as const,
                label: t('coordinators.remove'),
                allowed: true,
                onClick: () => onRemove(row),
              },
            ],
          }
        : {})}
      emptyState={emptyState}
      announceResults={(count) => t('coordinators.announceResults', { count })}
    />
  );
}

/** Confirm + DELETE for one coordinator row; a failure closes and toasts (never server text). */
export function RemoveCoordinatorDialog({
  row,
  onClose,
}: {
  row: CoordinatorAssignment | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('teacherAssignments');
  const remove = useRemoveCoordinator();
  if (!row) return null;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      tone="danger"
      title={t('removeCoordinatorDialog.title')}
      description={t('removeCoordinatorDialog.description', {
        teacherName: row.teacher_name,
        className: row.subject_name ? `${row.class_name} (${row.subject_name})` : row.class_name,
      })}
      confirmLabel={t('removeCoordinatorDialog.confirm')}
      cancelLabel={t('removeCoordinatorDialog.cancel')}
      busy={remove.isPending}
      onConfirm={() =>
        remove.mutate(row.id, {
          onSuccess: onClose,
          onError: () => {
            onClose();
            toast.error(t('removeCoordinatorDialog.errorMessage'));
          },
        })
      }
    />
  );
}
