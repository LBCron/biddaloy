/**
 * [9.6] The marking screen. `?date=`/`?period=` are the single source of
 * truth for "which day am I marking" — draft state is keyed off them, not
 * held independently, so a date change never leaves two disagreeing
 * answers to that question in play at once.
 */
import { AttendanceStatus, Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  HelpHint,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Label,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  StatusBadge,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from '@biddaloy/ui/components';
import {
  sectionRegisterQueryOptions,
  useActiveTenant,
  useHasPermission,
  useOnline,
  useSchoolSettings,
  useSectionRegister,
  useSubmitRegister,
  type PutRegisterInput,
  type Register,
  type RegisterStudent,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { parseDate, tenantTodayIso, toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import {
  CalendarClock,
  CheckCheck,
  Info,
  MoreVertical,
  RotateCcw,
  Send,
  UserX,
} from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ConflictDialog } from './-conflict-dialog';
import { CorrectionDialog } from './-correction-dialog';
import { PeriodSwitcher } from './-period-switcher';
import { RecordHistoryPanel } from './-record-history-panel';
import { RosterMarker, useArrivalBells, type Draft } from './-roster-marker';

// Browser-local, not `.toISOString()` (UTC), for the search-schema default
// only: `validateSearch` runs outside React, before the tenant's timezone is
// known. The future-date gate below uses `tenantTodayIso` — the server's own
// "today" — because a skew there would wrongly allow or deny the LEAVE-only
// future-date path.
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const searchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(() => todayIso()),
  period: z.coerce.number().int().min(1).max(30).optional().catch(undefined),
});

/** Reasons the server can give for a read-only register; anything else gets the generic banner. */
const KNOWN_WRITE_REASONS = new Set(['CLASS_TEACHER_ONLY', 'FIRST_PERIOD_ONLY', 'DEVICE_SCHOOL']);

export const Route = createFileRoute('/_staff/attendance/$sectionId')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ date: search.date, period: search.period }),
  loader: ({ context: { queryClient }, params, deps }) =>
    Promise.all([
      queryClient
        .ensureQueryData(sectionRegisterQueryOptions(params.sectionId, deps.date, deps.period))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('attendance'),
    ]),
  component: SectionRegisterPage,
});

function draftKey(
  tenantId: string | null,
  sectionId: string,
  date: string,
  period?: number,
): string {
  // The period suffix keeps a day draft and a period draft from overwriting each other.
  return `attendance-draft:${tenantId ?? 'no-tenant'}:${sectionId}:${date}${period === undefined ? '' : `:${period}`}`;
}

function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Best-effort — a lost draft-persistence write is recoverable (the
    // in-memory draft still submits), unlike a lost server write.
  }
}

function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // See `writeDraft`.
  }
}

function seedDraft(register: Register, prefill = false): Draft {
  const draft: Draft = {};
  for (const student of register.students) {
    draft[student.student_id] = {
      // `schema.d.ts`'s generated `RegisterStudentDto.status` is the bare
      // string-literal union (`openapi-typescript` doesn't reference
      // `@biddaloy/shared`'s enum), not `AttendanceStatus` itself —
      // structurally identical, so the cast is safe.
      status: (student.status ??
        (prefill ? student.suggested_status : null)) as AttendanceStatus | null,
      minutes_late: student.minutes_late,
    };
  }
  return draft;
}

function SectionRegisterPage() {
  const { t } = useTranslation('attendance');
  const { sectionId } = Route.useParams();
  const { date, period } = Route.useSearch();
  const navigate = Route.useNavigate();
  const tenantId = useActiveTenant();
  const online = useOnline();
  const canMark = useHasPermission(Permission.ATTENDANCE_MARK);
  // [9.7] `register.editable === false` already implies the caller lacks
  // ATTENDANCE_CORRECT server-side — `attendance.service.ts`'s own
  // `editable` formula ORs every one of its window/finalized/non-working
  // checks with `hasCorrect`, so a caller who *does* hold it always gets
  // `editable: true` and edits inline via the normal marking flow. This
  // flag only ever matters for a future role/permission mapping that
  // grants ATTENDANCE_CORRECT without full marking rights.
  const canCorrect = useHasPermission(Permission.ATTENDANCE_CORRECT);
  const canSeeArrival = useHasPermission(Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE);
  const arrivalSubscribed = useArrivalBells(sectionId, canSeeArrival);
  const regionConfig = useTenantRegionConfig();

  const registerQuery = useSectionRegister(sectionId, date, period);
  const submitRegister = useSubmitRegister(sectionId);

  const [correctionStudentId, setCorrectionStudentId] = React.useState<string | null>(null);
  const [historyStudentId, setHistoryStudentId] = React.useState<string | null>(null);

  const storageKey = draftKey(tenantId, sectionId, date, period);
  const canManageRoutines = useHasPermission(Permission.ROUTINE_MANAGE);
  // Hint only: the settings read needs SETTINGS_MANAGE server-side, so a caller without it
  // simply gets no hint. `''` keeps the query disabled for everyone else.
  const settingsQuery = useSchoolSettings(canManageRoutines ? (tenantId ?? '') : '');
  const periodsEnabled = settingsQuery.data?.attendance?.periodAttendance?.enabled === true;
  // The draft carries the storage key it was seeded for, so it is only ever
  // persisted under that key. A ref here was not enough: React can re-mount
  // this page keeping refs but resetting state (seen in the production build),
  // and the empty initial draft was then written over the real one.
  const [draftState, setDraftState] = React.useState<{ key: string | null; draft: Draft }>({
    key: null,
    draft: {},
  });
  const draft = draftState.draft;
  const setDraft = (next: React.SetStateAction<Draft>) =>
    setDraftState((current) => ({
      key: current.key,
      draft: typeof next === 'function' ? next(current.draft) : next,
    }));
  // Mirrors the server's two reason checks in `putRegister`: outside the correction window
  // (`reason_required`) and on an already-finalized session.
  // `reasonForced`: the server asked for one after this page loaded (another editor finalized it).
  const [reasonForced, setReasonForced] = React.useState(false);
  const needsReason =
    !!registerQuery.data &&
    (reasonForced ||
      registerQuery.data.reason_required ||
      (registerQuery.data.session.id !== null && registerQuery.data.session.state === 'FINALIZED'));
  const [reason, setReason] = React.useState('');
  const [reasonError, setReasonError] = React.useState(false);
  const reasonRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    setReason('');
    setReasonError(false);
    setReasonForced(false);
  }, [storageKey]);
  // The field mounts one render after a server refusal reveals it.
  React.useEffect(() => {
    if (reasonError) reasonRef.current?.focus();
  }, [reasonError, reasonForced]);
  const [confirmUnmarkedOpen, setConfirmUnmarkedOpen] = React.useState(false);
  const [conflict, setConflict] = React.useState<{
    currentRegister: Register | undefined;
    currentVersion: number | undefined;
  } | null>(null);

  React.useEffect(() => {
    // A tab switch renders the previous tab's draft once under the new key: skip it.
    if (registerQuery.data && draftState.key === storageKey) writeDraft(storageKey, draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist on every draft change, key derived above
  }, [draftState, storageKey]);

  // Seeds from a saved local draft first (survives a reload while
  // offline), falling back to the server's register — see the plan's
  // "Draft state" section.
  React.useEffect(() => {
    if (!registerQuery.data) return;
    const saved = readDraft(storageKey);
    // D8: a fresh period register (no session yet, no local draft) starts from the suggestions.
    const prefill = !saved && period !== undefined && !registerQuery.data.session.id;
    setDraftState({ key: storageKey, draft: saved ?? seedDraft(registerQuery.data, prefill) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only on section/date/period change, not every draft edit
  }, [sectionId, date, period, registerQuery.data]);

  // Stale tab after the tenant switch was turned off: fall back to the day register.
  const loadError = registerQuery.error;
  React.useEffect(() => {
    if (
      period !== undefined &&
      loadError instanceof ApiError &&
      loadError.statusCode === 403 &&
      (loadError.details as { code?: string } | undefined)?.code === 'ATTENDANCE_PERIOD_DISABLED'
    ) {
      void navigate({ search: (prev) => ({ ...prev, period: undefined }), replace: true });
    }
  }, [loadError, period, navigate]);

  function handleUndo(previous: Draft) {
    setDraft(previous);
  }

  function handleStatusChange(studentId: string, status: AttendanceStatus) {
    setDraft((current) => ({
      ...current,
      [studentId]: { status, minutes_late: current[studentId]?.minutes_late ?? null },
    }));
  }

  function handleMinutesLateChange(studentId: string, minutes: number | null) {
    setDraft((current) => ({
      ...current,
      [studentId]: { status: current[studentId]?.status ?? null, minutes_late: minutes },
    }));
  }

  function handleAllPresent() {
    // Mirrors `RosterMarker`'s own `isStatusAllowed` guard — a future date
    // under `policy.allow_future_dates` restricts every row to LEAVE, and
    // this bulk action (reachable from the toolbar button, `Shift+P`, and
    // the unmarked-students confirm dialog) must not fill them with a
    // status the policy forbids.
    if (allowedStatuses && !allowedStatuses.includes(AttendanceStatus.PRESENT)) return;
    const previous = draft;
    const unmarked = (registerQuery.data?.students ?? []).filter(
      (student) => !draft[student.student_id]?.status,
    );
    // Nothing to fill: no change, so no toast and no Undo.
    if (unmarked.length === 0) return;
    setDraft((current) => {
      const next: Draft = { ...current };
      for (const student of unmarked) {
        if (!next[student.student_id]?.status) {
          next[student.student_id] = { status: AttendanceStatus.PRESENT, minutes_late: null };
        }
      }
      return next;
    });
    // Title stays "All present" (the e2e page object closes the toast by it); the count rides below.
    toast.success(t('mark.allPresent'), {
      description: t('mark.allPresentDone', { count: unmarked.length }),
      action: { label: t('mark.undo'), onClick: () => handleUndo(previous) },
      duration: 5000,
    });
  }

  /** [76.5.03] Every unmarked row becomes ABSENT; marked rows stay. Saves through the normal Save. */
  function handleRestAbsent() {
    if (allowedStatuses && !allowedStatuses.includes(AttendanceStatus.ABSENT)) return;
    const previous = draft;
    const unmarked = (registerQuery.data?.students ?? []).filter(
      (student) => !draft[student.student_id]?.status,
    );
    // Nothing to fill: no change, so no toast and no Undo.
    if (unmarked.length === 0) return;
    setDraft((current) => {
      const next: Draft = { ...current };
      for (const student of unmarked) {
        if (!next[student.student_id]?.status) {
          next[student.student_id] = { status: AttendanceStatus.ABSENT, minutes_late: null };
        }
      }
      return next;
    });
    toast.success(t('markRestAbsentDone', { count: unmarked.length }), {
      action: { label: t('mark.undo'), onClick: () => handleUndo(previous) },
      duration: 5000,
    });
  }

  function handleReset() {
    const previous = draft;
    setDraft({});
    toast.success(t('mark.undoToast'), {
      action: { label: t('mark.undo'), onClick: () => handleUndo(previous) },
      duration: 5000,
    });
  }

  const students = registerQuery.data?.students ?? [];
  // Derived, not stored: an unsaved period register whose roster still holds a
  // day-register suggestion. Survives a re-seed from the local draft.
  const prefilledCount =
    period !== undefined && registerQuery.data && !registerQuery.data.session.id
      ? students.filter(
          // Same structural cast as `seedDraft`'s: the generated union vs the shared enum.
          (s) =>
            s.suggested_status &&
            draft[s.student_id]?.status === (s.suggested_status as AttendanceStatus),
        ).length
      : 0;
  const counts = students.reduce(
    (acc, student) => {
      const status = draft[student.student_id]?.status ?? null;
      if (status === AttendanceStatus.PRESENT) acc.present += 1;
      else if (status === AttendanceStatus.ABSENT) acc.absent += 1;
      else if (status === AttendanceStatus.LATE) acc.late += 1;
      else if (status === AttendanceStatus.LEAVE) acc.leave += 1;
      else acc.unmarked += 1;
      return acc;
    },
    { present: 0, absent: 0, late: 0, leave: 0, unmarked: 0 },
  );

  function buildInput(): PutRegisterInput {
    return {
      date,
      ...(period !== undefined ? { period_no: period } : {}),
      base_version: registerQuery.data?.session.version ?? 0,
      client_request_id: crypto.randomUUID(),
      finalize: true,
      ...(needsReason ? { reason: reason.trim() } : {}),
      entries: Object.entries(draft)
        .filter(([, entry]) => entry.status !== null)
        .map(([student_id, entry]) => ({
          student_id,
          status: entry.status as AttendanceStatus,
          ...(entry.status === AttendanceStatus.LATE && entry.minutes_late !== null
            ? { minutes_late: entry.minutes_late }
            : {}),
        })),
    };
  }

  function doSubmit() {
    submitRegister.mutate(buildInput(), {
      onSuccess: (result) => {
        if (result.queued) {
          toast.success(t('mark.queuedToast'));
        } else {
          toast.success(t('mark.savedToast'));
        }
        clearDraft(storageKey);
        // Queued = offline. The list route's chunk is not precached (only the shell
        // is), so navigating there offline fails into the error fallback and a hard
        // reload that drops the toast. Stay on the register until the sync lands.
        if (!result.queued) void navigate({ to: '/attendance' });
      },
      onError: (error) => {
        if (error instanceof ApiError && error.statusCode === 409) {
          const details = error.details as
            { current_version?: number; register?: Register } | undefined;
          setConflict({
            currentRegister: details?.register,
            currentVersion: details?.current_version,
          });
          return;
        }
        if (isReasonRequired(error)) return showReasonError(true);
        toast.error(t('mark.errorToast'));
      },
    });
  }

  function showReasonError(fromServer = false) {
    if (fromServer) setReasonForced(true);
    setReasonError(true);
    reasonRef.current?.focus();
  }

  function isReasonRequired(error: unknown) {
    return (
      error instanceof ApiError &&
      (error.details as { code?: string } | undefined)?.code === 'ATTENDANCE_REASON_REQUIRED'
    );
  }

  function handleSubmit() {
    if (needsReason && reason.trim().length < 3) {
      showReasonError();
      return;
    }
    setReasonError(false);
    if (counts.unmarked > 0) {
      setConfirmUnmarkedOpen(true);
      return;
    }
    doSubmit();
  }

  function handleKeepMine(currentVersion: number) {
    submitRegister.mutate(
      { ...buildInput(), base_version: currentVersion, client_request_id: crypto.randomUUID() },
      {
        onSuccess: (result) => {
          toast.success(result.queued ? t('mark.queuedToast') : t('mark.savedToast'));
          clearDraft(storageKey);
          setConflict(null);
          if (!result.queued) void navigate({ to: '/attendance' }); // see doSubmit
        },
        onError: (error) => {
          if (error instanceof ApiError && error.statusCode === 409) {
            const details = error.details as
              { current_version?: number; register?: Register } | undefined;
            setConflict({
              currentRegister: details?.register,
              currentVersion: details?.current_version,
            });
            return;
          }
          if (isReasonRequired(error)) {
            setConflict(null);
            return showReasonError(true);
          }
          toast.error(t('mark.errorToast'));
        },
      },
    );
  }

  function handleTakeTheirs() {
    setConflict(null);
    // Clear the persisted draft *before* refetching — the seed effect
    // above reads localStorage before the server response, so a stale
    // write still sitting there would win over the fresh register once
    // this refetch resolves and that effect re-runs.
    clearDraft(storageKey);
    void registerQuery.refetch().then((result) => {
      if (result.data) setDraft(seedDraft(result.data));
    });
  }

  if (registerQuery.isPending) {
    return (
      <PageContainer>
        <div aria-busy="true" className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-none border-b border-border-subtle" />
            ))}
          </div>
        </div>
      </PageContainer>
    );
  }
  if (registerQuery.isError) {
    return (
      <PageContainer>
        <ErrorState
          message={t('mark.loadError')}
          retryLabel={t('list.retry')}
          onRetry={() => void registerQuery.refetch()}
        />
      </PageContainer>
    );
  }

  const register = registerQuery.data;
  // [76.5.03] Whole-day register the server says this caller may not save: calm banner, no controls.
  const writeBlocked = period === undefined && register.can_write === false;
  const editable = register.editable && canMark && !writeBlocked;
  // [9.7] Whether the correction dialog (PATCH, reason-captured) is on
  // offer for this register, as distinct from `editable` (the normal
  // inline PUT flow). See `canCorrect`'s own comment above for why this
  // can only ever be true for a caller who holds ATTENDANCE_CORRECT but
  // whose `register.editable` still came back `false`.
  const canCorrectOutsideWindow = !register.editable && canCorrect;
  const futureDateLeaveOnly =
    date > tenantTodayIso(regionConfig) && register.policy.allow_future_dates;
  const allowedStatuses = futureDateLeaveOnly ? [AttendanceStatus.LEAVE] : undefined;
  const correctionStudent = students.find((s) => s.student_id === correctionStudentId) ?? null;
  const historyStudent = students.find((s) => s.student_id === historyStudentId) ?? null;

  // [9.7] Trailing per-row slot: an "Edited" badge for a corrected mark,
  // plus a Correct/History overflow menu once the register is outside
  // its editable window. Renders nothing while `register.editable` is
  // true — the normal inline marking flow already covers that case.
  function renderRowActions(student: RegisterStudent) {
    if (register.editable) return null;
    if (!student.record_id) return null; // never marked — nothing to correct or view

    return (
      <div className="flex items-center gap-1">
        {student.correction_count > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <StatusBadge tone="neutral" label={t('mark.editedBadge')} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t('mark.editedBadgeTooltip', { count: student.correction_count })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Menu>
          <MenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              iconOnly
              aria-label={t('mark.rowMenuLabel', { name: student.full_name })}
            >
              <MoreVertical aria-hidden="true" />
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            {canCorrectOutsideWindow && (
              <MenuItem onSelect={() => setCorrectionStudentId(student.student_id)}>
                {t('mark.correctAction')}
              </MenuItem>
            )}
            <MenuItem onSelect={() => setHistoryStudentId(student.student_id)}>
              {t('mark.historyAction')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    );
  }

  const stateBadge =
    register.session.state === 'FINALIZED' ? (
      <StatusBadge tone="success" label={t('mark.stateFinalized')} />
    ) : register.session.id ? (
      <StatusBadge tone="info" label={t('list.draft')} />
    ) : (
      <StatusBadge tone="warning" label={t('list.notMarked')} />
    );

  return (
    <PageContainer>
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-h1">
              {t('mark.title', {
                className: register.section.class_name,
                sectionName: register.section.section_name,
              })}
            </h1>
            {stateBadge}
          </div>
          <p className="mt-0.5 text-text-secondary">
            {t('list.studentCount', { count: students.length })}
          </p>
        </div>
        <div className="grid gap-1.5 md:w-64">
          <span className="inline-flex items-center gap-1">
            <Label htmlFor="attendance-date">{t('mark.dateLabel')}</Label>
            <HelpHint helpId="attendance.attendance.field.date" />
          </span>
          <DatePicker
            id="attendance-date"
            aria-label={t('mark.dateLabel')}
            className="w-full"
            config={regionConfig}
            value={parseDate(date)}
            onValueChange={(next) =>
              void navigate({
                search: (prev) => ({ ...prev, date: next ? toIsoDate(next) : date }),
              })
            }
          />
        </div>
      </header>

      <PeriodSwitcher
        sectionId={sectionId}
        date={date}
        period={period}
        showRoutineHint={canManageRoutines && periodsEnabled}
        onChange={(next, opts) =>
          void navigate({
            search: (prev) => ({ ...prev, period: next }),
            replace: opts?.replace ?? false,
          })
        }
      />

      {prefilledCount > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-muted p-4 text-text-secondary">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('period.prefilledNotice')}
        </p>
      )}

      {!register.editable && (
        <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-muted p-4 text-text-secondary">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {canCorrectOutsideWindow
            ? t('mark.readOnlyExplanation')
            : t('mark.readOnlyNoPermission', {
                days: register.policy.correction_window_days,
              })}
        </p>
      )}
      {/* A caller with no mark right at all (e.g. ACCOUNTANT) gets `write_reason: null` too:
          the existing read-only banner covers them, so no "right now" banner on top. */}
      {writeBlocked && (register.write_reason != null || canMark) && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-border-subtle bg-muted p-4 text-text-secondary"
        >
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t(
            `registerBanner.${KNOWN_WRITE_REASONS.has(register.write_reason ?? '') ? register.write_reason : 'UNKNOWN'}`,
          )}
        </p>
      )}
      {register.first_period_today === true && period === undefined && (
        <p className="border-success/30 bg-success/10 flex items-start gap-2 rounded-lg border p-4 text-text-primary">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('firstPeriod.hint')}
        </p>
      )}
      {futureDateLeaveOnly && (
        <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-muted p-4 text-text-secondary">
          <CalendarClock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('mark.futureDateBanner')}
        </p>
      )}

      <section
        aria-labelledby="m-roster"
        className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"
      >
        <h2 id="m-roster" className="sr-only">
          {t('mark.rosterHeading')}
        </h2>
        <div className="flex flex-col gap-3 border-b border-border-subtle p-4 md:flex-row md:items-center md:justify-between md:px-5">
          <p className="flex flex-wrap gap-2">
            <StatusBadge tone="success" label={t('mark.presentCount', { n: counts.present })} />
            <StatusBadge tone="danger" label={t('mark.absentCount', { n: counts.absent })} />
            <StatusBadge tone="warning" label={t('mark.lateCount', { n: counts.late })} />
            <StatusBadge tone="info" label={t('mark.leaveCount', { n: counts.leave })} />
            <StatusBadge tone="neutral" label={t('mark.unmarkedCount', { n: counts.unmarked })} />
          </p>
          {editable && (
            <div className="flex items-center gap-2">
              <span className="inline-flex flex-1 items-center gap-1 md:flex-none">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 md:flex-none"
                  onClick={handleAllPresent}
                  disabled={Boolean(
                    allowedStatuses && !allowedStatuses.includes(AttendanceStatus.PRESENT),
                  )}
                >
                  <CheckCheck aria-hidden="true" />
                  {t('mark.allPresent')}
                </Button>
                <HelpHint helpId="attendance.attendance.action.allPresent" />
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={handleRestAbsent}
                disabled={Boolean(
                  allowedStatuses && !allowedStatuses.includes(AttendanceStatus.ABSENT),
                )}
              >
                <UserX aria-hidden="true" />
                {t('markRestAbsent')}
              </Button>
              <Button type="button" variant="ghost" onClick={handleReset}>
                <RotateCcw aria-hidden="true" />
                {t('mark.reset')}
              </Button>
            </div>
          )}
        </div>
        {/* No ambient region provider: the badges' scan time follows the tenant's region. */}
        <RegionConfigProvider value={regionConfig}>
          <RosterMarker
            students={students}
            draft={draft}
            onStatusChange={handleStatusChange}
            onMinutesLateChange={handleMinutesLateChange}
            onAllPresent={handleAllPresent}
            onRestAbsent={handleRestAbsent}
            onSubmit={handleSubmit}
            disabled={!editable}
            allowedStatuses={allowedStatuses}
            renderRowActions={renderRowActions}
            arrivalSubscribed={arrivalSubscribed}
          />
        </RegionConfigProvider>
        {editable && (
          <p className="hidden border-t border-border-subtle px-5 py-3 text-caption text-text-secondary md:block">
            {t('mark.shortcutHint')}
          </p>
        )}
      </section>

      {editable && needsReason && (
        <div className="grid gap-1.5">
          <Label htmlFor="attendance-reason">{t('mark.correctionReasonLabel')}</Label>
          <Textarea
            id="attendance-reason"
            ref={reasonRef}
            value={reason}
            maxLength={280}
            aria-invalid={reasonError}
            aria-describedby={
              reasonError
                ? 'attendance-reason-help attendance-reason-error'
                : 'attendance-reason-help'
            }
            onChange={(e) => setReason(e.target.value)}
          />
          <p id="attendance-reason-help" className="text-caption text-text-secondary">
            {t('mark.correctionReasonHelp')}
          </p>
          {reasonError && (
            <p id="attendance-reason-error" role="alert" className="text-danger text-caption">
              {t('mark.correctionReasonTooShort')}
            </p>
          )}
        </div>
      )}

      {editable && (
        <div className="sticky bottom-16 z-20 flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3 shadow-e2 md:bottom-0 md:px-5">
          <span className="shrink-0 text-text-secondary">
            {t('mark.unmarkedRemaining', { n: counts.unmarked })}
          </span>
          <>
            <Button
              type="button"
              className="flex-1 md:ms-auto md:flex-none"
              loading={submitRegister.isPending}
              onClick={handleSubmit}
            >
              <Send aria-hidden="true" />
              {submitRegister.isPending
                ? t('mark.submitting')
                : online
                  ? t('mark.submitOnline')
                  : t('mark.submitOffline')}
            </Button>
            <HelpHint helpId="attendance.attendance.action.submit" />
          </>
        </div>
      )}

      <Dialog open={confirmUnmarkedOpen} onOpenChange={setConfirmUnmarkedOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t('mark.confirmUnmarkedTitle', { n: counts.unmarked })}</DialogTitle>
            <DialogDescription>{t('mark.confirmUnmarkedBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmUnmarkedOpen(false)}>
              {t('mark.confirmUnmarkedCancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmUnmarkedOpen(false);
                handleAllPresent();
              }}
            >
              {t('mark.confirmUnmarkedMarkRestPresent')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmUnmarkedOpen(false);
                doSubmit();
              }}
            >
              {t('mark.confirmUnmarkedSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConflictDialog
        open={conflict !== null}
        onOpenChange={(open) => !open && setConflict(null)}
        currentRegister={conflict?.currentRegister}
        currentVersion={conflict?.currentVersion}
        draft={draft}
        students={students}
        onKeepMine={handleKeepMine}
        onTakeTheirs={handleTakeTheirs}
      />

      {correctionStudent && (
        <CorrectionDialog
          open={correctionStudentId !== null}
          onOpenChange={(open) => !open && setCorrectionStudentId(null)}
          sectionId={sectionId}
          date={date}
          periodNo={period}
          student={correctionStudent}
        />
      )}

      <Dialog
        open={historyStudentId !== null}
        onOpenChange={(open) => !open && setHistoryStudentId(null)}
      >
        <DialogContent size="md" closeLabel={t('history.close')}>
          <DialogHeader>
            <DialogTitle>
              {historyStudent
                ? t('history.title', { name: historyStudent.full_name })
                : t('mark.historyAction')}
            </DialogTitle>
          </DialogHeader>
          {historyStudent && (
            <RecordHistoryPanel
              recordId={historyStudent.record_id ?? undefined}
              studentName={historyStudent.full_name}
            />
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
