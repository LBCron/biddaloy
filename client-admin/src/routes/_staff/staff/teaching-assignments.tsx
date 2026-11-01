/**
 * [29.0] Teaching assignments — bulk view across a class's sections. A
 * class picklist shows one card per section, each with an unpaginated
 * `DataTable` of that section's teachers, composed
 * client-side over that class's sections (`useClassSections`) with one
 * `useSectionTeachers` per section via `useQueries` — same composition
 * pattern `ui/src/hooks/invoices.ts`'s `useInvoiceSendCandidates` already
 * uses. Bounded by the *selected class's* section count (a handful), not
 * a global N+1 — the class-wide teachers endpoint (since removed) grouped
 * rows by teacher with no per-section assignment id, too thin for this
 * table's per-row unassign action.
 *
 * Row actions reuse `-assign-teacher-dialog.tsx` and the unbound
 * `useUnassignTeacherAssignment` from wave 2
 * (`classes/-assign-teacher-dialog.tsx`, `ui/src/hooks/classes.ts`) — no
 * new dialog, no new hook. Unbound rather than the render-bound
 * `useUnassignTeacher(classId, sectionId)`: this table has no single fixed
 * class/section, and TanStack Query v5 pushes each render's mutation
 * options onto an in-flight mutation, so a bound hook would invalidate
 * whatever `classId`/`sectionId` happened to be in state when the DELETE
 * settles — wrong if the confirm dialog closed or the class filter changed
 * meanwhile.
 *
 * [83.3.3] A second tab, Coordinators (`?tab=coordinators`), lists class and subject
 * coordinators with who assigned them; `?assign=1` opens "Assign coordinator" on mount
 * (palette action `coordinators.assign`, D33).
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  HelpHint,
  Label,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  academicYearsQueryOptions,
  allClassesQueryOptions,
  sectionTeachersQueryOptions,
  useAcademicYears,
  useAllClasses,
  useClassSections,
  useCoordinators,
  useHasPermission,
  useUnassignTeacherAssignment,
  type CoordinatorAssignment,
  type SectionTeacherAssignment,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { useQueries } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { UserPlusIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';
import { AssignTeacherDialog, sortByAssignmentType } from '../classes/-assign-teacher-dialog';

import { AssignCoordinatorDialog } from './-assign-coordinator-dialog';
import { CoordinatorsTable, RemoveCoordinatorDialog } from './-coordinators-table';

const TABS = ['byClass', 'coordinators'] as const;

export const Route = createFileRoute('/_staff/staff/teaching-assignments')({
  // Same param name as the old list filter key, so old links keep working.
  validateSearch: z.object({
    classId: z.string().uuid().optional().catch(undefined),
    // [83.3.3] Coordinators tab; `assign=1` opens its dialog on mount (D33).
    tab: z.enum(TABS).optional().catch(undefined),
    assign: z.literal(1).optional().catch(undefined),
  }),
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      // Classes are fetched for the current year only, so the years come first.
      queryClient
        .ensureQueryData(academicYearsQueryOptions())
        .then((years) => {
          const currentYearId = years.data.find((y) => y.is_current)?.id;
          return queryClient.ensureQueryData(
            allClassesQueryOptions(currentYearId ? { academic_year_id: currentYearId } : {}),
          );
        })
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('teacherAssignments', 'classes'),
    ]),
  pendingComponent: TeachingAssignmentsPending,
  component: TeachingAssignmentsPage,
});

interface Row extends SectionTeacherAssignment {
  classId: string;
}

function TeachingAssignmentsPage() {
  const { t } = useTranslation('teacherAssignments');
  const { t: tClasses } = useTranslation('classes');
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  const search = Route.useSearch();
  const navigate = useNavigate();

  const academicYearsQuery = useAcademicYears();
  const currentYearId = academicYearsQuery.data?.data.find((y) => y.is_current)?.id;
  const classesQuery = useAllClasses({
    ...(currentYearId ? { academicYearId: currentYearId } : {}),
    enabled: academicYearsQuery.isSuccess,
  });
  const classes = classesQuery.data ?? [];
  // No `classId` in the URL: show the first class without writing it.
  // ponytail: "first class with data" needs classes x sections x teachers queries (no API
  // count of assignments per class); keep the first class, upgrade if the API adds a count.
  // A bookmarked id for a deleted (or another school's) class falls back too.
  const effectiveClassId =
    (search.classId !== undefined && classes.some((c) => c.id === search.classId)
      ? search.classId
      : undefined) ?? classes[0]?.id;

  const sectionsQuery = useClassSections(effectiveClassId);
  const sections = sectionsQuery.data ?? [];

  // One query per section of the *selected* class only (`useQueries`, not one
  // hook call per section — rules of hooks) — bounded, not global N+1. Same
  // composition `useInvoiceSendCandidates` uses in `ui/src/hooks/invoices.ts`.
  const sectionTeacherQueries = useQueries({
    queries: sections.map((section) =>
      sectionTeachersQueryOptions(effectiveClassId ?? '', section.id),
    ),
  });

  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignSectionId, setAssignSectionId] = React.useState<string | null>(null);
  const [unassigning, setUnassigning] = React.useState<Row | null>(null);

  const unassignTeacher = useUnassignTeacherAssignment();

  React.useEffect(() => {
    if (unassigning) unassignTeacher.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [unassigning]);

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'teacher',
      header: t('list.columnTeacher'),
      accessorFn: (row) => (
        <>
          <span className="font-medium">{row.full_name}</span>
          <span className="block text-caption text-text-secondary">{row.employee_id}</span>
        </>
      ),
      card: 'title',
    },
    {
      id: 'role',
      header: t('list.columnDuty'),
      accessorFn: (row) => tClasses(`assignmentType.${row.assignment_type}`),
    },
    {
      id: 'subject',
      header: t('list.columnSubject'),
      accessorFn: (row) => row.subject_name ?? '—',
    },
  ];

  const assignIndex = sections.findIndex((section) => section.id === assignSectionId);
  const classTeacher = sectionTeacherQueries[assignIndex]?.data?.find(
    (assignment) => assignment.assignment_type === 'CLASS_TEACHER',
  );
  const currentClassTeacher = classTeacher
    ? { teacherId: classTeacher.teacher_id, name: classTeacher.full_name }
    : undefined;

  return (
    <PageContainer size="wide">
      <PageHeader title={t('list.title')} subtitle={t('list.subtitle')} />

      <Tabs
        value={search.tab ?? 'byClass'}
        onValueChange={(value) =>
          void navigate({
            to: '/staff/teaching-assignments',
            search: (prev) => ({
              ...prev,
              tab: value === 'byClass' ? undefined : (value as (typeof TABS)[number]),
              assign: undefined,
            }),
          })
        }
      >
        <TabsList>
          <TabsTrigger value="byClass">{t('tabs.byClass')}</TabsTrigger>
          <TabsTrigger value="coordinators">{t('tabs.coordinators')}</TabsTrigger>
        </TabsList>
        <TabsContent value="coordinators" className="mt-4">
          <CoordinatorsPanel canManage={canManage} openOnMount={search.assign === 1} />
        </TabsContent>
        <TabsContent value="byClass" className="mt-4 space-y-6">
          {academicYearsQuery.isError ? (
            <ErrorState
              message={t('list.classListErrorMessage')}
              retryLabel={t('actions.retry', { ns: 'common' })}
              onRetry={() => void academicYearsQuery.refetch()}
            />
          ) : classesQuery.isError ? (
            <ErrorState
              message={t('list.classListErrorMessage')}
              retryLabel={t('actions.retry', { ns: 'common' })}
              onRetry={() => void classesQuery.refetch()}
            />
          ) : classesQuery.isLoading ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : classes.length === 0 ? (
            <EmptyState
              title={t('list.noClassesTitle')}
              explanation={t('list.noClassesExplanation')}
              action={{
                label: t('list.addClass'),
                onClick: () => void navigate({ to: '/classes' }),
              }}
            />
          ) : (
            <>
              <div className="grid gap-1.5 md:w-72">
                <Label htmlFor="ta-class">{t('list.classLabel')}</Label>
                <Select
                  {...(effectiveClassId ? { value: effectiveClassId } : {})}
                  onValueChange={(value) => {
                    void navigate({
                      to: '/staff/teaching-assignments',
                      search: { classId: value },
                    });
                    setAssignSectionId(null);
                    // Class switch closes any open unassign confirm — its row
                    // belongs to the old class.
                    setUnassigning(null);
                  }}
                >
                  <SelectTrigger id="ta-class">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((klass) => (
                      <SelectItem key={klass.id} value={klass.id}>
                        {klass.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {sectionsQuery.isError && (
                <ErrorState
                  message={t('list.errorMessage')}
                  retryLabel={t('actions.retry', { ns: 'common' })}
                  onRetry={() => void sectionsQuery.refetch()}
                />
              )}

              <div className="space-y-6">
                {sections.map((section, index) => {
                  const q = sectionTeacherQueries[index];
                  return (
                    <section
                      key={section.id}
                      className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"
                    >
                      <div className="flex items-center justify-between gap-4 p-4 md:px-5 md:py-4">
                        <h2 className="text-h2">
                          {t('list.sectionTitle', { name: section.section_name })}
                        </h2>
                        {canManage && (
                          <span className="inline-flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setAssignSectionId(section.id);
                                setAssignOpen(true);
                              }}
                            >
                              <UserPlusIcon aria-hidden="true" />
                              {t('list.assign')}
                            </Button>
                            <HelpHint helpId="people.teachingAssignments.action.assign" />
                          </span>
                        )}
                      </div>
                      {q?.isError ? (
                        <ErrorState
                          message={t('list.errorMessage')}
                          retryLabel={t('actions.retry', { ns: 'common' })}
                          onRetry={() => void q.refetch()}
                        />
                      ) : (
                        <DataTable
                          tableId={`teacher-assignments-${section.id}`}
                          caption={t('list.sectionCaption', { name: section.section_name })}
                          columns={columns}
                          data={sortByAssignmentType(
                            (q?.data ?? []).map((a) => ({ ...a, classId: effectiveClassId! })),
                          )}
                          getRowId={(row) => row.id}
                          sorting={null}
                          onSortingChange={() => undefined}
                          totalCount={q?.data?.length ?? 0}
                          paginated={false}
                          loading={q?.isLoading ?? true}
                          isFetching={q?.isFetching ?? false}
                          rowActions={(row) => [
                            {
                              intent: 'remove',
                              label: t('list.unassign'),
                              allowed: canManage,
                              onClick: () => setUnassigning(row),
                            },
                          ]}
                          emptyState={{
                            title: t('list.emptyTitle'),
                            explanation: t('list.emptyMessage'),
                          }}
                          announceResults={(count, total) =>
                            t('list.announceResults', { count, total })
                          }
                        />
                      )}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {canManage && effectiveClassId && assignSectionId && (
        <AssignTeacherDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          classId={effectiveClassId}
          sectionId={assignSectionId}
          currentClassTeacher={currentClassTeacher}
          onAssigned={() => setAssignOpen(false)}
        />
      )}

      {canManage && unassigning && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setUnassigning(null);
          }}
          tone="danger"
          title={t('unassignDialog.title')}
          helpId="people.teachingAssignments.action.unassign"
          description={t('unassignDialog.description', {
            teacherName: unassigning.full_name,
            sectionName: unassigning.section_name,
          })}
          confirmLabel={t('unassignDialog.confirm')}
          cancelLabel={t('unassignDialog.cancel')}
          busy={unassignTeacher.isPending}
          onConfirm={() =>
            unassignTeacher.mutate(
              {
                classId: unassigning.classId,
                sectionId: unassigning.section_id,
                assignmentId: unassigning.id,
              },
              {
                onSuccess: () => setUnassigning(null),
                // The dialog has no error slot: close it and say so (never the server text).
                onError: () => {
                  setUnassigning(null);
                  toast.error(t('unassignDialog.errorMessage'));
                },
              },
            )
          }
        />
      )}
    </PageContainer>
  );
}

/** [83.3.3] Coordinators tab: every coordinator row of the school, with assign / remove. */
function CoordinatorsPanel({
  canManage,
  openOnMount,
}: {
  canManage: boolean;
  openOnMount: boolean;
}) {
  const { t } = useTranslation('teacherAssignments');
  const query = useCoordinators();
  const [assignOpen, setAssignOpen] = React.useState(openOnMount && canManage);
  const [removing, setRemoving] = React.useState<CoordinatorAssignment | null>(null);
  const open = () => setAssignOpen(true);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h2">{t('coordinators.caption')}</h2>
        {canManage && (
          <Button type="button" variant="outline" onClick={open}>
            <UserPlusIcon aria-hidden="true" />
            {t('coordinators.assign')}
          </Button>
        )}
      </div>
      <CoordinatorsTable
        tableId="coordinators"
        caption={t('coordinators.caption')}
        rows={query.data}
        loading={query.isLoading}
        fetching={query.isFetching}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        onRemove={canManage ? setRemoving : undefined}
        emptyState={{
          title: t('coordinators.emptyTitle'),
          explanation: t('coordinators.emptyMessage'),
          ...(canManage ? { action: { label: t('coordinators.assign'), onClick: open } } : {}),
        }}
      />
      {canManage && <AssignCoordinatorDialog open={assignOpen} onOpenChange={setAssignOpen} />}
      {canManage && <RemoveCoordinatorDialog row={removing} onClose={() => setRemoving(null)} />}
    </section>
  );
}

function TeachingAssignmentsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
