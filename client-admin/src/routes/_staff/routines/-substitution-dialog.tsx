/**
 * [21.9.1] D12: records a cover or a cancellation for one slot on one
 * date, without touching `routine_slots`. [31.4] The picker is date ->
 * class and section -> a period that happens on that date's weekday, built
 * from the current year's routine (there is no "all slots" endpoint to
 * search across instead).
 *
 * `SubstitutionsService.assertSlotOccursOn` (server) stays the only
 * authority on whether a date is a real occurrence of the slot (a period
 * can run every other week or once a month) — this dialog only narrows the
 * list by weekday and by the slot's valid_from..valid_to range, and never
 * re-derives the recurrence rule. The server's 422 for that check carries
 * `details.code: 'SLOT_NOT_ON_DATE'`; it is translated here
 * (`notOnDateError`), never shown verbatim. Saving over a record dated before
 * the school's today answers 409 `SUBSTITUTION_IN_PAST` (#3022) -> `pastError`.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelpHint,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  usePeriodSlotLookup,
  useRecordSubstitution,
  useRoutines,
  useRoutineSlots,
  useSectionLookup,
  useSubjects,
  useTeachers,
  type RoutineSlotWithWarnings,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatTime, formatWeekday, toIsoDate } from '@biddaloy/ui/utils';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { subjectName } from './-subject-name';

export interface SubstitutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/** The current academic year's routine slots, by id. Shared by the dialog
 * and the log page, which joins each record to its period through it.
 * ponytail: current-year routine only; older records show "—" — include
 * `routine_slot` in `SubstitutionsService.list` if that matters. */
export function useCurrentRoutineSlots() {
  const academicYearsQuery = useAcademicYears({});
  const currentYearId = academicYearsQuery.data?.data.find((year) => year.is_current)?.id;
  const routinesQuery = useRoutines();
  const forYear = (routinesQuery.data ?? []).filter(
    (candidate) => candidate.academic_year_id === currentYearId,
  );
  // Same pick as `$sectionId.tsx`: the published routine, else the newest.
  const routine =
    forYear.find((candidate) => candidate.state === 'PUBLISHED') ??
    [...forYear].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  const slotsQuery = useRoutineSlots(routine?.id);
  const slots = slotsQuery.data;
  const slotsById = React.useMemo(
    () =>
      new Map<string, RoutineSlotWithWarnings>(
        (slots ?? []).map((entry) => [entry.slot.id, entry]),
      ),
    [slots],
  );
  return {
    routine,
    slots: slots ?? [],
    slotsById,
    isPending: academicYearsQuery.isPending || routinesQuery.isPending || slotsQuery.isPending,
  };
}

export function SubstitutionDialog({ open, onOpenChange, onDone }: SubstitutionDialogProps) {
  const { t, i18n } = useTranslation('routines');
  const config = useRegionConfig();
  const recordSubstitution = useRecordSubstitution();

  const [date, setDate] = React.useState<Date | undefined>(() => new Date());
  const [sectionId, setSectionId] = React.useState('');
  const [slotId, setSlotId] = React.useState('');
  const [isCancelled, setIsCancelled] = React.useState(false);
  const [substituteTeacherId, setSubstituteTeacherId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<{
    key:
      | 'notOnDateError'
      | 'slotTeacherError'
      | 'teacherBusyError'
      | 'teacherBusyNoTimeError'
      | 'pastError'
      | 'errorToast';
    values?: Record<string, string>;
  } | null>(null);

  const { routine, slots, slotsById } = useCurrentRoutineSlots();
  const sectionLookup = useSectionLookup();
  const periodLookup = usePeriodSlotLookup();
  const subjectsQuery = useSubjects({});
  const teachersQuery = useTeachers({});

  const sectionLabel = (id: string) => {
    const entry = sectionLookup.data?.[id];
    return entry
      ? t('substitutionsPage.sectionName', {
          className: entry.className,
          sectionName: entry.sectionName,
        })
      : '—';
  };
  const teacherName = (id: string) =>
    teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name ?? '—';

  // Same bounds as the server's check: valid_to inclusive, null means still in force.
  const isoDate = date ? toIsoDate(date) : undefined;
  const slotsOnDate = isoDate
    ? slots.filter(
        ({ slot }) =>
          slot.valid_from <= isoDate && (slot.valid_to === null || isoDate <= slot.valid_to),
      )
    : slots;

  const sectionOptions = [...new Set(slotsOnDate.map((entry) => entry.slot.section_id))]
    .map((id) => [id, sectionLabel(id)] as const)
    .sort((a, b) => a[1].localeCompare(b[1]));

  const sequenceOf = (entry: RoutineSlotWithWarnings) =>
    periodLookup.data?.[entry.slot.period_slot_id]?.sequence ?? 0;
  const slotOptions = date
    ? slotsOnDate
        .filter(
          (entry) => entry.slot.section_id === sectionId && entry.slot.weekday === date.getDay(),
        )
        .sort((a, b) => sequenceOf(a) - sequenceOf(b))
    : [];
  const chosenSlot = slotsById.get(slotId);
  const substituteOptions = (teachersQuery.data?.data ?? []).filter(
    (teacher) => !chosenSlot?.teacher_ids.includes(teacher.id),
  );

  React.useEffect(() => {
    if (!open) {
      setDate(new Date());
      setSectionId('');
      setSlotId('');
      setIsCancelled(false);
      setSubstituteTeacherId('');
      setReason('');
      setError(null);
    }
  }, [open]);

  const canSave = Boolean(slotId && date && (isCancelled || substituteTeacherId));

  function handleSubmit() {
    if (!canSave || !date) return;
    setError(null);
    recordSubstitution.mutate(
      {
        routine_slot_id: slotId,
        date: toIsoDate(date),
        is_cancelled: isCancelled,
        substitute_teacher_id: isCancelled ? null : substituteTeacherId || null,
        reason: reason.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(t('substitutionDialog.savedToast'));
          onDone();
          onOpenChange(false);
        },
        onError: (err) => {
          // Our own sentence per code; the server's message is never shown.
          const details = err instanceof ApiError ? err.details : undefined;
          const code = details?.['code'];
          const from = details?.['from'];
          const to = details?.['to'];
          if (code === 'SLOT_NOT_ON_DATE') setError({ key: 'notOnDateError' });
          else if (code === 'SUBSTITUTE_IS_SLOT_TEACHER') setError({ key: 'slotTeacherError' });
          else if (code === 'TEACHER_BUSY' && typeof from === 'string' && typeof to === 'string') {
            setError({
              key: 'teacherBusyError',
              values: { from: formatTime(from, config), to: formatTime(to, config) },
            });
          } else if (code === 'TEACHER_BUSY') setError({ key: 'teacherBusyNoTimeError' });
          else if (code === 'SUBSTITUTION_IN_PAST') setError({ key: 'pastError' });
          else setError({ key: 'errorToast' });
        },
      },
    );
  }

  const slotHelp = !date
    ? t('substitutionDialog.pickDateFirst')
    : !routine
      ? t('substitutionDialog.noRoutine')
      : sectionId && slotOptions.length === 0
        ? t('substitutionDialog.noSlotsOnDay', { weekday: formatWeekday(date, config) })
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('substitutionDialog.title')}</DialogTitle>
          <DialogDescription>{t('substitutionDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="substitution-date">{t('substitutionDialog.dateLabel')}</Label>
            <DatePicker
              id="substitution-date"
              aria-label={t('substitutionDialog.dateLabel')}
              config={config}
              value={date}
              onValueChange={(next) => {
                setDate(next);
                setSlotId('');
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="substitution-section">{t('substitutionDialog.sectionLabel')}</Label>
            <Select
              value={sectionId}
              onValueChange={(value) => {
                setSectionId(value);
                setSlotId('');
              }}
            >
              <SelectTrigger id="substitution-section" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sectionOptions.map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="substitution-slot">{t('substitutionDialog.slotLabel')}</Label>
            <Select value={slotId} onValueChange={setSlotId}>
              <SelectTrigger id="substitution-slot" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {slotOptions.map((entry) => {
                  const period = periodLookup.data?.[entry.slot.period_slot_id];
                  return (
                    <SelectItem key={entry.slot.id} value={entry.slot.id}>
                      {t('substitutionDialog.slotOption', {
                        period: period
                          ? t('agenda.periodLabel', {
                              sequence: formatNumber(period.sequence, config),
                            })
                          : '—',
                        time: period ? formatTime(period.starts_at, config) : '—',
                        subject: subjectName(
                          subjectsQuery.data?.data.find(
                            (subject) => subject.id === entry.slot.subject_id,
                          ),
                          i18n.language,
                        ),
                        teachers: entry.teacher_ids.map(teacherName).join(', ') || '—',
                      })}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {slotHelp && <p className="text-caption text-text-secondary">{slotHelp}</p>}
          </div>

          <div className="flex min-h-11 items-center gap-3 md:min-h-8">
            <Checkbox
              id="substitution-cancelled"
              checked={isCancelled}
              onCheckedChange={(checked) => setIsCancelled(checked === true)}
            />
            <Label
              htmlFor="substitution-cancelled"
              className="min-h-11 flex-1 items-center md:min-h-8"
            >
              {t('substitutionDialog.cancelledLabel')}
            </Label>
            <HelpHint helpId="academics.routineSubstitutions.field.cancelled" />
          </div>

          {!isCancelled && (
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1">
                <Label htmlFor="substitution-teacher">
                  {t('substitutionDialog.substituteTeacherLabel')}
                </Label>
                <HelpHint helpId="academics.routineSubstitutions.field.substituteTeacher" />
              </span>
              <Select value={substituteTeacherId} onValueChange={setSubstituteTeacherId}>
                <SelectTrigger id="substitution-teacher" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {substituteOptions.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.user.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="substitution-reason">{t('substitutionDialog.reasonLabel')}</Label>
            <Textarea
              id="substitution-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={280}
            />
          </div>

          {error && (
            <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
              <CircleAlertIcon className="size-4" aria-hidden="true" />
              {t(`substitutionDialog.${error.key}`, error.values ?? {})}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('substitutionDialog.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            loading={recordSubstitution.isPending}
            onClick={handleSubmit}
          >
            {t('substitutionDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
