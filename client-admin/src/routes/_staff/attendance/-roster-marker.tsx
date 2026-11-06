/**
 * [9.6] The roster itself — one `<li>` per student, a row button for the
 * 95% case (PRESENT ⇄ ABSENT) plus `AttendanceStatusControl` (`compact`)
 * for LATE/LEAVE and minutes-late. Owns the desktop-keyboard model the
 * plan calls out as first-class, not an afterthought:
 *
 * - Roving `tabIndex` — exactly one row is ever in the Tab order.
 *   `ArrowUp`/`ArrowDown` move focus, `Home`/`End` jump to the first/last
 *   row.
 * - `p`/`a`/`l`/`v` set the *focused* row's status outright, `Space`
 *   toggles PRESENT ⇄ ABSENT, `Shift+P` marks every row PRESENT,
 *   `Cmd`/`Ctrl+Enter` submits — all ignored when the event's target is
 *   an `<input>`/`<textarea>` (the minutes-late field must stay typeable).
 * - A single `aria-live="polite"` region announces the most recent change
 *   ("{{name}} marked absent"), read once per change.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { AttendanceMarkBadges, AttendanceStatusControl } from '@biddaloy/ui/components';
import { useArrivalSubscriptions, type RegisterStudent } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Bell } from 'lucide-react';
import * as React from 'react';

export interface DraftEntry {
  status: AttendanceStatus | null;
  minutes_late: number | null;
}

export type Draft = Record<string, DraftEntry>;

export interface RosterMarkerProps {
  students: readonly RegisterStudent[];
  draft: Draft;
  onStatusChange: (studentId: string, status: AttendanceStatus) => void;
  onMinutesLateChange: (studentId: string, minutes: number | null) => void;
  onAllPresent: () => void;
  /** [76.5.03] Shift+A: every unmarked row becomes ABSENT. */
  onRestAbsent?: (() => void) | undefined;
  onSubmit: () => void;
  disabled?: boolean;
  /** [9.7] Passed straight through to `AttendanceStatusControl` — a future
   * date under `policy.allow_future_dates` restricts every row to `LEAVE`
   * only. `undefined` keeps the pre-9.7 default (all four statuses). */
  allowedStatuses?: AttendanceStatus[] | undefined;
  /** [9.7] Optional per-row trailing slot — `$sectionId.tsx` uses it for
   * the Correct/History overflow menu plus the "Edited" badge, once the
   * register is outside its editable window. `undefined` renders nothing
   * extra, same as every pre-9.7 caller. */
  renderRowActions?: (student: RegisterStudent) => React.ReactNode;
  /** [84.3.3] Students whose guardian waits for the arrival notice. Absent → no bell. */
  arrivalSubscribed?: ReadonlySet<string> | undefined;
}

/** The section's students with an ACTIVE arrival subscription, for `arrivalSubscribed`.
 * `enabled` only for a caller holding `ATTENDANCE_ARRIVAL_NOTICE_MANAGE` (the list route needs
 * it); otherwise no request and `undefined` (no bells). */
export function useArrivalBells(
  sectionId: string,
  enabled: boolean,
): ReadonlySet<string> | undefined {
  const query = useArrivalSubscriptions({ sectionId, status: 'ACTIVE' }, { enabled });
  return React.useMemo(
    () => (enabled && query.data ? new Set(query.data.map((s) => s.student_id)) : undefined),
    [enabled, query.data],
  );
}

const STATUS_SHORTCUT: Record<string, AttendanceStatus> = {
  p: AttendanceStatus.PRESENT,
  a: AttendanceStatus.ABSENT,
  l: AttendanceStatus.LATE,
  v: AttendanceStatus.LEAVE,
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

export function RosterMarker({
  students,
  draft,
  onStatusChange,
  onMinutesLateChange,
  onAllPresent,
  onRestAbsent,
  onSubmit,
  disabled = false,
  allowedStatuses,
  renderRowActions,
  arrivalSubscribed,
}: RosterMarkerProps) {
  const { t } = useTranslation('attendance');
  const [focusedIndex, setFocusedIndex] = React.useState(0);
  const [announcement, setAnnouncement] = React.useState('');
  const rowRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  function announce(studentId: string, status: AttendanceStatus) {
    const student = students.find((s) => s.student_id === studentId);
    if (!student) return;
    setAnnouncement(
      t('mark.announceStatusChanged', {
        name: student.full_name,
        status: t(`statusControl.status.${status}`),
      }),
    );
  }

  // A future date under `policy.allow_future_dates` restricts every row to
  // LEAVE via `allowedStatuses` — but that prop only limits the *options*
  // `AttendanceStatusControl` itself renders. Every other way to set a
  // status (this row button's PRESENT/ABSENT toggle, `Space`, and the
  // `p`/`a`/`l`/`v` shortcuts) funnels through `setStatus`, so the guard
  // belongs here once rather than at each call site.
  function isStatusAllowed(status: AttendanceStatus): boolean {
    return !allowedStatuses || allowedStatuses.includes(status);
  }

  function setStatus(studentId: string, status: AttendanceStatus) {
    if (!isStatusAllowed(status)) return;
    onStatusChange(studentId, status);
    announce(studentId, status);
  }

  function moveFocus(nextIndex: number) {
    const clamped = Math.max(0, Math.min(students.length - 1, nextIndex));
    setFocusedIndex(clamped);
    rowRefs.current[clamped]?.focus();
  }

  function handleListKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    if (isTypingTarget(event.target)) return;

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === 'a' && onRestAbsent) {
      event.preventDefault();
      if (isStatusAllowed(AttendanceStatus.ABSENT)) onRestAbsent();
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      if (isStatusAllowed(AttendanceStatus.PRESENT)) onAllPresent();
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(focusedIndex + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(focusedIndex - 1);
        return;
      case 'Home':
        event.preventDefault();
        moveFocus(0);
        return;
      case 'End':
        event.preventDefault();
        moveFocus(students.length - 1);
        return;
      case ' ': {
        event.preventDefault();
        const student = students[focusedIndex];
        if (!student) return;
        const current = draft[student.student_id]?.status ?? null;
        setStatus(
          student.student_id,
          current === AttendanceStatus.PRESENT ? AttendanceStatus.ABSENT : AttendanceStatus.PRESENT,
        );
        return;
      }
      default: {
        const shortcutStatus = STATUS_SHORTCUT[event.key.toLowerCase()];
        if (!shortcutStatus) return;
        const student = students[focusedIndex];
        if (!student) return;
        event.preventDefault();
        setStatus(student.student_id, shortcutStatus);
      }
    }
  }

  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions --
          Standard WAI-ARIA "composite widget" keydown delegation: the
          roving-tabIndex row buttons below are the interactive elements
          (and each is independently operable with a real button role);
          this container-level handler only routes arrow/shortcut keys to
          whichever row button currently holds focus, the same pattern
          `data-table.tsx`'s own roving-tabIndex header row uses. */}
      <ul className="divide-y divide-border-subtle" onKeyDown={handleListKeyDown}>
        {students.map((student, index) => {
          const entry = draft[student.student_id];
          const status = entry?.status ?? null;
          return (
            <li
              key={student.student_id}
              className="flex min-h-14 items-center gap-3 px-4 py-1.5 md:px-5"
            >
              <button
                ref={(node) => {
                  rowRefs.current[index] = node;
                }}
                type="button"
                disabled={disabled}
                tabIndex={index === focusedIndex ? 0 : -1}
                onFocus={() => setFocusedIndex(index)}
                onClick={() =>
                  setStatus(
                    student.student_id,
                    status === AttendanceStatus.PRESENT
                      ? AttendanceStatus.ABSENT
                      : AttendanceStatus.PRESENT,
                  )
                }
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="w-14 shrink-0 text-text-secondary">
                  {t('mark.rollNumber', { roll: student.roll_number })}
                </span>
                <span className="truncate font-medium">{student.full_name}</span>
                {arrivalSubscribed?.has(student.student_id) && (
                  <Bell
                    className="size-4 shrink-0 text-text-secondary"
                    role="img"
                    aria-label={t('mark.arrivalSubscribed')}
                  >
                    <title>{t('mark.arrivalSubscribed')}</title>
                  </Bell>
                )}
              </button>
              <AttendanceMarkBadges
                scanned_at={student.scanned_at}
                source={student.source}
                scannedLabel={(time) => t('scannedBadge', { time })}
                scannedHint={t('scannedHint')}
                fromSheetLabel={t('fromSheetBadge')}
                fromSheetHint={t('fromSheetHint')}
              />
              <AttendanceStatusControl
                value={status}
                onChange={(next) => setStatus(student.student_id, next)}
                disabled={disabled}
                minutesLate={entry?.minutes_late ?? null}
                onMinutesLateChange={(minutes) => onMinutesLateChange(student.student_id, minutes)}
                studentName={student.full_name}
                allowedStatuses={allowedStatuses}
              />
              {renderRowActions?.(student)}
            </li>
          );
        })}
      </ul>
    </>
  );
}
