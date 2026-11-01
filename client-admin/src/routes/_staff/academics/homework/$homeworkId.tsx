/**
 * [22.4.1] Homework detail. Assignment rows come from `GET /homework/:id/assignments`
 * (#1013). "Assign to section or student" only adds a row (`POST /homework/:id/assign`);
 * "Change" on a row reassigns it through `POST /homework-assignments/:id/reassign`.
 * "Due date" moves the date in place and "Deactivate"/"Reactivate" flip the status, both through
 * `PATCH /homework-assignments/:id` (#2900); submissions stay on the row.
 * "Check work" (`?assignment=<id>`) opens a full-page list of that row's students
 * (`GET`/`PATCH /homework-assignments/:id/submissions`, #2899). The "Homework to check" card
 * deep-links here.
 */
import { Permission } from '@biddaloy/shared';
import {
  ApiError,
  captureNotificationTenant,
  isNotFoundError,
  notifyOutcome,
} from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ConfirmDialog,
  DatePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  RecordNotFoundState,
  RoutePending,
  Skeleton,
  type RowAction,
} from '@biddaloy/ui/components';
import {
  useAssignHomework,
  useAssignmentSubmissions,
  useClass,
  useGradeSubmissions,
  useHasPermission,
  useHomework,
  useHomeworkAssignments,
  homeworkQueryOptions,
  useReassignHomeworkAssignment,
  useSubjects,
  useUpdateHomeworkAssignment,
  type HomeworkAssignmentListItem,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { DetailShell, FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, parseServerDate, toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { CalendarClock, Send } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { AssignHomeworkForm, type AssignHomeworkFormSubmitPayload } from './-assign-homework-form';
import { AssignmentsCard, assignmentTargetLabel } from './-assignments-card';
import { subjectName } from './-subject-name';
import {
  HOMEWORK_MARKS_MAX,
  SubmissionGrid,
  type SubmissionSaveResult,
  type SubmissionUpdate,
} from './-submission-grid';

const homeworkDetailSearchSchema = z.object({
  // #2899: the check-work overlay is in the URL, so Back closes it and the dashboard can deep-link.
  assignment: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/academics/homework/$homeworkId')({
  validateSearch: homeworkDetailSearchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(homeworkQueryOptions(params.homeworkId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('homework'),
    ]),
  pendingComponent: HomeworkDetailPending,
  component: HomeworkDetailPage,
});

function HomeworkDetailPage() {
  const navigate = Route.useNavigate();
  const { homeworkId } = Route.useParams();
  const { t, i18n } = useTranslation('homework');
  const { t: tCommon } = useTranslation('common');

  const homeworkQuery = useHomework(homeworkId);
  const canAssign = useHasPermission(Permission.HOMEWORK_ASSIGN);
  const regionConfig = useTenantRegionConfig();

  const homework = homeworkQuery.data;
  const classQuery = useClass(homework?.class_id);
  const subjectsQuery = useSubjects({ limit: 100 });

  const [assignOpen, setAssignOpen] = React.useState(false);
  const assignHomework = useAssignHomework();
  const assignmentsQuery = useHomeworkAssignments(homeworkId);
  const reassign = useReassignHomeworkAssignment();
  const [reassignRow, setReassignRow] = React.useState<HomeworkAssignmentListItem | null>(null);
  const update = useUpdateHomeworkAssignment();
  const [statusRow, setStatusRow] = React.useState<HomeworkAssignmentListItem | null>(null);
  const [dueRow, setDueRow] = React.useState<HomeworkAssignmentListItem | null>(null);
  // Double-click guard: `isPending` flips a render late, a ref does not.
  const inFlight = React.useRef(false);
  const search = Route.useSearch();
  const canGrade = useHasPermission(Permission.HOMEWORK_GRADE);
  const gridAssignmentId = canGrade ? search.assignment : undefined; // D12
  const submissionsQuery = useAssignmentSubmissions(gridAssignmentId);
  const grade = useGradeSubmissions();
  const [gridDirty, setGridDirty] = React.useState(false);
  // Memoised: the grid re-baselines its draft when this identity changes.
  const gridRows = React.useMemo(
    () =>
      submissionsQuery.data?.map((r) => ({
        id: r.student_id,
        student_id: r.student_id,
        student_name: r.student_name,
        roll_number: r.roll_number,
        status: r.status,
        marks: r.marks,
      })),
    [submissionsQuery.data],
  );
  // D11: from the dashboard, Close goes back there (D22), not to the bare homework page.
  const closeGrid = useCloseFullPage(
    () => void navigate({ search: (prev) => ({ ...prev, assignment: undefined }), replace: true }),
  );

  if (homeworkQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isNotFoundError(homeworkQuery.error)) {
    return <RecordNotFoundState onBack={() => void navigate({ to: '/academics/homework' })} />;
  }

  if (homeworkQuery.isError || homework === undefined) {
    const forbidden =
      homeworkQuery.error instanceof ApiError && homeworkQuery.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('detail.notFound')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void homeworkQuery.refetch()}
      />
    );
  }

  const subject = subjectsQuery.data?.data.find((s) => s.id === homework.subject_id);

  function handleAssign(payload: AssignHomeworkFormSubmitPayload) {
    assignHomework.mutate(
      { homeworkId, input: payload.assignment },
      {
        onSuccess: (assignment) => {
          setAssignOpen(false);
          notifyOutcome({
            tenantId: captureNotificationTenant(),
            variant: 'success',
            message: t('detail.assigned', {
              date: formatDate(parseServerDate(assignment.due_date), regionConfig),
            }),
          });
        },
      },
    );
  }

  function notifyError(message: string) {
    notifyOutcome({ tenantId: captureNotificationTenant(), variant: 'error', message });
  }

  function openGrid(row: HomeworkAssignmentListItem) {
    setGridDirty(false);
    void navigate({ search: (prev) => ({ ...prev, assignment: row.id }) });
  }

  async function handleGrade(updates: SubmissionUpdate[]): Promise<SubmissionSaveResult[]> {
    if (!gridAssignmentId) return [];
    try {
      await grade.mutateAsync({
        assignmentId: gridAssignmentId,
        items: updates.map((u) => ({
          student_id: u.id,
          ...(u.status !== undefined ? { status: u.status } : {}),
          ...(u.marks !== undefined ? { marks: u.marks } : {}),
        })),
      });
      notifyOutcome({
        tenantId: captureNotificationTenant(),
        variant: 'success',
        message: t('detail.submissions.saved'),
      });
    } catch (err) {
      if (rowGone(err)) {
        void submissionsQuery.refetch();
        notifyError(t('detail.submissions.saveChanged'));
      } else {
        notifyError(t('form.genericError')); // D10: the draft is kept
      }
    }
    return [];
  }

  // D3 (#2900): ACTIVE rows get Due date, Change, Deactivate; DEACTIVATED rows only Reactivate
  // (Change there would silently create a new ACTIVE row); SUPERSEDED rows nothing. Plus Check
  // work first on every row (#2899), for HOMEWORK_GRADE holders.
  function actionsFor(row: HomeworkAssignmentListItem): RowAction[] {
    const target = assignmentTargetLabel(row, t);
    const check: RowAction[] = canGrade
      ? [
          {
            intent: 'view',
            display: 'text',
            label: t('detail.submissions.open', { target }),
            shortLabel: t('detail.submissions.openShort'),
            'data-focus-anchor': row.id,
            onClick: () => openGrid(row),
          },
        ]
      : [];
    if (!canAssign || row.status === 'SUPERSEDED') return check;
    const statusBusy = update.isPending && statusRow?.id === row.id;
    const openStatus = () => {
      update.reset();
      setStatusRow(row);
    };
    if (row.status === 'DEACTIVATED') {
      return [
        ...check,
        {
          intent: 'restore',
          label: t('detail.assignments.reactivate', { target }),
          shortLabel: t('detail.assignments.reactivateShort'),
          busy: statusBusy,
          onClick: openStatus,
        },
      ];
    }
    return [
      ...check,
      {
        intent: 'edit',
        icon: <CalendarClock />,
        label: t('detail.assignments.changeDue', { target }),
        shortLabel: t('detail.assignments.changeDueShort'),
        busy: update.isPending && dueRow?.id === row.id,
        onClick: () => {
          update.reset();
          setDueRow(row);
        },
      },
      {
        intent: 'edit',
        label: t('detail.assignments.reassign', { target }),
        shortLabel: t('detail.assignments.reassignShort'),
        busy: reassign.isPending && reassignRow?.id === row.id,
        onClick: () => {
          reassign.reset();
          setReassignRow(row);
        },
      },
      {
        intent: 'archive',
        label: t('detail.assignments.deactivate', { target }),
        shortLabel: t('detail.assignments.deactivateShort'),
        busy: statusBusy,
        onClick: openStatus,
      },
    ];
  }

  function handleDueDate(iso: string) {
    if (!dueRow) return;
    update.mutate(
      { assignmentId: dueRow.id, input: { due_date: iso } },
      {
        onSuccess: () => {
          setDueRow(null);
          notifyOutcome({
            tenantId: captureNotificationTenant(),
            variant: 'success',
            message: t('detail.assignments.dueChanged', {
              date: formatDate(parseServerDate(iso), regionConfig),
            }),
          });
        },
        onError: (err) => {
          if (rowGone(err)) {
            setDueRow(null);
            notifyError(t('detail.assignments.rowChanged'));
          }
        },
      },
    );
  }

  function handleStatusConfirm() {
    if (!statusRow) return;
    const next = statusRow.status === 'ACTIVE' ? 'DEACTIVATED' : 'ACTIVE';
    update.mutate(
      { assignmentId: statusRow.id, input: { status: next } },
      {
        onSuccess: () => {
          setStatusRow(null);
          notifyOutcome({
            tenantId: captureNotificationTenant(),
            variant: 'success',
            message: t(
              next === 'DEACTIVATED'
                ? 'detail.assignments.deactivated'
                : 'detail.assignments.reactivated',
            ),
          });
        },
        onError: (err) => {
          // ConfirmDialog has no error slot: close it and toast a fixed text.
          setStatusRow(null);
          notifyError(
            rowGone(err)
              ? t('detail.assignments.rowChanged')
              : targetTaken(err)
                ? t('detail.assignments.targetTaken')
                : t('form.genericError'),
          );
        },
      },
    );
  }

  function handleReassign(payload: AssignHomeworkFormSubmitPayload) {
    if (!reassignRow || inFlight.current) return;
    inFlight.current = true;
    reassign.mutate(
      { assignmentId: reassignRow.id, input: payload.assignment },
      {
        onSettled: () => {
          inFlight.current = false;
        },
        onError: (err) => {
          // D4: 400/404 means the row was superseded or removed; don't leave the dialog on it.
          if (rowGone(err)) {
            setReassignRow(null);
            notifyError(t('detail.assignments.rowChanged'));
          }
        },
        onSuccess: (assignment) => {
          setReassignRow(null);
          notifyOutcome({
            tenantId: captureNotificationTenant(),
            variant: 'success',
            message: t('detail.assignments.reassigned', {
              date: formatDate(parseServerDate(assignment.due_date), regionConfig),
            }),
          });
        },
      },
    );
  }

  const gridRow = gridAssignmentId
    ? assignmentsQuery.data?.find((a) => a.id === gridAssignmentId)
    : undefined;

  return (
    <RegionConfigProvider value={regionConfig}>
      <div className="flex flex-col gap-4">
        <DetailShell
          name={homework.title}
          facts={[
            { label: t('detail.subjectLabel'), value: subjectName(subject, i18n.language) },
            { label: t('detail.classLabel'), value: classQuery.data?.name ?? '—' },
            {
              label: t('detail.gradingModeLabel'),
              value: t(`form.gradingMode.${homework.grading_mode}`),
            },
            {
              label: t('detail.createdLabel'),
              value: formatDate(parseServerDate(homework.created_at), regionConfig),
            },
          ]}
          actions={[
            {
              id: 'assign',
              helpId: 'academics.homework.action.assignAgain',
              label: t('detail.assignAgain'),
              icon: <Send />,
              onClick: () => {
                assignHomework.reset();
                setAssignOpen(true);
              },
              allowed: canAssign,
              priority: 'primary',
            },
          ]}
        />

        <Card padded>
          <h2 className="text-h2">{t('detail.descriptionLabel')}</h2>
          <p
            className={
              homework.description
                ? 'mt-2 whitespace-pre-line'
                : 'mt-2 whitespace-pre-line text-text-secondary'
            }
          >
            {homework.description || t('detail.noDescription')}
          </p>
        </Card>

        <AssignmentsCard
          assignments={assignmentsQuery.data}
          loading={assignmentsQuery.isPending}
          error={assignmentsQuery.isError}
          onRetry={() => void assignmentsQuery.refetch()}
          actionsFor={actionsFor}
          {...(canAssign
            ? {
                onAssign: () => {
                  assignHomework.reset();
                  setAssignOpen(true);
                },
              }
            : {})}
        />

        {canAssign && (
          <Dialog
            open={assignOpen}
            onOpenChange={(open) => {
              if (assignHomework.isPending) return;
              assignHomework.reset();
              setAssignOpen(open);
            }}
          >
            <DialogContent size="md" closeLabel={tCommon('actions.close')}>
              <DialogHeader>
                <DialogTitle>{t('detail.assignAgain')}</DialogTitle>
                <DialogDescription>
                  {t('detail.assignDescription', {
                    title: homework.title,
                    className: classQuery.data?.name ?? '—',
                  })}
                </DialogDescription>
              </DialogHeader>
              <AssignHomeworkForm
                mode="assign"
                initial={{ classId: homework.class_id }}
                isPending={assignHomework.isPending}
                {...(assignHomework.isError
                  ? {
                      error: targetTaken(assignHomework.error)
                        ? t('detail.assignments.targetTaken')
                        : t('form.genericError'),
                    }
                  : {})}
                onSubmit={handleAssign}
              />
            </DialogContent>
          </Dialog>
        )}

        {canAssign && (
          <Dialog
            open={reassignRow !== null}
            onOpenChange={(open) => {
              if (reassign.isPending) return;
              reassign.reset();
              if (!open) setReassignRow(null);
            }}
          >
            <DialogContent size="md" closeLabel={tCommon('actions.close')}>
              <DialogHeader>
                <DialogTitle>{t('detail.assignments.reassignTitle')}</DialogTitle>
                <DialogDescription>{t('detail.assignments.reassignDescription')}</DialogDescription>
              </DialogHeader>
              {reassignRow && (
                <AssignHomeworkForm
                  key={reassignRow.id}
                  mode="reassign"
                  initial={{
                    classId: homework.class_id,
                    sectionId: reassignRow.target_section_id,
                    ...(reassignRow.student_id ? { studentId: reassignRow.student_id } : {}),
                    ...(reassignRow.student_name ? { studentName: reassignRow.student_name } : {}),
                    assignedDate: reassignRow.assigned_date,
                    dueDate: reassignRow.due_date,
                  }}
                  isPending={reassign.isPending}
                  {...(reassign.isError
                    ? {
                        error: targetTaken(reassign.error)
                          ? t('detail.assignments.targetTaken')
                          : t('form.genericError'),
                      }
                    : {})}
                  onSubmit={handleReassign}
                />
              )}
            </DialogContent>
          </Dialog>
        )}

        {canAssign && (
          <Dialog
            open={dueRow !== null}
            onOpenChange={(open) => {
              if (update.isPending) return;
              update.reset();
              if (!open) setDueRow(null);
            }}
          >
            <DialogContent size="sm" closeLabel={tCommon('actions.close')}>
              <DialogHeader>
                <DialogTitle>{t('detail.assignments.changeDueTitle')}</DialogTitle>
                <DialogDescription>
                  {dueRow
                    ? t('detail.assignments.changeDueDescription', {
                        target: assignmentTargetLabel(dueRow, t),
                      })
                    : ''}
                </DialogDescription>
              </DialogHeader>
              {dueRow && (
                <DueDateForm
                  key={dueRow.id}
                  row={dueRow}
                  isPending={update.isPending}
                  {...(update.isError ? { error: t('form.genericError') } : {})}
                  onSubmit={handleDueDate}
                />
              )}
            </DialogContent>
          </Dialog>
        )}

        {canAssign && statusRow && (
          <ConfirmDialog
            open
            // A pending request must not be dismissed from under itself.
            onOpenChange={(open) => {
              if (!open && !update.isPending) setStatusRow(null);
            }}
            // Both ways are undoable: the danger tone would draw a trash icon for Deactivate.
            tone="default"
            title={t(
              statusRow.status === 'ACTIVE'
                ? 'detail.assignments.deactivateTitle'
                : 'detail.assignments.reactivateTitle',
              { target: assignmentTargetLabel(statusRow, t) },
            )}
            description={t(
              statusRow.status === 'ACTIVE'
                ? 'detail.assignments.deactivateDescription'
                : 'detail.assignments.reactivateDescription',
            )}
            confirmLabel={t(
              statusRow.status === 'ACTIVE'
                ? 'detail.assignments.deactivateShort'
                : 'detail.assignments.reactivateShort',
            )}
            busy={update.isPending}
            onConfirm={handleStatusConfirm}
          />
        )}

        {gridAssignmentId && (
          <FullPageShell
            title={
              gridRow
                ? t('detail.submissions.title', { target: assignmentTargetLabel(gridRow, t) })
                : t('detail.submissions.titleFallback')
            }
            onClose={closeGrid}
            dirty={gridDirty}
            size="wide"
          >
            <p className="text-text-secondary">
              {t(`detail.submissions.help.${homework.grading_mode}`, {
                max: formatNumber(HOMEWORK_MARKS_MAX, regionConfig),
              })}
            </p>
            {assignmentsQuery.data !== undefined && gridRow === undefined ? (
              // The id is not a row of THIS homework: never show a grid for it.
              <ErrorState
                message={t('detail.submissions.notFound')}
                retryLabel={tCommon('actions.close')}
                onRetry={closeGrid}
              />
            ) : submissionsQuery.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : submissionsQuery.isError ? (
              rowGone(submissionsQuery.error) || isNotFoundError(submissionsQuery.error) ? (
                <ErrorState
                  message={t('detail.submissions.notFound')}
                  retryLabel={tCommon('actions.close')}
                  onRetry={closeGrid}
                />
              ) : (
                <ErrorState
                  message={t('detail.submissions.loadError')}
                  retryLabel={tCommon('actions.retry')}
                  onRetry={() => void submissionsQuery.refetch()}
                />
              )
            ) : gridRows === undefined || gridRows.length === 0 ? (
              <EmptyState
                title={t('detail.submissions.emptyTitle')}
                explanation={t('detail.submissions.emptyExplanation')}
              />
            ) : (
              <SubmissionGrid
                key={gridAssignmentId}
                gradingMode={homework.grading_mode}
                rows={gridRows}
                onSave={handleGrade}
                onDirtyChange={setGridDirty}
              />
            )}
          </FullPageShell>
        )}
      </div>
    </RegionConfigProvider>
  );
}

/** 400/404 on a row action means the row was superseded, removed or taken out of scope. */
const rowGone = (err: unknown) =>
  err instanceof ApiError && (err.statusCode === 400 || err.statusCode === 404);

/** #3172: 409 `HOMEWORK_TARGET_TAKEN` = that section or student already has an ACTIVE row. */
const targetTaken = (err: unknown) =>
  err instanceof ApiError &&
  err.statusCode === 409 &&
  err.details?.['code'] === 'HOMEWORK_TARGET_TAKEN';

function DueDateForm({
  row,
  isPending,
  error,
  onSubmit,
}: {
  row: HomeworkAssignmentListItem;
  isPending: boolean;
  error?: string;
  onSubmit: (iso: string) => void;
}) {
  const { t } = useTranslation('homework');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useRegionConfig();
  const [due, setDue] = React.useState<Date | undefined>(() => parseServerDate(row.due_date));
  const [fieldError, setFieldError] = React.useState<string | undefined>();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isPending) return;
    const message = !due
      ? t('form.errorDate')
      : toIsoDate(due) < row.assigned_date
        ? t('form.dueBeforeAssigned')
        : undefined;
    setFieldError(message);
    if (message || !due) {
      document.getElementById('homework-due-only')?.focus();
      return;
    }
    onSubmit(toIsoDate(due));
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="homework-due-only" className="text-label text-text-primary">
          {t('form.dueDateLabel')}
        </label>
        <DatePicker
          id="homework-due-only"
          aria-label={t('form.dueDateLabel')}
          config={regionConfig}
          value={due}
          onValueChange={setDue}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'homework-due-only-error' : undefined}
        />
        {fieldError && (
          <p id="homework-due-only-error" className="text-caption text-destructive">
            {fieldError}
          </p>
        )}
      </div>
      {error !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            {tCommon('actions.cancel')}
          </Button>
        </DialogClose>
        <Button type="submit" loading={isPending}>
          {tCommon('actions.save')}
        </Button>
      </div>
    </form>
  );
}

function HomeworkDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
