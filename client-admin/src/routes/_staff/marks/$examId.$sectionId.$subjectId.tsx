/**
 * [19.7.1] The marks-entry page itself — desktop grid vs. phone stepper,
 * one shared `autosave.ts` instance, D13's header line, `Ctrl+Enter`
 * submit, and read-only-after-submit (D12).
 *
 * Layout switch uses the SAME 768px breakpoint `data-table.tsx` already
 * treats as the app's card-mode threshold (`CARD_MODE_MAX_WIDTH`) — a
 * *viewport* check here (not a container check) is correct because this
 * page, unlike a reusable table, always fills the whole content area.
 */
import { Permission, UserRole } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  cellKey,
  ConfirmDialog,
  ErrorState,
  HelpHint,
  MarksGrid,
  MarksStepper,
  RoutePending,
  Skeleton,
  StatusBadge,
  TableCount,
} from '@biddaloy/ui/components';
import {
  useActiveRole,
  useExamProgress,
  useExams,
  useHasPermission,
  useMarkGrid,
  useAutosave,
  useReopenMarkGrid,
  useSubmitMarkGrid,
  saveMarkBatch,
  type MarkGridCell,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { formatDateTime, formatNumber, formatTime } from '@biddaloy/ui/utils';
import { createFileRoute, useBlocker } from '@tanstack/react-router';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
  SendIcon,
} from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { SubmitDialog } from './-submit-dialog';

const MOBILE_BREAKPOINT = 768;

export const Route = createFileRoute('/_staff/marks/$examId/$sectionId/$subjectId')({
  // The grid data itself loads through the page's own `useMarkGrid` (a
  // normal `useQuery`, not `ensureQueryData`) — the composed grid response
  // depends on `examId`+`sectionId`+`subjectId` together, and this loader
  // has nothing cheaper to prefetch than that same request, so it only
  // needs to warm the i18n namespace before the component renders.
  loader: () => loadRouteNamespaces('exams', 'grading', 'common'),
  pendingComponent: MarksGridPending,
  component: MarksEntryPage,
});

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(
    () =>
      typeof matchMedia === 'function' &&
      matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches,
  );
  React.useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = () => setIsMobile(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

function MarksEntryPage() {
  const { examId, sectionId, subjectId } = Route.useParams();
  const { t } = useTranslation('exams');
  const { t: tg, i18n } = useTranslation('grading');
  const config = useRegionConfig();
  const isMobile = useIsMobile();
  // Context for the subtitle. Both reads are allowed for a teacher (the exam
  // list and the progress list `/marks` already loads); `GET /exams/:id`
  // would 403 without EXAM_MANAGE.
  const exam = useExams({ limit: 50 }).data?.data.find((e) => e.id === examId);
  const progressRows = useExamProgress(examId).data?.grids;
  // The subject name only from this exact section + subject row; any row of
  // the section still names the section, but must never lend its subject name.
  const row = progressRows?.find((r) => r.section_id === sectionId && r.subject_id === subjectId);
  const sectionRow = row ?? progressRows?.find((r) => r.section_id === sectionId);
  const role = useActiveRole();
  // Entering and submitting marks both need MARK_ENTER (the controller's own
  // gate for PATCH and POST submit), not EXAM_MANAGE — a TEACHER holds
  // MARK_ENTER for their own sections without holding EXAM_MANAGE. A
  // MARK_VIEW-only role (EXAM_CONTROLLER, EXECUTIVE) sees the grid read-only.
  const canEnter = useHasPermission(Permission.MARK_ENTER);

  const gridQuery = useMarkGrid(examId, sectionId, subjectId);
  const submitGrid = useSubmitMarkGrid(examId, sectionId, subjectId);
  const reopenGrid = useReopenMarkGrid(examId, sectionId, subjectId);
  const submitted = gridQuery.data?.state === 'SUBMITTED';
  // One gate for the Submit button and its Ctrl/Cmd+Enter shortcut.
  const canSubmit = gridQuery.data !== undefined && !submitted && canEnter;

  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [flushing, setFlushing] = React.useState(false);

  const autosave = useAutosave<MarkGridCell>({
    save: async (batch) => {
      await saveMarkBatch(examId, sectionId, subjectId, [...batch.values()]);
    },
  });

  // Every cell edited on this page, newest value wins. `grid.cells` is the
  // page-load snapshot and autosave never patches it, so the submit
  // dialog's blank count reads these edits over it.
  const [edits, setEdits] = React.useState<ReadonlyMap<string, MarkGridCell>>(new Map());
  const { stage: autosaveStage } = autosave;
  const stage = React.useCallback(
    (key: string, cell: MarkGridCell) => {
      setEdits((prev) => new Map(prev).set(key, cell));
      autosaveStage(key, cell);
    },
    [autosaveStage],
  );

  // Submit locks the grid server-side, so any mark still staged (in the
  // debounce window, in flight, or failed) would be rejected afterwards and
  // lost. Save everything first; if that fails, close the dialog so the
  // save-state line's error is visible, and don't submit.
  async function confirmSubmit() {
    setFlushing(true);
    const saved = await autosave.flush();
    setFlushing(false);
    if (!saved) {
      setSubmitOpen(false);
      return;
    }
    submitGrid.mutate(undefined, {
      onSuccess: () => setSubmitOpen(false),
    });
  }

  // A blocking `Dialog`, not `window.confirm` — `no-window-alert` forbids
  // the native dialog, and `withResolver: true` gives us `resolver.proceed`
  // /`reset` to wire a real one to the pending navigation.
  const blocker = useBlocker({
    shouldBlockFn: () => autosave.pendingCount > 0,
    withResolver: true,
  });

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!canSubmit) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        setSubmitOpen(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canSubmit]);

  if (gridQuery.isPending) {
    return (
      <PageContainer>
        <div aria-busy="true" className="space-y-3">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
          <div className="space-y-2 rounded-lg border border-border-subtle bg-surface p-4">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </PageContainer>
    );
  }
  if (gridQuery.isError) {
    return (
      <PageContainer>
        <ErrorState message={t('marksList.loadError')} onRetry={() => void gridQuery.refetch()} />
      </PageContainer>
    );
  }

  const grid = gridQuery.data;
  const readOnly = submitted || !canEnter;
  const canReopen = submitted && role === UserRole.ADMIN;

  const blankCount = grid.students.reduce((count, student) => {
    // A late joiner, or a student who does not take this subject, owes no
    // marks: their empty row never blocks submit (same rule as the server).
    if (student.joined_after_exam || student.not_taking) return count;
    const missing = grid.components
      .filter((c) => c.source !== 'DERIVED')
      .some((component) => {
        const cell =
          edits.get(cellKey(student.id, component.id)) ??
          grid.cells.find((c) => c.student_id === student.id && c.component_id === component.id);
        return !cell || (cell.value === null && cell.status === 'PRESENT');
      });
    return missing ? count + 1 : count;
  }, 0);

  const saveState =
    autosave.state === 'saving'
      ? 'saving'
      : autosave.state === 'error'
        ? 'error'
        : autosave.lastSavedAt
          ? 'saved'
          : 'idle';
  const saveStateLine =
    saveState === 'saving'
      ? t('saveState.saving')
      : saveState === 'error'
        ? tg('marksSheet.saveError', {
            count: autosave.pendingCount,
            n: formatNumber(autosave.pendingCount, config),
          })
        : saveState === 'saved'
          ? t('saveState.saved', { time: formatTime(autosave.lastSavedAt, config) })
          : t('saveState.idle');
  const SaveIcon =
    saveState === 'saving'
      ? LoaderCircleIcon
      : saveState === 'error'
        ? CircleAlertIcon
        : saveState === 'saved'
          ? CircleCheckIcon
          : CircleDashedIcon;

  const bn = i18n.language === 'bn';
  const subject = bn ? (row?.subject_name_bn ?? row?.subject_name) : row?.subject_name;
  const studentCount = grid.students.length;
  const subtitle = [
    subject,
    sectionRow ? tg('marksEntry.sectionValue', { name: sectionRow.section_name }) : undefined,
    exam?.name,
    tg('marksSheet.studentCount', { count: studentCount, n: formatNumber(studentCount, config) }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PageContainer>
      <header className="flex flex-col gap-3 md:sticky md:top-14 md:z-20 md:flex-row md:items-start md:justify-between md:gap-6 md:bg-bg md:py-2">
        <div className="min-w-0">
          <h1 className="text-h1">{t('marksGrid.caption')}</h1>
          <p className="mt-0.5 text-text-secondary">{subtitle}</p>
          {!submitted && (
            <p
              className={`mt-2 flex items-center gap-1.5 ${
                saveState === 'error' ? 'text-destructive' : 'text-text-secondary'
              }`}
              role="status"
              aria-live="polite"
              data-testid="save-state-line"
            >
              <SaveIcon
                aria-hidden="true"
                className={`size-4 shrink-0 ${
                  saveState === 'saving'
                    ? 'animate-spin'
                    : saveState === 'saved'
                      ? 'text-status-paid-fg'
                      : ''
                }`}
              />
              {saveStateLine}
            </p>
          )}
        </div>
        {canSubmit && (
          <div className="flex w-full shrink-0 items-center gap-2 md:w-auto">
            <Button
              type="button"
              className="flex-1 md:flex-none"
              aria-keyshortcuts="Control+Enter"
              onClick={() => setSubmitOpen(true)}
            >
              <SendIcon aria-hidden="true" />
              {t('submitDialog.confirm')}
            </Button>
            <HelpHint helpId="examsResults.marksEntry.action.submit" />
          </div>
        )}
      </header>

      {submitted && (
        <div className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
              <StatusBadge tone="success" label={tg('marksEntry.statusSubmitted')} />
              <p className="text-text-secondary">
                {tg('marksSheet.submittedAt', {
                  time: formatDateTime(grid.submitted_at, config),
                })}
              </p>
            </div>
            {reopenGrid.isError && (
              <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
                <CircleAlertIcon aria-hidden="true" className="size-3.5" />
                {tg('marksSheet.reopenError')}
              </p>
            )}
            {canReopen && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  loading={reopenGrid.isPending}
                  onClick={() => reopenGrid.mutate()}
                >
                  {tg('marksSheet.reopen')}
                </Button>
                <HelpHint helpId="examsResults.marksEntry.action.reopen" />
              </div>
            )}
          </div>
        </div>
      )}

      {isMobile ? (
        <div className="space-y-3">
          {/* One (?) for the page, not one per mark input. */}
          {!readOnly && <HelpHint helpId="examsResults.marksEntry.field.mark" />}
          <MarksStepper
            students={grid.students}
            components={grid.components}
            cells={grid.cells}
            derived={grid.derived}
            readOnly={readOnly}
            onStage={stage}
            pendingKeys={autosave.pendingKeys}
            failedKeys={autosave.failedKeys}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {!readOnly && (
            <p className="text-caption text-text-secondary">
              <KeyboardHelp text={tg('marksSheet.keyboardHelp')} />{' '}
              <HelpHint helpId="examsResults.marksEntry.field.mark" />
            </p>
          )}
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
            <MarksGrid
              students={grid.students}
              components={grid.components}
              cells={grid.cells}
              derived={grid.derived}
              readOnly={readOnly}
              onStage={stage}
              pendingKeys={autosave.pendingKeys}
              failedKeys={autosave.failedKeys}
            />
            <div className="border-t border-border-subtle px-4 py-3">
              <TableCount total={studentCount} />
            </div>
          </div>
        </div>
      )}

      <SubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        blankCount={blankCount}
        confirming={flushing || submitGrid.isPending}
        error={
          submitGrid.error instanceof ApiError &&
          submitGrid.error.details?.code === 'GRID_INCOMPLETE'
            ? tg('marksSheet.blankBlocksSubmit', {
                count: Number(submitGrid.error.details.blank_count ?? 1),
                n: formatNumber(Number(submitGrid.error.details.blank_count ?? 1), config),
              })
            : submitGrid.isError
              ? tg('marksSheet.submitError')
              : undefined
        }
        onConfirm={() => void confirmSubmit()}
      />

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        tone="danger"
        title={tg('marksSheet.leaveTitle')}
        description={tg('marksSheet.leaveText', {
          count: autosave.pendingCount,
          n: formatNumber(autosave.pendingCount, config),
        })}
        cancelLabel={tg('marksSheet.stay')}
        confirmLabel={t('saveState.leaveAnyway')}
        onConfirm={() => blocker.proceed?.()}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      />
    </PageContainer>
  );
}

/** Renders `<k>…</k>` markers of a translated string as `<kbd>`. */
function KeyboardHelp({ text }: { text: string }) {
  return (
    <>
      {text.split(/(<k>.*?<\/k>)/).map((part, i) =>
        part.startsWith('<k>') ? (
          <kbd key={i} className="rounded-sm border border-border-subtle bg-muted px-1 font-sans">
            {part.slice(3, -4)}
          </kbd>
        ) : (
          part
        ),
      )}
    </>
  );
}

function MarksGridPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
