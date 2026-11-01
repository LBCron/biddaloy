/**
 * [21.8.1] Opened on `Enter`/type-ahead over a grid cell. Subject is a
 * single choice, teachers a multi-choice (D10 — a second teacher is one
 * more checkbox, not a different flow), and recurrence is weekly by
 * default with biweekly/monthly behind one control so the common case
 * (`Enter` → pick subject → pick teacher → save) stays a few keystrokes.
 * A plain filterable checkbox list rather than a new multi-select
 * component — `Combobox` in this package is single-value only, and this
 * school's teacher list is small enough that a scrollable list is the
 * lazy and correct fit (same reasoning `shifts-panel.tsx` gives for its
 * own plain-table-over-DataTable choice).
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  HelpHint,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useRooms,
  useSubjects,
  useTeachers,
  type ConstraintViolation,
  type SlotRecurrenceValue,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CheckIcon } from 'lucide-react';
import * as React from 'react';

import { ConflictList } from './-conflict-list';
import { subjectName } from './-subject-name';

export interface CellPickerValue {
  subjectId: string;
  teacherIds: string[];
  recurrence: SlotRecurrenceValue;
  recurrenceOffset: number;
  /** Optional room; `null` means none. */
  roomId: string | null;
}

export interface CellPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing cell's values when editing, otherwise `undefined` for a
   * fresh empty cell. */
  initialValue?: CellPickerValue | undefined;
  /** [D1 companion] The type-ahead character that opened this picker, if
   * any — pre-filters the subject list to names starting with it. */
  initialFilter?: string | undefined;
  onSave: (value: CellPickerValue) => void;
  saving?: boolean;
  /** [1047] The save's 409 conflict violations, if any. Rendered inside
   * this dialog rather than on the page behind it — a `role="alert"`
   * behind an open Radix dialog is `aria-hidden` along with the rest of
   * the page, unreachable to the test and to a screen reader alike. Also
   * keeps the user's in-progress subject/teacher picks intact so they can
   * fix and retry without reopening the picker. */
  violations?: ConstraintViolation[];
  /** Name the cell in the description ("Mon · Period 3 · 9:20 AM"); all
   * three or the generic description is used. */
  dayLabel?: string | undefined;
  periodLabel?: string | undefined;
  timeLabel?: string | undefined;
}

/** Exactly what the server accepts (`routine-slots.dto.ts`): BIWEEKLY 0|1,
 * MONTHLY the 1st-5th occurrence or -1 for the last. */
const BIWEEKLY_OFFSETS = [0, 1];
const MONTHLY_OFFSETS = [1, 2, 3, 4, 5, -1];

const RECURRENCE_LABEL = {
  WEEKLY: 'cellPicker.recurrenceWeekly',
  BIWEEKLY: 'cellPicker.recurrenceBiweekly',
  MONTHLY: 'cellPicker.recurrenceMonthly',
} as const;

export function CellPicker({
  open,
  onOpenChange,
  initialValue,
  initialFilter,
  onSave,
  saving = false,
  violations = [],
  dayLabel,
  periodLabel,
  timeLabel,
}: CellPickerProps) {
  const { t, i18n } = useTranslation('routines');
  const config = useRegionConfig();
  const subjectsQuery = useSubjects({});
  const teachersQuery = useTeachers({});
  const roomsQuery = useRooms();

  const [subjectFilter, setSubjectFilter] = React.useState(initialFilter ?? '');
  const [subjectId, setSubjectId] = React.useState(initialValue?.subjectId ?? '');
  const [teacherFilter, setTeacherFilter] = React.useState('');
  const [teacherIds, setTeacherIds] = React.useState<string[]>(initialValue?.teacherIds ?? []);
  const [recurrence, setRecurrence] = React.useState<SlotRecurrenceValue>(
    initialValue?.recurrence ?? 'WEEKLY',
  );
  const [recurrenceOffset, setRecurrenceOffset] = React.useState(
    initialValue?.recurrenceOffset ?? 0,
  );
  const [roomId, setRoomId] = React.useState<string | null>(initialValue?.roomId ?? null);

  React.useEffect(() => {
    if (!open) return;
    setSubjectFilter(initialFilter ?? '');
    setSubjectId(initialValue?.subjectId ?? '');
    setTeacherFilter('');
    setTeacherIds(initialValue?.teacherIds ?? []);
    setRecurrence(initialValue?.recurrence ?? 'WEEKLY');
    setRecurrenceOffset(initialValue?.recurrenceOffset ?? 0);
    setRoomId(initialValue?.roomId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only on open, not every keystroke
  }, [open]);

  const subjectQuery = subjectFilter.trim().toLowerCase();
  const subjects = (subjectsQuery.data?.data ?? []).filter(
    (subject) =>
      subject.name_en.toLowerCase().startsWith(subjectQuery) ||
      (subject.name_bn ?? '').toLowerCase().startsWith(subjectQuery),
  );
  const teachers = (teachersQuery.data?.data ?? []).filter((teacher) =>
    teacher.user.full_name.toLowerCase().includes(teacherFilter.trim().toLowerCase()),
  );

  function toggleTeacher(teacherId: string) {
    setTeacherIds((current) =>
      current.includes(teacherId)
        ? current.filter((id) => id !== teacherId)
        : [...current, teacherId],
    );
  }

  function handleSave() {
    if (!subjectId || teacherIds.length === 0) return;
    onSave({ subjectId, teacherIds, recurrence, recurrenceOffset, roomId });
  }

  const canSave = subjectId !== '' && teacherIds.length > 0;
  const subjectFilterRef = React.useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          subjectFilterRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('cellPicker.title')}</DialogTitle>
          <DialogDescription>
            {dayLabel && periodLabel && timeLabel
              ? t('cellPicker.cellLabel', { day: dayLabel, period: periodLabel, time: timeLabel })
              : t('cellPicker.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cell-picker-subject-filter">{t('cellPicker.subjectLabel')}</Label>
            <Input
              id="cell-picker-subject-filter"
              ref={subjectFilterRef}
              value={subjectFilter}
              onChange={(event) => setSubjectFilter(event.target.value)}
              placeholder={t('cellPicker.subjectFilterPlaceholder')}
            />
            <ul className="max-h-48 overflow-y-auto rounded-md border border-border-functional p-1">
              {subjects.map((subject) => (
                <li key={subject.id}>
                  <button
                    type="button"
                    onClick={() => setSubjectId(subject.id)}
                    aria-pressed={subjectId === subject.id}
                    className={`flex h-11 w-full items-center justify-between rounded-md px-3 text-start md:h-8 ${
                      subjectId === subject.id
                        ? 'bg-secondary font-semibold text-secondary-foreground'
                        : ''
                    }`}
                  >
                    {subjectName(subject, i18n.language)}
                    {subjectId === subject.id && (
                      <CheckIcon className="size-4" aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
              {subjects.length === 0 && (
                <li className="px-3 py-2 text-text-secondary">{t('cellPicker.noResults')}</li>
              )}
            </ul>
          </div>

          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1">
              <Label htmlFor="cell-picker-teacher-filter">{t('cellPicker.teacherLabel')}</Label>
              <HelpHint helpId="academics.routineBuilder.field.teachers" />
            </span>
            <Input
              id="cell-picker-teacher-filter"
              value={teacherFilter}
              onChange={(event) => setTeacherFilter(event.target.value)}
              placeholder={t('cellPicker.teacherFilterPlaceholder')}
            />
            <ul className="max-h-48 overflow-y-auto rounded-md border border-border-functional p-1">
              {teachers.map((teacher) => (
                <li key={teacher.id} className="flex min-h-11 items-center gap-3 px-3 md:min-h-8">
                  <Checkbox
                    id={`cell-picker-teacher-${teacher.id}`}
                    checked={teacherIds.includes(teacher.id)}
                    onCheckedChange={() => toggleTeacher(teacher.id)}
                  />
                  <Label
                    htmlFor={`cell-picker-teacher-${teacher.id}`}
                    className="min-h-11 flex-1 items-center md:min-h-8"
                  >
                    {teacher.user.full_name}
                  </Label>
                </li>
              ))}
              {teachers.length === 0 && (
                <li className="px-3 py-2 text-text-secondary">{t('cellPicker.noResults')}</li>
              )}
            </ul>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="cell-picker-room">{t('cellPicker.roomLabel')}</Label>
            {/* Radix forbids an empty item value, so 'none' stands for no room. */}
            <Select
              value={roomId ?? 'none'}
              onValueChange={(value) => setRoomId(value === 'none' ? null : value)}
            >
              <SelectTrigger id="cell-picker-room" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('cellPicker.noRoom')}</SelectItem>
                {(roomsQuery.data?.data ?? []).map((room) => (
                  <SelectItem key={room.id} value={room.id}>
                    {t('roomsPanel.roomName', { roomNo: room.room_no })}
                    {room.building ? ` · ${room.building}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1">
              <Label id="cell-picker-recurrence-label">{t('cellPicker.recurrenceLabel')}</Label>
              <HelpHint helpId="academics.routineBuilder.field.recurrence" />
            </span>
            <RadioGroup
              aria-labelledby="cell-picker-recurrence-label"
              value={recurrence}
              onValueChange={(value) => {
                setRecurrence(value as SlotRecurrenceValue);
                setRecurrenceOffset(value === 'MONTHLY' ? 1 : 0);
              }}
            >
              {(['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const).map((value) => (
                <div key={value} className="flex min-h-11 items-center gap-3 md:min-h-8">
                  <RadioGroupItem id={`cell-picker-recurrence-${value}`} value={value} />
                  <Label
                    htmlFor={`cell-picker-recurrence-${value}`}
                    className="min-h-11 flex-1 items-center md:min-h-8"
                  >
                    {t(RECURRENCE_LABEL[value])}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {recurrence !== 'WEEKLY' && (
              <div className="mt-2 flex flex-col gap-1">
                <Label htmlFor="cell-picker-offset">{t('cellPicker.recurrenceOffsetLabel')}</Label>
                <Select
                  value={String(recurrenceOffset)}
                  onValueChange={(value) => setRecurrenceOffset(Number(value))}
                >
                  <SelectTrigger id="cell-picker-offset" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(recurrence === 'BIWEEKLY' ? BIWEEKLY_OFFSETS : MONTHLY_OFFSETS).map(
                      (offset) => (
                        <SelectItem key={offset} value={String(offset)}>
                          {recurrence === 'BIWEEKLY'
                            ? t(
                                offset === 0
                                  ? 'cellPicker.recurrenceWeekA'
                                  : 'cellPicker.recurrenceWeekB',
                              )
                            : offset === -1
                              ? t('cellPicker.recurrenceLast')
                              : t('cellPicker.recurrenceOccurrence', {
                                  n: formatNumber(offset, config),
                                })}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <ConflictList violations={violations} />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cellPicker.cancel')}
          </Button>
          <Button type="button" disabled={!canSave} loading={saving} onClick={handleSave}>
            {t('cellPicker.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
