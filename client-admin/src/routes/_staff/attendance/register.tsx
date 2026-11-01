/**
 * [9.10] `/attendance/register` — a printable, paper-register replacement
 * for one section's whole month, over `GET /attendance/sections/
 * :sectionId/register-matrix` ([9.4]'s `useRegisterMatrix`, already used
 * by `reports.tsx`'s summary view). Client-only: no new backend surface.
 *
 * Deliberately a hand-written `<table>`, not `DataTable` — a
 * date-by-student matrix (one column per calendar day, up to 31 of them)
 * is not a list-of-rows-with-a-fixed-column-set the way every other
 * `DataTable` caller's data is, and `DataTable`'s column-visibility/
 * card-mode/sort machinery has nothing useful to offer a grid shaped like
 * this. It does still borrow `DataTable`'s design tokens (`text-sm`,
 * `border-border-subtle`, `tabular-nums`) so it reads as the same
 * product, not a one-off.
 */
import { AttendanceStatus, Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  HelpHint,
  Label,
  MonthPicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TableCount,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import {
  useActiveTenant,
  useClasses,
  useClassSections,
  useHasPermission,
  useRegisterMatrix,
  useSaveRegisterMatrix,
  useSchoolSettings,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatMonth,
  formatNumber,
  parseDate,
  parseServerDate,
  tenantTodayIso,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { createFileRoute, Link, useBlocker } from '@tanstack/react-router';
import { FileSpreadsheet, PencilIcon, PrinterIcon, SaveIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import {
  abbrev,
  RegisterEditGrid,
  statusLabel,
  toneClass,
  type Draft,
} from './-register-edit-grid';

import './-register-print.css';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const searchSchema = z.object({
  class_id: z.string().uuid().optional().catch(undefined),
  section_id: z.string().uuid().optional().catch(undefined),
  month: z
    .string()
    .regex(MONTH_PATTERN)
    .optional()
    .catch(() => undefined),
  edit: z.coerce.boolean().optional().catch(undefined),
});

/** Default correction window (days) from `11-attendance.md`, used when the
 * tenant's own window is unreadable (the settings read needs SETTINGS_MANAGE).
 * It only decides whether the reason is marked required up front; the server
 * enforces the real rule, and its 422 shows under the field. */
const DEFAULT_WINDOW_DAYS = 2;

/** Same length rule as the server's `MIN_REASON_LENGTH`. */
const MIN_REASON_LENGTH = 3;

/** `md` and up (768px) — edit mode is desktop-only (D14). */
function useIsMd(): boolean {
  const query = '(min-width: 768px)';
  const [matches, setMatches] = React.useState(
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
  );
  React.useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return matches;
}

export const Route = createFileRoute('/_staff/attendance/register')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('attendance', 'common'),
  component: RegisterPage,
});

function RegisterPage() {
  // `useRegionConfig()` has no ambient provider above the route tree —
  // same wrap `academic-years/index.tsx` documents for itself.
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <RegisterPageContent />
    </RegionConfigProvider>
  );
}

function RegisterPageContent() {
  const { t } = useTranslation('attendance');
  const regionConfig = useRegionConfig();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  // The school's date, not the browser's: the server decides future and
  // closed days on the tenant clock.
  const today = tenantTodayIso(regionConfig);
  const month = search.month ?? today.slice(0, 7);

  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(search.class_id);
  const matrixQuery = useRegisterMatrix(search.section_id, month);

  const className = classesQuery.data?.data.find((klass) => klass.id === search.class_id)?.name;
  const sectionName = sectionsQuery.data?.find(
    (section) => section.id === search.section_id,
  )?.section_name;

  function patchSearch(
    patch: Partial<Record<'class_id' | 'section_id' | 'month', string | undefined>>,
  ) {
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
    });
  }

  const rows = matrixQuery.data?.rows ?? [];
  const matrix = matrixQuery.data;
  const canMark = useHasPermission(Permission.ATTENDANCE_MARK);
  // The tenant's correction window. Only SETTINGS_MANAGE can read settings;
  // `''` keeps the query off for everyone else (they get the default).
  const canReadSettings = useHasPermission(Permission.SETTINGS_MANAGE);
  const tenantId = useActiveTenant();
  const settingsQuery = useSchoolSettings(canReadSettings ? (tenantId ?? '') : '');
  const windowDays = settingsQuery.data?.attendance?.correctionWindowDays ?? DEFAULT_WINDOW_DAYS;
  const isMd = useIsMd();
  // `keepPreviousData`: while a new month or section loads, `rows` is still the
  // OLD one. In edit mode that would let a cell edit land on a date (or a
  // student) that is no longer on screen, so edit mode waits for real data.
  const loading = matrixQuery.isPending || (search.edit === true && matrixQuery.isPlaceholderData);
  const editing = search.edit === true && isMd && canMark && rows.length > 0 && !loading;
  const saveMatrix = useSaveRegisterMatrix(search.section_id ?? '');

  // Changed cells only. A ref mirrors it so the route blocker (and a save
  // that clears the draft right before navigating) read the live value.
  const [draft, setDraftState] = React.useState<Draft>(new Map());
  const draftRef = React.useRef<Draft>(draft);
  const setDraft = (next: Draft) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [reason, setReason] = React.useState('');
  const [reasonError, setReasonError] = React.useState(false);
  // The server asked for a reason (a FINALIZED day inside the window, which the
  // matrix cannot show up front).
  const [reasonAsked, setReasonAsked] = React.useState(false);
  // A save the server refused as a whole: which kind, and for which dates.
  // `conflict` = someone else changed a day (409), `locked` = a future or closed
  // day (422), `closed` = only ATTENDANCE_CORRECT may change it (403).
  const [problem, setProblem] = React.useState<{
    kind: 'conflict' | 'locked' | 'closed';
    dates: string[];
  } | null>(null);

  // A new section, month or `?edit` starts a clean draft (the blocker below has
  // already asked before any of those navigations when the draft was not empty).
  // Keyed on `search.edit`, not `editing`: a viewport shrinking below `md` (or a
  // lost ATTENDANCE_MARK) only hides the grid — the draft stays, and the blocker
  // still asks before it is thrown away.
  React.useEffect(() => {
    setDraft(new Map());
    setReason('');
    setReasonError(false);
    setReasonAsked(false);
  }, [search.section_id, month, search.edit]);

  useWarnUnsavedChanges(draft.size > 0);
  const blocker = useBlocker({
    shouldBlockFn: () => draftRef.current.size > 0,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const changedDates = [...new Set([...draft.keys()].map((key) => key.split('|')[1] ?? ''))].sort();
  // Server rule (`attendance.service.ts`, "closed days"): a day that already
  // has a register and is older than the window needs a reason. A day with no
  // register never does. A FINALIZED day inside the window also does, but the
  // matrix does not carry the state, so that case is left to the server's 422.
  const oldest = parseDate(today);
  oldest.setDate(oldest.getDate() - windowDays);
  const oldestAllowed = toIsoDate(oldest);
  const outsideDates = matrix
    ? changedDates.filter((date) => date < oldestAllowed && matrix.versions[date] !== undefined)
    : [];
  const reasonNeeded = outsideDates.length > 0 || reasonAsked;
  const newDates = matrix
    ? changedDates.filter((date) =>
        matrix.rows.every((row) => !(row.marks as Record<string, unknown>)[date]),
      )
    : [];
  const fmtDates = (dates: readonly string[]) =>
    dates.map((date) => formatDate(date, regionConfig)).join(', ');

  function reloadMonth() {
    setDraft(new Map());
    setProblem(null);
    void matrixQuery.refetch();
  }

  function leaveEdit() {
    void navigate({ search: (prev) => ({ ...prev, edit: undefined }) });
  }

  function onSave() {
    if (matrix === undefined || draft.size === 0 || saveMatrix.isPending) return;
    // A dialog is up (a refused save, or "discard changes?" holding a
    // navigation): Ctrl+S must not save underneath it.
    if (problem !== null || blocker.status === 'blocked') return;
    const trimmed = reason.trim();
    // A too-short reason is an error even when none is required: it would
    // otherwise be dropped from the save without a word.
    if ((reasonNeeded || trimmed.length > 0) && trimmed.length < MIN_REASON_LENGTH) {
      setReasonError(true);
      return;
    }
    setReasonError(false);
    // Guard: only dates of the loaded month (a draft never outlives its month).
    const days = changedDates
      .filter((date) => matrix.dates.some((d) => d.date === date))
      .map((date) => ({
        date,
        base_version: matrix.versions[date] ?? null,
        entries: matrix.rows.flatMap((row) => {
          const status =
            draft.get(`${row.student_id}|${date}`) ??
            (row.marks as Record<string, AttendanceStatus | null | undefined>)[date];
          return status ? [{ student_id: row.student_id, status }] : [];
        }),
      }));
    saveMatrix.mutate(
      {
        client_request_id: crypto.randomUUID(),
        days,
        // Whatever the user typed is sent: only the server knows every day that
        // needs one (a FINALIZED day inside the window), and dropping a typed
        // reason would turn a working save into a 422.
        ...(trimmed.length >= MIN_REASON_LENGTH ? { reason: trimmed } : {}),
      },
      {
        onSuccess: (result) => {
          toast.success(t('register.saved', { count: result.saved_dates.length }));
          setDraft(new Map());
          leaveEdit();
        },
        onError: (error) => {
          const details = error instanceof ApiError ? error.details : undefined;
          const code = details?.code;
          const dates = Array.isArray(details?.dates) ? (details.dates as string[]) : [];
          // Nothing was saved in any of these (the save is all-or-nothing).
          if (error instanceof ApiError && error.statusCode === 409) {
            // Stale day, reused request id, or a register created meanwhile.
            setProblem({ kind: 'conflict', dates });
          } else if (code === 'ATTENDANCE_MATRIX_LOCKED_DATE') {
            setProblem({ kind: 'locked', dates });
          } else if (code === 'ATTENDANCE_WINDOW_CLOSED') {
            // 403: the caller lacks ATTENDANCE_CORRECT — no reason can fix this.
            setProblem({ kind: 'closed', dates });
          } else if (code === 'ATTENDANCE_REASON_REQUIRED') {
            setReasonAsked(true);
            setReasonError(true);
          } else {
            toast.error(t('mark.errorToast'));
          }
        },
      },
    );
  }
  // Ctrl/Cmd+S saves from anywhere on the page while editing, the reason field
  // included (a cell-only handler let the browser's "Save page" open there).
  const onSaveRef = React.useRef(onSave);
  onSaveRef.current = onSave;
  React.useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // `code` too: with a Bangla layout (Bijoy) `key` is not 's'.
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.code === 'KeyS' || event.key.toLowerCase() === 's')
      ) {
        event.preventDefault();
        onSaveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing]);

  const monthLabel = formatMonth(month, regionConfig);
  const names = { className: className ?? '', sectionName: sectionName ?? '' };
  const caption = t('register.caption', { ...names, month: monthLabel });
  const cardTitle = t('register.cardTitle', { ...names, month: monthLabel });
  const problemDates = problem?.dates.length ? fmtDates(problem.dates) : monthLabel;

  return (
    <PageContainer>
      <PageHeader
        title={t('register.title')}
        subtitle={
          editing
            ? `${t('register.editingSubtitle')} · ${className ?? ''} – ${sectionName ?? ''} · ${monthLabel}`
            : t('register.subtitle')
        }
        actions={[
          {
            id: 'print',
            helpId: 'attendance.attendanceRegister.action.print',
            label: t('register.print'),
            icon: <PrinterIcon aria-hidden="true" />,
            priority: 'primary',
            allowed: !editing,
            disabled: rows.length === 0,
            onClick: () => window.print(),
          },
          {
            id: 'edit',
            helpId: 'attendance.attendanceRegister.action.edit',
            label: t('register.edit'),
            icon: <PencilIcon aria-hidden="true" />,
            allowed: !editing && !loading && isMd && canMark && rows.length > 0,
            onClick: () => void navigate({ search: (prev) => ({ ...prev, edit: true }) }),
          },
          {
            id: 'cancel',
            label: t('register.cancel'),
            icon: <XIcon aria-hidden="true" />,
            allowed: editing,
            onClick: leaveEdit,
          },
          {
            id: 'save',
            helpId: 'attendance.attendanceRegister.action.save',
            label: t('register.save', { count: draft.size }),
            icon: <SaveIcon aria-hidden="true" />,
            priority: 'primary',
            allowed: editing,
            disabled: draft.size === 0,
            busy: saveMatrix.isPending,
            onClick: onSave,
          },
        ]}
      />

      <section aria-label={t('register.pickersLabel')} className="grid gap-4 md:grid-cols-12">
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="register-class">{t('register.classLabel')}</Label>
          <Select
            value={search.class_id ?? ''}
            onValueChange={(value) => patchSearch({ class_id: value, section_id: undefined })}
          >
            <SelectTrigger id="register-class">
              <SelectValue placeholder={t('register.pickPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(classesQuery.data?.data ?? []).map((klass) => (
                <SelectItem key={klass.id} value={klass.id}>
                  {klass.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="register-section">{t('register.sectionLabel')}</Label>
          <Select
            value={search.section_id ?? ''}
            onValueChange={(value) => patchSearch({ section_id: value })}
            disabled={search.class_id === undefined}
          >
            <SelectTrigger id="register-section" disabled={search.class_id === undefined}>
              <SelectValue placeholder={t('register.pickPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(sectionsQuery.data ?? []).map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.section_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="register-month">{t('register.monthLabel')}</Label>
          <MonthPicker
            id="register-month"
            aria-label={t('register.monthLabel')}
            value={month}
            onValueChange={(value) => patchSearch({ month: value })}
          />
        </div>
      </section>

      {search.section_id === undefined ? (
        <EmptyState
          icon={<FileSpreadsheet />}
          title={t('register.pickTitle')}
          explanation={t('register.selectPrompt')}
        />
      ) : loading ? (
        <div aria-busy="true" aria-live="polite">
          <span className="sr-only">{t('register.loading')}</span>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : matrixQuery.isError ? (
        <ErrorState
          message={t('register.errorMessage')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={() => void matrixQuery.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('register.emptyMessage')}
          explanation={t('register.emptyExplanation')}
        />
      ) : (
        <>
          {editing && matrix ? (
            <section
              aria-label={t('register.editingSubtitle')}
              className="grid gap-4 rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:grid-cols-2 md:p-5"
            >
              <div className="grid content-start gap-2">
                <h2 className="text-h3" aria-live="polite">
                  {t('register.changedCount', { count: draft.size })}
                </h2>
                {newDates.length > 0 && (
                  <p className="text-caption text-text-secondary">
                    {t('register.newDayNotice', { dates: fmtDates(newDates) })}
                  </p>
                )}
                {outsideDates.length > 0 && (
                  <p className="text-caption text-text-secondary">
                    {t('register.outsideWindowNotice', {
                      count: outsideDates.length,
                      dates: fmtDates(outsideDates),
                    })}
                  </p>
                )}
                <p className="text-caption text-text-secondary">{t('register.keysHint')}</p>
              </div>
              <div className="grid content-start gap-1.5">
                <span className="inline-flex items-center gap-1">
                  <Label htmlFor="register-reason">
                    {t('register.reasonLabel')}
                    {reasonNeeded && <span aria-hidden="true"> *</span>}
                  </Label>
                  <HelpHint helpId="attendance.attendanceRegister.field.reason" />
                </span>
                <Textarea
                  id="register-reason"
                  rows={2}
                  value={reason}
                  required={reasonNeeded}
                  aria-invalid={reasonError}
                  aria-describedby="register-reason-help"
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReasonError(false);
                  }}
                />
                <p
                  id="register-reason-help"
                  role={reasonError ? 'alert' : undefined}
                  className={
                    reasonError
                      ? 'text-caption text-destructive'
                      : 'text-caption text-text-secondary'
                  }
                >
                  {reasonError ? t('register.reasonRequired') : t('register.reasonHelp')}
                </p>
              </div>
            </section>
          ) : null}
          <section
            id="attendance-register-print-area"
            aria-labelledby="r-title"
            className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"
          >
            <div className="flex flex-col gap-2 border-b border-border-subtle p-4 md:flex-row md:items-center md:justify-between md:px-5">
              <h2 id="r-title" className="text-h3">
                {cardTitle}
              </h2>
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-text-secondary">
                {[
                  AttendanceStatus.PRESENT,
                  AttendanceStatus.ABSENT,
                  AttendanceStatus.LATE,
                  AttendanceStatus.LEAVE,
                ].map((status) => (
                  <span key={status}>
                    {abbrev(t, status)} = {statusLabel(t, status)}
                  </span>
                ))}
                <span>{t('register.legendClosed')}</span>
                <span>{t('register.legendUnmarked')}</span>
              </p>
            </div>
            {editing && matrix ? (
              <RegisterEditGrid
                // A new section or month is a new grid: the focused cell resets too.
                key={`${search.section_id}|${month}`}
                matrix={matrix}
                draft={draft}
                onDraftChange={setDraft}
                today={today}
                caption={caption}
                onCancel={leaveEdit}
              />
            ) : (
              <>
                {!isMd && canMark && (
                  <p className="mx-4 mt-3 rounded-md bg-muted px-3 py-2 text-caption text-text-secondary print:hidden">
                    {t('register.phoneNotice')}
                  </p>
                )}
                <p className="px-4 py-3 text-caption text-text-secondary md:hidden print:hidden">
                  {t('register.scrollHint')}
                </p>
                <div
                  role="region"
                  aria-label={caption}
                  // WCAG SCR29: a scrollable `role="region"` needs a tab stop so a
                  // keyboard user can scroll it — same exemption `data-table.tsx`'s
                  // own table-mode wrapper carries, for the identical reason.
                  // `relative`: the `sr-only` header spans are `position: absolute`
                  // and would otherwise escape the `overflow-x-auto` and widen the page.
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                  tabIndex={0}
                  className="relative w-full overflow-x-auto"
                >
                  <table className="w-full border-collapse text-caption tabular-nums">
                    <caption className="sr-only">{caption}</caption>
                    <thead className="border-b border-border-subtle bg-muted text-text-secondary">
                      <tr>
                        <th scope="col" className="h-9 px-2 text-start font-medium">
                          {t('register.columnRoll')}
                        </th>
                        <th scope="col" className="h-9 px-2 text-start font-medium">
                          {t('register.columnStudent')}
                        </th>
                        {matrixQuery.data?.dates.map((date) => (
                          <th
                            key={date.date}
                            scope="col"
                            className="h-9 min-w-6 text-center font-medium"
                          >
                            {!isMd && date.is_working_day && date.date <= today ? (
                              <Link
                                to="/attendance/$sectionId"
                                params={{ sectionId: search.section_id ?? '' }}
                                search={{ date: date.date }}
                                aria-label={t('register.openDay', {
                                  date: formatDate(date.date, regionConfig),
                                })}
                                className="inline-flex min-h-11 min-w-11 items-center justify-center text-primary underline"
                              >
                                {formatNumber(
                                  parseServerDate(date.date).getUTCDate(),
                                  regionConfig,
                                )}
                              </Link>
                            ) : (
                              <>
                                <span aria-hidden="true">
                                  {formatNumber(
                                    parseServerDate(date.date).getUTCDate(),
                                    regionConfig,
                                  )}
                                </span>
                                <span className="sr-only">
                                  {formatDate(date.date, regionConfig)}
                                </span>
                              </>
                            )}
                          </th>
                        ))}
                        <th
                          scope="col"
                          className="h-9 border-s border-border-subtle px-2 text-end font-medium"
                        >
                          {t('register.totalPresent')}
                        </th>
                        <th scope="col" className="h-9 px-2 text-end font-medium">
                          {t('register.totalAbsent')}
                        </th>
                        <th scope="col" className="h-9 px-2 text-end font-medium">
                          {t('register.totalLate')}
                        </th>
                        <th scope="col" className="h-9 px-2 text-end font-medium">
                          {t('register.totalLeave')}
                        </th>
                        <th scope="col" className="h-9 px-2 text-end font-medium">
                          {t('register.totalPercentage')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {rows.map((row) => (
                        <tr key={row.student_id}>
                          <td className="h-9 px-2">
                            {formatNumber(row.roll_number, regionConfig)}
                          </td>
                          <td className="h-9 px-2 font-medium whitespace-nowrap">
                            {row.full_name}
                          </td>
                          {matrixQuery.data?.dates.map((date) => {
                            const status = (row.marks as Record<string, AttendanceStatus | null>)[
                              date.date
                            ];
                            if (!date.is_working_day) {
                              return (
                                <td
                                  key={date.date}
                                  className="h-9 bg-muted text-center text-text-secondary"
                                >
                                  <span aria-hidden="true">—</span>
                                  <span className="sr-only">{t('register.notWorkingDay')}</span>
                                </td>
                              );
                            }
                            return (
                              <td
                                key={date.date}
                                className={`h-9 text-center ${toneClass(status)}`}
                              >
                                <span aria-hidden="true">{status ? abbrev(t, status) : '·'}</span>
                                <span className="sr-only">
                                  {status ? statusLabel(t, status) : t('register.notMarked')}
                                </span>
                              </td>
                            );
                          })}
                          <td className="h-9 border-s border-border-subtle px-2 text-end">
                            {formatNumber(row.summary.present_days, regionConfig)}
                          </td>
                          <td className="h-9 px-2 text-end">
                            {formatNumber(row.summary.absent_days, regionConfig)}
                          </td>
                          <td className="h-9 px-2 text-end">
                            {formatNumber(row.summary.late_days, regionConfig)}
                          </td>
                          <td className="h-9 px-2 text-end">
                            {formatNumber(row.summary.leave_days, regionConfig)}
                          </td>
                          <td className="h-9 px-2 text-end">
                            {row.summary.attendance_percentage === null
                              ? '—'
                              : `${formatNumber(row.summary.attendance_percentage, regionConfig)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="border-t border-border-subtle px-4 py-3">
              <TableCount total={rows.length} />
            </div>
          </section>
        </>
      )}

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title={t('register.discardTitle')}
        description={t('register.discardBody', { count: draft.size })}
        confirmLabel={t('register.discardConfirm')}
        onConfirm={() => blocker.proceed?.()}
      />
      <Dialog
        open={problem !== null}
        // Closing a conflict any way (Esc, outside click, X) reloads: keeping the
        // stale grid would only fail the next Save the same way. A `locked` or
        // `closed` problem just closes; the draft is the user's to keep or trim.
        onOpenChange={(open) => {
          if (open) return;
          if (problem?.kind === 'conflict') reloadMonth();
          else setProblem(null);
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t('register.conflictTitle')}</DialogTitle>
            <DialogDescription>
              {problem?.kind === 'locked'
                ? t('register.lockedBody', { dates: problemDates })
                : problem?.kind === 'closed'
                  ? t('register.closedBody', { dates: problemDates })
                  : t('register.conflictBody', { dates: problemDates })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {problem && problem.kind !== 'conflict' && problem.dates.length > 0 ? (
              <Button
                type="button"
                onClick={() => {
                  const drop = new Set(problem.dates);
                  setDraft(
                    new Map([...draft].filter(([key]) => !drop.has(key.split('|')[1] ?? ''))),
                  );
                  setProblem(null);
                }}
              >
                {t('register.removeDays')}
              </Button>
            ) : (
              <Button type="button" onClick={reloadMonth}>
                {t('register.reload')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
