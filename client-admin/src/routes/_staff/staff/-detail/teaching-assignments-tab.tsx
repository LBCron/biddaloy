/**
 * [29.0 / #1026] Staff detail's Teaching assignments tab — the
 * teacher-centric mirror of `classes/-detail/teachers-tab.tsx`: instead of
 * one section's roster, this lists one teacher's assignments across every
 * class/section, via `useTeacherAssignments(teacherId)`
 * (`ui/src/hooks/teachers.ts`). A `DataTable` (not the per-section panel
 * layout `teachers-tab.tsx` uses) because rows here already carry their own
 * class/section columns — nothing to group by.
 *
 * Assign/remove reuse `-assign-teacher-dialog.tsx` and the unbound
 * `useAssignTeacherAssignment`/`useUnassignTeacherAssignment` hooks from
 * `ui/src/hooks/classes.ts` (the `#1026` gap fix) — this screen has no
 * fixed class/section to bind them to, unlike `teachers-tab.tsx`.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from '@biddaloy/ui/components';
import {
  useHasPermission,
  useTeacherAssignments,
  useUnassignTeacherAssignment,
  useCoordinators,
  type CoordinatorAssignment,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { UserPlusIcon } from 'lucide-react';
import * as React from 'react';

import { AssignCoordinatorDialog } from '../-assign-coordinator-dialog';
import { CoordinatorsTable, RemoveCoordinatorDialog } from '../-coordinators-table';
import { AssignTeacherDialog, sortByAssignmentType } from '../../classes/-assign-teacher-dialog';

import { TabQueryState } from './tab-query-state';

export interface TeachingAssignmentsTabProps {
  teacherId: string;
}

export function TeachingAssignmentsTab({ teacherId }: TeachingAssignmentsTabProps) {
  const { t } = useTranslation('staff');
  const { t: tClasses } = useTranslation('classes');
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  const query = useTeacherAssignments(teacherId);
  const unassign = useUnassignTeacherAssignment();
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [sorting, setSorting] = React.useState<DataTableSort | null>(null);
  const [removing, setRemoving] = React.useState<NonNullable<typeof query.data>[number] | null>(
    null,
  );

  const columns: DataTableColumn<NonNullable<typeof query.data>[number]>[] = [
    {
      id: 'class',
      header: t('detail.teachingAssignments.columnClass'),
      accessorFn: (row) => `${row.class_name} · ${row.section_name}`,
    },
    {
      id: 'role',
      header: t('detail.teachingAssignments.columnRole'),
      accessorFn: (row) => tClasses(`assignmentType.${row.assignment_type}`),
    },
    {
      id: 'subject',
      header: t('detail.teachingAssignments.columnSubject'),
      accessorFn: (row) => row.subject_name ?? '—',
    },
  ];

  return (
    <>
      <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 md:px-5">
          <h2 className="text-h2">{t('detail.teachingAssignments.title')}</h2>
          {canManage && (
            <Button type="button" variant="outline" onClick={() => setAssignOpen(true)}>
              <UserPlusIcon aria-hidden="true" />
              {t('detail.teachingAssignments.assign')}
            </Button>
          )}
        </div>

        {unassign.isError && (
          <p role="alert" className="px-4 pb-3 text-caption text-destructive md:px-5">
            {t('detail.teachingAssignments.removeError')}
          </p>
        )}

        <TabQueryState
          query={query}
          forbiddenMessage={t('detail.forbidden')}
          errorMessage={t('detail.teachingAssignments.errorMessage')}
        >
          {(rows) => (
            <DataTable
              tableId="staff-teaching-assignments"
              caption={t('detail.teachingAssignments.caption')}
              columns={columns}
              data={sortByAssignmentType(rows)}
              getRowId={(row) => row.id}
              sorting={sorting}
              onSortingChange={setSorting}
              totalCount={rows.length}
              paginated={false}
              rowActions={(row) =>
                canManage
                  ? [
                      {
                        intent: 'remove',
                        label: t('detail.teachingAssignments.remove'),
                        onClick: () => setRemoving(row),
                      },
                    ]
                  : []
              }
              emptyState={{
                title: t('detail.teachingAssignments.emptyMessage'),
                explanation: t('detail.teachingAssignments.emptyExplanation'),
              }}
              announceResults={(count, total) =>
                t('detail.teachingAssignments.announceResults', { count, total })
              }
            />
          )}
        </TabQueryState>

        {canManage && removing && (
          <ConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setRemoving(null);
            }}
            tone="danger"
            title={t('detail.teachingAssignments.removeConfirmTitle')}
            helpId="people.teachingAssignments.action.unassign"
            description={t('detail.teachingAssignments.removeConfirmDescription', {
              sectionName: `${removing.class_name} · ${removing.section_name}`,
            })}
            confirmLabel={t('detail.teachingAssignments.removeConfirm')}
            busy={unassign.isPending}
            onConfirm={() =>
              unassign.mutate(
                {
                  classId: removing.class_id,
                  sectionId: removing.section_id,
                  assignmentId: removing.id,
                },
                // The error line above the table reports a failure; close either way.
                { onSettled: () => setRemoving(null) },
              )
            }
          />
        )}

        {canManage && (
          <AssignTeacherDialog
            open={assignOpen}
            onOpenChange={setAssignOpen}
            teacherId={teacherId}
            onAssigned={() => setAssignOpen(false)}
          />
        )}
      </section>
      {canManage && <TeacherCoordinationBlock teacherId={teacherId} />}
    </>
  );
}

/**
 * [83.3.3] D30: the classes this teacher coordinates, with assign and remove. Rendered for
 * CLASS_MANAGE only (`GET /coordinators` needs it).
 */
function TeacherCoordinationBlock({ teacherId }: { teacherId: string }) {
  const { t } = useTranslation('teacherAssignments');
  const query = useCoordinators({ teacherId });
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<CoordinatorAssignment | null>(null);
  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 md:px-5">
        <h2 className="text-h2">{t('coordinators.blockTitle')}</h2>
        <Button type="button" variant="outline" onClick={() => setAssignOpen(true)}>
          <UserPlusIcon aria-hidden="true" />
          {t('coordinators.assign')}
        </Button>
      </div>
      {!query.isError && query.isSuccess && query.data.length === 0 ? (
        <p className="px-4 pb-4 text-text-secondary md:px-5">{t('coordinators.blockEmpty')}</p>
      ) : (
        <CoordinatorsTable
          tableId={`teacher-coordination-${teacherId}`}
          caption={t('coordinators.blockTitle')}
          rows={query.data}
          loading={query.isLoading}
          fetching={query.isFetching}
          isError={query.isError}
          onRetry={() => void query.refetch()}
          hideTeacher
          onRemove={setRemoving}
          emptyState={{
            title: t('coordinators.blockEmpty'),
            explanation: t('coordinators.emptyMessage'),
          }}
        />
      )}
      <AssignCoordinatorDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        teacherId={teacherId}
      />
      <RemoveCoordinatorDialog row={removing} onClose={() => setRemoving(null)} />
    </section>
  );
}
