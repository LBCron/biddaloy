/**
 * #1013's assignments card on the homework detail page: one row per section or
 * student the homework was given to (`GET /homework/:id/assignments`), with the
 * target as names, dates and a status badge. The route owns every row action
 * and dialog (`actionsFor`); this card only draws rows.
 */
import {
  Card,
  DataTable,
  ErrorState,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import type { HomeworkAssignmentListItem } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';

export interface AssignmentsCardProps {
  assignments?: HomeworkAssignmentListItem[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** The route owns every action and dialog; the card only draws rows. */
  actionsFor: (row: HomeworkAssignmentListItem) => RowAction[];
  /** Empty-state action; omitted when the viewer cannot assign. */
  onAssign?: () => void;
}

const TONE = { ACTIVE: 'success', DEACTIVATED: 'warning', SUPERSEDED: 'neutral' } as const;

/** Mirrors the server's fixed cap on `GET /homework/:id/assignments` (`.limit(100)`). A full
 * page means older rows may be missing, so the card says so instead of hiding it (#3173). */
export const HOMEWORK_ASSIGNMENTS_LIST_CAP = 100;

/** "Section A" or "Rahim Uddin · Section B": the row's target as names, never ids. */
export function assignmentTargetLabel(
  row: HomeworkAssignmentListItem,
  t: TFunction<'homework'>,
): string {
  return row.student_name === null
    ? t('detail.assignments.sectionTarget', { section: row.section_name })
    : t('detail.assignments.studentTarget', {
        student: row.student_name,
        section: row.section_name,
      });
}

export function AssignmentsCard({
  assignments,
  loading,
  error,
  onRetry,
  actionsFor,
  onAssign,
}: AssignmentsCardProps) {
  const { t } = useTranslation('homework');
  const { t: tCommon } = useTranslation('common');
  const config = useRegionConfig();

  const columns: DataTableColumn<HomeworkAssignmentListItem>[] = [
    {
      id: 'target',
      header: t('detail.assignments.columnTarget'),
      accessorFn: (row) => <span className="font-medium">{assignmentTargetLabel(row, t)}</span>,
      card: 'title',
    },
    {
      id: 'assigned',
      header: t('form.assignedDateLabel'),
      accessorFn: (row) => formatDate(parseServerDate(row.assigned_date), config),
    },
    {
      id: 'due',
      header: t('form.dueDateLabel'),
      accessorFn: (row) => formatDate(parseServerDate(row.due_date), config),
    },
    {
      id: 'status',
      header: t('list.statusLabel'),
      accessorFn: (row) => (
        <StatusBadge tone={TONE[row.status]} label={t(`form.status.${row.status}`)} />
      ),
      card: 'badge',
    },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="p-4 md:px-5">
        <h2 className="text-h2">{t('detail.assignments.title')}</h2>
        <p className="mt-1 text-text-secondary">{t('detail.assignments.help')}</p>
      </div>

      {loading ? (
        <Skeleton className="mx-4 mb-4 h-24 w-[calc(100%-2rem)]" />
      ) : error || !assignments ? (
        <div className="p-4 pt-0 md:px-5">
          <ErrorState
            message={t('detail.assignments.loadError')}
            retryLabel={tCommon('actions.retry')}
            onRetry={onRetry}
          />
        </div>
      ) : (
        <DataTable
          tableId="homework-assignments"
          caption={t('detail.assignments.caption')}
          columns={columns}
          data={assignments}
          getRowId={(row) => row.id}
          sorting={null}
          onSortingChange={() => undefined}
          paginated={false}
          totalCount={assignments.length}
          rowActions={actionsFor}
          emptyState={{
            title: t('detail.assignments.emptyTitle'),
            explanation: t('detail.assignments.emptyExplanation'),
            ...(onAssign ? { action: { label: t('detail.assignAgain'), onClick: onAssign } } : {}),
          }}
        />
      )}
      {assignments && assignments.length >= HOMEWORK_ASSIGNMENTS_LIST_CAP && (
        <p role="status" className="p-4 pt-2 text-caption text-text-secondary md:px-5">
          {t('detail.assignments.capped', { count: HOMEWORK_ASSIGNMENTS_LIST_CAP })}
        </p>
      )}
    </Card>
  );
}
