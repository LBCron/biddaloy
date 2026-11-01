/**
 * [26.7.1] Promotion run preview — merit-order grid with keyboard outcome
 * setting, override notes, group assignment, refresh and commit. Clones
 * `marks/$examId.$sectionId.$subjectId.tsx`'s desktop-grid/phone-stepper
 * split (same `MOBILE_BREAKPOINT`, same `useIsMobile`) and its
 * `Ctrl+Enter` submit shortcut, adapted to promotions' own columns.
 *
 * Keyboard model: the "final decision" in each row is a kit `Select`. Its closed trigger
 * handles `P`/`R`/`G` (set the outcome), `ArrowUp`/`ArrowDown` (same trigger on the
 * previous/next row) and `ArrowRight` (that row's group `Select`); every other printable key
 * is swallowed so Radix type-to-search cannot change a decision, while Space/Enter still open
 * the list. The group `Select` and reason `Input` are reached by `Tab`. Ctrl/Cmd+Enter opens
 * Finalise from anywhere (not while the delete confirm is open).
 *
 * Each change calls `useUpdatePromotionEntries` — immediately for
 * outcome/group, debounced for the note text (a note is typically
 * several keystrokes; batching those avoids one PATCH per character).
 */
import { Permission, type PromotionOutcome } from '@biddaloy/shared';
import { ApiError, isNotFoundError } from '@biddaloy/ui/api';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  RecordNotFoundState,
  Input,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  toast,
  type StatusTone,
  HelpHint,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useAllClasses,
  useClassSections,
  useCommitPromotionRun,
  useDeletePromotionRun,
  useHasPermission,
  useOrganisationVocabulary,
  usePromotionRun,
  promotionRunQueryOptions,
  useRefreshPromotionRun,
  useUpdatePromotionEntries,
  useUser,
  type PatchPromotionEntryInput,
  type PromotionEntry,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, type DetailShellAction } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CircleCheckIcon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { CommitDialog } from './-commit-dialog';
import { PromotionEntryCard } from './-entry-card';

const MOBILE_BREAKPOINT = 768;
const NOTE_DEBOUNCE_MS = 500;
const NONE_VALUE = ' (none)';
const OUTCOME_KEY: Record<PromotionOutcome, string> = {
  PROMOTE: 'outcome.promote',
  RETAIN: 'outcome.retain',
  GRADUATE: 'outcome.graduate',
  CONDITIONAL: 'outcome.conditional',
};

const PLACEMENT_ERROR_KEY: Record<string, string> = {
  OVER_CAPACITY: 'grid.placementError.OVER_CAPACITY',
  NO_ELIGIBLE_SECTION: 'grid.placementError.NO_ELIGIBLE_SECTION',
};

export const Route = createFileRoute('/_staff/promotions/$runId')({
  loader: ({ context: { queryClient }, params: { runId } }) =>
    Promise.all([
      queryClient.ensureQueryData(promotionRunQueryOptions(runId)).catch(swallowUnlessOffline),
      loadRouteNamespaces('promotions', 'common'),
    ]),
  pendingComponent: PromotionRunPending,
  component: PromotionRunPage,
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

interface EntryEdit {
  final_outcome?: PromotionOutcome;
  group_name?: string;
  override_note?: string;
}

function apiErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError
    ? (error.details as { code?: string } | undefined)?.code
    : undefined;
}

function PromotionRunPage() {
  const { runId } = Route.useParams();
  const { t } = useTranslation('promotions');
  const config = useRegionConfig();
  const navigate = Route.useNavigate();
  const isMobile = useIsMobile();
  const canManage = useHasPermission(Permission.PROMOTION_MANAGE);

  const runQuery = usePromotionRun(runId);
  const updateEntries = useUpdatePromotionEntries(runId);
  const refreshRun = useRefreshPromotionRun(runId);
  const deleteRun = useDeletePromotionRun();
  const commitRun = useCommitPromotionRun(runId);
  const vocabulary = useOrganisationVocabulary();

  const queryClient = useQueryClient();
  const [edits, setEdits] = React.useState<ReadonlyMap<string, EntryEdit>>(new Map());
  // Written synchronously alongside `setEdits` (see `writeEdit`) so a
  // handler — or a debounce timer firing later — can build a request from
  // the edit it just made, not the previous render's copy.
  const editsRef = React.useRef<ReadonlyMap<string, EntryEdit>>(new Map());
  const [noteErrors, setNoteErrors] = React.useState<ReadonlySet<string>>(new Set());
  const [commitOpen, setCommitOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  // Set when a decision becomes an override; the reason input mounts on that render, so the
  // focus moves in an effect rather than a frame callback that could run before it exists.
  const [focusNoteFor, setFocusNoteFor] = React.useState<string | null>(null);
  const [staleBanner, setStaleBanner] = React.useState(false);
  const [cohortChangedBanner, setCohortChangedBanner] = React.useState(false);
  const [mobileIndex, setMobileIndex] = React.useState(0);

  const noteTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const focusRefs = React.useRef(new Map<string, HTMLElement>());
  // Radix returns focus to the Select trigger after our effect; this lets the close handler
  // send it to the reason box instead.
  const noteFocusPending = React.useRef<string | null>(null);

  React.useEffect(
    () => () => {
      for (const timer of noteTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const run = runQuery.data;
  const classesQuery = useAllClasses();
  const yearsQuery = useAcademicYears({ limit: 100 });
  const sectionsQuery = useClassSections(run?.target_class_id ?? undefined);
  const committedByQuery = useUser(run?.committed_by_user_id ?? undefined);
  const approvedByQuery = useUser(run?.approved_by_user_id ?? undefined);

  React.useEffect(() => {
    if (focusNoteFor === null) return;
    focusRefs.current.get(`note:${focusNoteFor}`)?.focus();
    setFocusNoteFor(null);
  }, [focusNoteFor]);

  // Same rule as the Commit button (`!readOnly && canManage`): the shortcut
  // must not open the dialog on a committed run or for a role that can't
  // commit.
  const canCommit = run?.status === 'DRAFT' && canManage;
  React.useEffect(() => {
    if (typeof window === 'undefined' || !canCommit || deleteOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        setCommitOpen(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canCommit, deleteOpen]);

  if (runQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (isNotFoundError(runQuery.error)) {
    return <RecordNotFoundState onBack={() => void navigate({ to: '/promotions' })} />;
  }

  if (runQuery.isError || !run) {
    return (
      <ErrorState
        message={t('grid.loadError')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => void runQuery.refetch()}
      />
    );
  }

  const readOnly = run.status === 'COMMITTED';
  const groups = vocabulary.data?.groups ?? [];
  const sectionNames = new Map(
    (sectionsQuery.data ?? []).map((section) => [section.id, section.section_name]),
  );
  const classNames = new Map((classesQuery.data ?? []).map((cls) => [cls.id, cls.name]));
  const yearNames = new Map((yearsQuery.data?.data ?? []).map((year) => [year.id, year.name]));

  const entries = [...run.entries].sort(
    (a, b) => (a.merit_rank ?? Number.MAX_SAFE_INTEGER) - (b.merit_rank ?? Number.MAX_SAFE_INTEGER),
  );

  function effective(entry: PromotionEntry): {
    final_outcome: PromotionOutcome;
    group_name: string | null;
    override_note: string | null;
  } {
    const edit = edits.get(entry.student_id);
    return {
      final_outcome: edit?.final_outcome ?? entry.final_outcome,
      group_name: edit?.group_name ?? entry.group_name,
      override_note: edit?.override_note ?? entry.override_note,
    };
  }

  function isOverride(entry: PromotionEntry): boolean {
    return effective(entry).final_outcome !== entry.suggested_outcome;
  }

  // The server re-places the saved FINAL outcomes after every PATCH, so its
  // placement_error is for the saved outcome. It applies only while that is
  // still what is on screen: an unsaved local change has no fresh placement.
  function placementProblem(entry: PromotionEntry) {
    const saved = entry.final_outcome;
    if (saved !== 'PROMOTE' && saved !== 'CONDITIONAL') return null;
    return saved === effective(entry).final_outcome ? entry.placement_error : null;
  }

  const counts = entries.reduce(
    (acc, entry) => {
      const outcome = effective(entry).final_outcome;
      if (outcome === 'PROMOTE' || outcome === 'CONDITIONAL') acc.promoted += 1;
      else if (outcome === 'RETAIN') acc.retained += 1;
      else acc.graduated += 1;
      const override = isOverride(entry);
      if (override) acc.overrides += 1;
      if (placementProblem(entry)) acc.errors += 1;
      return acc;
    },
    { promoted: 0, retained: 0, graduated: 0, overrides: 0, errors: 0 },
  );

  const hasPlacementErrors = counts.errors > 0;
  const hasUnnotedOverrides = entries.some((entry) => {
    if (!isOverride(entry)) return false;
    const note = effective(entry).override_note;
    return !note || note.trim() === '';
  });

  function writeEdit(studentId: string, input: EntryEdit) {
    const next = new Map(editsRef.current);
    next.set(studentId, { ...next.get(studentId), ...input });
    editsRef.current = next;
    setEdits(next);
  }

  function cancelNoteTimer(studentId: string) {
    const timer = noteTimers.current.get(studentId);
    if (timer) clearTimeout(timer);
    noteTimers.current.delete(studentId);
  }

  // The server rejects an override without a note (422) and nulls the note
  // on a non-override, so an outcome and its note must travel together.
  // Builds the full intended state of one row, or `null` when there is
  // nothing valid to send yet (an override still waiting for its note —
  // `hasUnnotedOverrides` blocks commit meanwhile). Reads the server row
  // from the query cache, not the render's `run`, because a note debounce
  // calls this after that render is stale.
  function buildBody(studentId: string): PatchPromotionEntryInput | null {
    const entry = queryClient
      .getQueryData(promotionRunQueryOptions(runId).queryKey)
      ?.entries.find((candidate) => candidate.student_id === studentId);
    const edit = editsRef.current.get(studentId);
    if (!entry || !edit) return null;
    const finalOutcome = edit.final_outcome ?? entry.final_outcome;
    const group = edit.group_name !== undefined ? { group_name: edit.group_name } : {};
    if (finalOutcome === entry.suggested_outcome) {
      return { student_id: studentId, final_outcome: finalOutcome, ...group };
    }
    const note = (edit.override_note ?? entry.override_note ?? '').trim();
    if (!note) return null;
    return { student_id: studentId, final_outcome: finalOutcome, override_note: note, ...group };
  }

  // `mutateAsync`, not `mutate(…, { onError })`: per-call callbacks only
  // fire for the latest call, so an earlier failed save would go unreported.
  function send(bodies: PatchPromotionEntryInput[]): Promise<boolean> {
    return updateEntries.mutateAsync(bodies).then(
      () => true,
      (error: unknown) => {
        if (!(error instanceof ApiError && error.statusCode === 403)) {
          toast.error(t('grid.saveFailed'));
        }
        return false;
      },
    );
  }

  function setOutcome(entry: PromotionEntry, outcome: PromotionOutcome) {
    writeEdit(entry.student_id, { final_outcome: outcome });
    cancelNoteTimer(entry.student_id);
    const body = buildBody(entry.student_id);
    if (body) void send([body]);
    if (outcome !== entry.suggested_outcome) {
      // Override: jump focus to this row's note input (D-required note).
      setFocusNoteFor(entry.student_id);
      noteFocusPending.current = entry.student_id;
    }
  }

  function setGroup(entry: PromotionEntry, group: string) {
    // The server's PATCH DTO only accepts a real group name (never `null`,
    // see `promotions.dto.ts`'s `group_name?: string` and
    // `promotions.service.ts:496`'s `patch.group_name !== undefined` guard
    // — there is no "clear the group" operation to call). Picking the
    // placeholder item back is a no-op, not a write.
    if (group === NONE_VALUE) return;
    writeEdit(entry.student_id, { group_name: group });
    // Group alone, not the merged row: the server re-derives the outcome
    // from its own copy, and a merged body carrying a not-yet-noted
    // override would be rejected and take the group change down with it.
    void send([{ student_id: entry.student_id, group_name: group }]);
  }

  function setNote(studentId: string, note: string) {
    writeEdit(studentId, { override_note: note });
    setNoteErrors((prev) => {
      if (note.trim() === '') return prev;
      if (!prev.has(studentId)) return prev;
      const next = new Set(prev);
      next.delete(studentId);
      return next;
    });
    cancelNoteTimer(studentId);
    const timer = setTimeout(() => {
      noteTimers.current.delete(studentId);
      // Only an override's note is worth a write; a blank note is never
      // sent (the DTO rejects it).
      const body = buildBody(studentId);
      if (body?.override_note) void send([body]);
    }, NOTE_DEBOUNCE_MS);
    noteTimers.current.set(studentId, timer);
  }

  function blurNote(entry: PromotionEntry) {
    if (!isOverride(entry)) return;
    const note = effective(entry).override_note;
    setNoteErrors((prev) => {
      const next = new Set(prev);
      if (!note || note.trim() === '') next.add(entry.student_id);
      else next.delete(entry.student_id);
      return next;
    });
  }

  function focusOutcomeCell(rowIndex: number) {
    const bounded = Math.max(0, Math.min(entries.length - 1, rowIndex));
    focusRefs.current.get(`outcome:${entries[bounded]?.student_id}`)?.focus();
  }

  function handleOutcomeKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    entry: PromotionEntry,
    rowIndex: number,
  ) {
    const key = event.key;
    // Ctrl/Cmd+Enter is the page-level Finalise shortcut: keep the Select from opening on it.
    if (event.ctrlKey || event.metaKey) {
      if (key === 'Enter') event.preventDefault();
      return;
    }
    if (key === 'p' || key === 'P') {
      event.preventDefault();
      setOutcome(entry, 'PROMOTE');
      return;
    }
    if (key === 'r' || key === 'R') {
      event.preventDefault();
      setOutcome(entry, 'RETAIN');
      return;
    }
    if ((key === 'g' || key === 'G') && run?.target_class_id === null) {
      event.preventDefault();
      setOutcome(entry, 'GRADUATE');
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      focusOutcomeCell(rowIndex + 1);
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      focusOutcomeCell(rowIndex - 1);
      return;
    }
    if (key === 'ArrowRight') {
      event.preventDefault();
      focusRefs.current.get(`group:${entry.student_id}`)?.focus();
      return;
    }
    // Radix type-to-search would pick the option whose label starts with this letter.
    if (key.length === 1 && key !== ' ') event.preventDefault();
  }

  // Only commit can fail with these codes — the entries PATCH never checks
  // result freshness or cohort membership. Without this handler a 409 was
  // swallowed (the global handler only surfaces 403s) and Commit looked
  // like it did nothing.
  async function confirmCommit() {
    // Commit reads only what the server has stored, never this grid's local
    // edits. Resend every edited row first — a note still in its debounce,
    // or any earlier save that failed — so the run is committed exactly as
    // shown. A failed flush stops here; `send` has already toasted.
    for (const timer of noteTimers.current.values()) clearTimeout(timer);
    noteTimers.current.clear();
    const bodies = [...editsRef.current.keys()]
      .map(buildBody)
      .filter((body): body is PatchPromotionEntryInput => body !== null);
    if (bodies.length > 0 && !(await send(bodies))) return;

    commitRun.mutate(undefined, {
      onSuccess: () => setCommitOpen(false),
      onError: (error: unknown) => {
        const code = apiErrorCode(error);
        if (code === 'STALE_RESULTS') {
          setCommitOpen(false);
          setStaleBanner(true);
        } else if (code === 'COHORT_CHANGED') {
          // Refresh re-members the cohort (drops leavers, adds joiners), so
          // the banner carries the Refresh button; then the user commits again.
          setCommitOpen(false);
          setCohortChangedBanner(true);
        } else if (code === 'RETAIN_CLASS_MISSING') {
          // Reachable since #2924: a run can start without a retain class and
          // someone is overridden to Retain later.
          setCommitOpen(false);
          toast.error(t('blocking.retainClassMissing'));
        } else if (error instanceof ApiError && error.statusCode !== 403) {
          toast.error(t('grid.commitFailed'));
        }
      },
    });
  }

  async function refresh() {
    try {
      await refreshRun.mutateAsync();
      setStaleBanner(false);
      setCohortChangedBanner(false);
    } catch (error) {
      if (!(error instanceof ApiError && error.statusCode === 403)) {
        toast.error(t('grid.refreshFailed'));
      }
    }
  }

  function deleteDraft() {
    deleteRun.mutate(runId, {
      onSuccess: () => void navigate({ to: '/promotions' }),
      onError: (error: unknown) => {
        setDeleteOpen(false);
        if (error instanceof ApiError && error.statusCode === 409) {
          // Finalised (or otherwise changed) elsewhere: show the current state.
          toast.error(t('grid.deleteConflict'));
          void queryClient.invalidateQueries({
            queryKey: promotionRunQueryOptions(runId).queryKey,
          });
        } else if (!(error instanceof ApiError && error.statusCode === 403)) {
          toast.error(t('grid.deleteFailed'));
        }
      },
    });
  }

  // `DetailShell`'s name is a plain string: a dash while a lookup loads or the id is unknown.
  const dash = t('list.emptyValue');
  const className = (id: string) => classNames.get(id) ?? dash;
  const sourceClassName = className(run.source_class_id);
  const targetClassName =
    run.target_class_id === null ? t('outcome.graduate') : className(run.target_class_id);
  const nameOr = (value: string | undefined, loading: boolean): React.ReactNode =>
    value ?? (loading ? <Skeleton className="h-4 w-24" /> : dash);
  const algorithmLabel = t(
    run.algorithm === 'BLOCK' ? 'newRunForm.algorithmBlock' : 'newRunForm.algorithmSnake',
  );
  const fmt = (n: number) => formatNumber(n, config);

  const facts: { label: string; value: React.ReactNode }[] = [
    {
      label: t('grid.facts.targetYear'),
      value: nameOr(yearNames.get(run.target_academic_year_id), yearsQuery.isLoading),
    },
    {
      label: t('grid.facts.exams'),
      value: t('grid.facts.examCount', { n: fmt(run.exam_ids.length) }),
    },
    { label: t('grid.facts.algorithm'), value: algorithmLabel },
    {
      label: t('grid.facts.students'),
      value: t('grid.facts.studentCount', { n: fmt(entries.length) }),
    },
  ];
  if (readOnly) {
    facts.push(
      { label: t('grid.facts.committedAt'), value: formatDate(run.committed_at, config) },
      {
        label: t('grid.facts.committedBy'),
        value: run.committed_by_user_id
          ? nameOr(committedByQuery.data?.full_name, committedByQuery.isLoading)
          : dash,
      },
    );
    if (run.approved_by_user_id) {
      facts.push({
        label: t('grid.facts.approvedBy'),
        value: nameOr(approvedByQuery.data?.full_name, approvedByQuery.isLoading),
      });
    }
  }

  const actions: DetailShellAction[] =
    !readOnly && canManage
      ? [
          {
            id: 'refresh',
            helpId: 'examsResults.promotion.action.refresh',
            label: refreshRun.isPending ? t('grid.refreshing') : t('grid.refresh'),
            icon: <RotateCcwIcon aria-hidden="true" />,
            priority: 'secondary',
            busy: refreshRun.isPending,
            onClick: () => void refresh(),
          },
          {
            id: 'commit',
            helpId: 'examsResults.promotion.action.commit',
            label: t('grid.commit'),
            icon: <CircleCheckIcon aria-hidden="true" />,
            priority: 'primary',
            onClick: () => setCommitOpen(true),
          },
          {
            id: 'delete',
            helpId: 'examsResults.promotion.action.delete',
            label: t('grid.delete'),
            icon: <Trash2Icon aria-hidden="true" />,
            priority: 'destructive',
            onClick: () => setDeleteOpen(true),
          },
        ]
      : [];

  const countBadge = (label: string, n: number, tone: StatusTone) => (
    <StatusBadge tone={tone} label={t('grid.countBadge', { label, n: fmt(n) })} />
  );

  // Placement result of one row: the section and roll, a danger badge for a problem, or a dash.
  function placement(entry: PromotionEntry, finalOutcome: PromotionOutcome) {
    if (finalOutcome !== 'PROMOTE' && finalOutcome !== 'CONDITIONAL') return dash;
    const problem = placementProblem(entry);
    if (problem) {
      return (
        <StatusBadge
          tone="danger"
          label={t(PLACEMENT_ERROR_KEY[problem] ?? 'grid.placementError.unknown')}
        />
      );
    }
    const section = sectionNames.get(entry.target_section_id ?? '') ?? dash;
    const roll = entry.new_roll_number === null ? dash : fmt(entry.new_roll_number);
    return `${section} · ${roll}`;
  }

  return (
    <DetailShell
      name={`${sourceClassName} → ${targetClassName}`}
      statusBadge={
        <StatusBadge
          tone={readOnly ? 'success' : 'neutral'}
          label={t(readOnly ? 'list.statusCommitted' : 'list.statusDraft')}
        />
      }
      facts={facts}
      actions={actions}
    >
      <div className="space-y-4">
        <div role="status" aria-label={t('grid.countsLabel')} className="flex flex-wrap gap-2">
          {countBadge(t('grid.counts.promoted'), counts.promoted, 'success')}
          {countBadge(t('grid.counts.retained'), counts.retained, 'warning')}
          {countBadge(t('grid.counts.graduated'), counts.graduated, 'neutral')}
          {countBadge(t('grid.counts.overrides'), counts.overrides, 'info')}
          {countBadge(
            t('grid.counts.errors'),
            counts.errors,
            counts.errors > 0 ? 'danger' : 'neutral',
          )}
        </div>

        {!readOnly && counts.errors > 0 && (
          <AlertCard
            title={t('grid.errorsTitle', { n: fmt(counts.errors) })}
            body={t('grid.errorsBody')}
          />
        )}

        {staleBanner && !readOnly && (
          <AlertCard
            title={t('grid.staleResultsPrompt')}
            action={
              <Button
                type="button"
                variant="outline"
                loading={refreshRun.isPending}
                onClick={() => void refresh()}
              >
                {t('grid.refresh')}
              </Button>
            }
          />
        )}

        {cohortChangedBanner && !readOnly && (
          <AlertCard
            title={t('grid.cohortChangedPrompt')}
            action={
              <Button
                type="button"
                variant="outline"
                loading={refreshRun.isPending}
                onClick={() => void refresh()}
              >
                {t('grid.refresh')}
              </Button>
            }
          />
        )}

        {isMobile ? (
          <PromotionEntryCard
            entries={entries}
            isGraduationRun={run.target_class_id === null}
            index={mobileIndex}
            onIndexChange={setMobileIndex}
            groups={groups}
            readOnly={readOnly}
            effective={effective}
            isOverride={isOverride}
            noteErrors={noteErrors}
            placement={placement}
            config={config}
            onOutcome={setOutcome}
            onGroup={setGroup}
            onNote={setNote}
            onNoteBlur={blurNote}
          />
        ) : (
          <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
            <div className="overflow-x-auto">
              <table className="w-full text-start">
                <caption className="sr-only">{t('grid.tableCaption')}</caption>
                <thead className="border-b border-border-subtle bg-muted text-label text-text-secondary">
                  <tr>
                    <th className="h-10 px-4 text-end font-medium">{t('grid.columnMeritRank')}</th>
                    <th className="h-10 min-w-40 px-4 text-start font-medium">
                      {t('grid.columnStudent')}
                    </th>
                    <th className="h-10 px-4 text-end font-medium">{t('grid.columnMeanGpa')}</th>
                    <th className="h-10 px-4 text-start font-medium">
                      {t('grid.columnSuggested')}
                    </th>
                    <th className="h-10 px-4 text-start font-medium">
                      <span className="inline-flex items-center gap-1">
                        {t('grid.columnFinal')}
                        <HelpHint helpId="examsResults.promotion.field.finalOutcome" />
                      </span>
                    </th>
                    {groups.length > 0 && (
                      <th className="h-10 px-4 text-start font-medium">{t('grid.columnGroup')}</th>
                    )}
                    <th className="h-10 px-4 text-start font-medium">
                      {t('grid.columnPlacement')}
                    </th>
                    <th className="h-10 min-w-40 px-4 text-start font-medium">
                      <span className="inline-flex items-center gap-1">
                        {t('grid.columnOverrideNote')}
                        <HelpHint helpId="examsResults.promotion.field.overrideNote" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {entries.map((entry, rowIndex) => {
                    const eff = effective(entry);
                    const override = isOverride(entry);
                    const noteError = noteErrors.has(entry.student_id);
                    return (
                      <tr key={entry.student_id} className="align-top hover:bg-muted">
                        <td className="px-4 py-1.5 text-end tabular-nums">
                          {entry.merit_rank === null ? dash : fmt(entry.merit_rank)}
                        </td>
                        <td className="px-4 py-1.5">
                          <span className="font-medium">{entry.student_name ?? dash}</span>
                          <span className="block text-caption text-text-secondary">
                            {t('grid.studentRoll', {
                              roll:
                                entry.student_roll_number === null
                                  ? dash
                                  : fmt(entry.student_roll_number),
                            })}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-end tabular-nums">
                          {entry.mean_gpa === null
                            ? dash
                            : formatNumber(Number(entry.mean_gpa), config, { decimals: 2 })}
                        </td>
                        <td className="px-4 py-1.5">{t(OUTCOME_KEY[entry.suggested_outcome])}</td>
                        <td className="px-4 py-1.5">
                          {readOnly ? (
                            t(OUTCOME_KEY[eff.final_outcome])
                          ) : (
                            <>
                              <Select
                                value={eff.final_outcome}
                                onValueChange={(value) =>
                                  setOutcome(entry, value as PromotionOutcome)
                                }
                              >
                                <SelectTrigger
                                  ref={(el) => {
                                    const key = `outcome:${entry.student_id}`;
                                    if (el) focusRefs.current.set(key, el);
                                    else focusRefs.current.delete(key);
                                  }}
                                  aria-label={t('grid.columnFinal')}
                                  className="w-36"
                                  onKeyDown={(event) =>
                                    handleOutcomeKeyDown(event, entry, rowIndex)
                                  }
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent
                                  onCloseAutoFocus={(event) => {
                                    if (noteFocusPending.current !== entry.student_id) return;
                                    noteFocusPending.current = null;
                                    const note = focusRefs.current.get(`note:${entry.student_id}`);
                                    if (note) {
                                      event.preventDefault();
                                      note.focus();
                                    }
                                  }}
                                >
                                  {(Object.keys(OUTCOME_KEY) as PromotionOutcome[])
                                    .filter((outcome) =>
                                      outcome === 'CONDITIONAL'
                                        ? run.target_class_id !== null
                                        : outcome !== 'GRADUATE' || run.target_class_id === null,
                                    )
                                    .map((outcome) => (
                                      <SelectItem key={outcome} value={outcome}>
                                        {t(OUTCOME_KEY[outcome])}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                              {override && (
                                <div className="mt-1">
                                  <StatusBadge tone="info" label={t('grid.overrideChip')} />
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        {groups.length > 0 && (
                          <td className="px-4 py-1.5">
                            <Select
                              value={eff.group_name ?? NONE_VALUE}
                              onValueChange={(value) => setGroup(entry, value)}
                              disabled={readOnly}
                            >
                              <SelectTrigger
                                ref={(el) => {
                                  const key = `group:${entry.student_id}`;
                                  if (el) focusRefs.current.set(key, el);
                                  else focusRefs.current.delete(key);
                                }}
                                aria-label={t('grid.columnGroup')}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem
                                  value={NONE_VALUE}
                                  disabled={eff.group_name != null}
                                  title={
                                    eff.group_name != null
                                      ? t('grid.groupClearUnsupported')
                                      : undefined
                                  }
                                >
                                  {t('grid.groupNone')}
                                </SelectItem>
                                {groups.map((group) => (
                                  <SelectItem key={group} value={group}>
                                    {group}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        )}
                        <td className="px-4 py-1.5">{placement(entry, eff.final_outcome)}</td>
                        <td className="px-4 py-1.5">
                          {readOnly ? (
                            (eff.override_note ?? dash)
                          ) : override ? (
                            <>
                              <Input
                                ref={(el) => {
                                  const key = `note:${entry.student_id}`;
                                  if (el) focusRefs.current.set(key, el);
                                  else focusRefs.current.delete(key);
                                }}
                                aria-label={t('grid.columnOverrideNote')}
                                placeholder={t('grid.notePlaceholder')}
                                value={eff.override_note ?? ''}
                                onChange={(event) => setNote(entry.student_id, event.target.value)}
                                onBlur={() => blurNote(entry)}
                              />
                              {noteError && (
                                <p
                                  role="alert"
                                  className="mt-1 text-caption text-status-overdue-fg"
                                >
                                  {t('grid.noteRequired')}
                                </p>
                              )}
                            </>
                          ) : (
                            dash
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border-subtle px-4 py-3 text-text-secondary">
              {t(readOnly ? 'grid.footerTotal' : 'grid.footerHint', { n: fmt(entries.length) })}
            </p>
          </section>
        )}
      </div>

      {commitOpen && (
        <CommitDialog
          open={commitOpen}
          onOpenChange={setCommitOpen}
          counts={counts}
          config={config}
          hasPlacementErrors={hasPlacementErrors}
          hasUnnotedOverrides={hasUnnotedOverrides}
          confirming={commitRun.isPending || updateEntries.isPending}
          onConfirm={() => void confirmCommit()}
        />
      )}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title={t('grid.deleteConfirm.title')}
        description={t('grid.deleteConfirm.body')}
        confirmLabel={t('grid.deleteConfirm.confirm')}
        cancelLabel={t('grid.deleteConfirm.cancel')}
        busy={deleteRun.isPending}
        onConfirm={deleteDraft}
      />
    </DetailShell>
  );
}

function AlertCard({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <section
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-status-overdue-bg text-status-overdue-fg">
        <TriangleAlertIcon aria-hidden="true" />
      </span>
      <div className="min-w-0 space-y-1">
        <h2 className="text-h3">{title}</h2>
        {body && <p className="text-text-secondary">{body}</p>}
        {action && <div className="pt-2">{action}</div>}
      </div>
    </section>
  );
}

function PromotionRunPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
