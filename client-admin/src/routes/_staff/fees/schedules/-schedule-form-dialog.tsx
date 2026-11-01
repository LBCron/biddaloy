/**
 * [16.7.5] Create/Edit recurring-schedule form — a full-page modal (`FullPageShell`, D21/D23: 12
 * fields) opened through the URL (`?new=1` / `?edit=<id>`, D22). Mounted only while `open`, so it
 * never fires its programs request for a user who is not looking at it (B10), and starts from a
 * fresh state every time. Tier B form (plain `useState`, no `FormShell`/react-hook-form).
 *
 * Audience/rule follow issue #679's Step 2: monthly day-of-month (1-28 or
 * "Last"), weekly weekday chips (ISO numbers, 1 = Monday .. 7 = Sunday),
 * ends-on capped to the selected academic year's end date.
 *
 * Two of #679's Step 2 controls are gone because the shipped server
 * contract (#675) does not back them:
 *
 * - The "active students only" checkbox. `RecurringScheduleAudienceDto`
 *   has a required `enrollment_status` whose only accepted value is
 *   `'ACTIVE'`, so every schedule is active-students-only and the toggle
 *   offered a choice that did not exist. The form now always sends
 *   `enrollment_status: 'ACTIVE'` and states the rule in a notice.
 * - The live "preview matching students" button in create mode. The only
 *   preview endpoint is `GET /fees/schedules/:id/preview`, which needs a
 *   saved schedule, so preview is edit-mode only.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DatePicker,
  HelpHint,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  programsQueryOptions,
  useAcademicYears,
  useClasses,
  useClassSections,
  useCreateRecurringSchedule,
  useFeeStructures,
  useHasPermission,
  useSchedulePreview,
  useUpdateRecurringSchedule,
  ISO_WEEKDAYS,
  type CreateRecurringScheduleInput,
  type MonthlyRuleDay,
  type RecurringSchedule,
  type Weekday,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatNumber,
  formatServerAmount,
  parseServerDate,
  toLatinDigits,
} from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';

const NO_CLASS = '__none__';
const NO_SECTION = '__none__';
const NO_PROGRAM = '__none__';
const WEEKDAYS: Weekday[] = ISO_WEEKDAYS;
const DAY_OF_MONTH_OPTIONS: MonthlyRuleDay[] = [
  ...Array.from({ length: 28 }, (_, i) => i + 1),
  'LAST',
];

export interface ScheduleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  schedule?: RecurringSchedule;
  onSaved: () => void;
}

interface FormErrors {
  name?: string;
  academicYear?: string;
  fees?: string;
  weekdays?: string;
  dueDays?: string;
}

function toDateInput(date: Date): string {
  // `DatePicker` builds this `Date` from local calendar fields (year/month/
  // day the user actually picked). `toISOString()` converts through UTC
  // first — in Asia/Dhaka (UTC+6), local midnight is 18:00 UTC the
  // *previous* day, so slicing its ISO string silently submits a date one
  // day earlier than what's shown in the picker. Read the local fields
  // back out directly instead, same as `reports/collections.tsx`'s
  // `dhakaNow`/`startOfUtcDay` convention for never letting a date-only
  // value round-trip through a timezone conversion.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `aria-invalid` + `aria-describedby` for a control whose error sits under it. */
function invalidProps(id: string, error: string | undefined) {
  return error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {};
}

/** Visible label tied to its control, optional required mark, optional help, and the field's own
 * error. */
function Field({
  id,
  label,
  required,
  requiredLabel,
  help,
  error,
  className,
  helpId,
  children,
}: {
  helpId?: string;
  id: string;
  label: string;
  required?: boolean;
  requiredLabel?: string;
  help?: string;
  error?: string | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={id} helpId={helpId} helpLabel={label}>
        {label}
        {required && (
          <>
            <span className="text-destructive" aria-hidden="true">
              {' '}
              *
            </span>
            <span className="sr-only"> {requiredLabel}</span>
          </>
        )}
      </Label>
      {children}
      {help && <p className="text-caption text-text-secondary">{help}</p>}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlertIcon className="size-3.5" aria-hidden="true" />
      {children}
    </p>
  );
}

export function ScheduleFormDialog({
  open,
  onOpenChange,
  mode,
  schedule,
  onSaved,
}: ScheduleFormDialogProps) {
  if (!open) return null;
  return (
    <ScheduleFormPage
      mode={mode}
      schedule={schedule}
      onClose={() => onOpenChange(false)}
      onSaved={onSaved}
    />
  );
}

function ScheduleFormPage({
  mode,
  schedule,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  schedule: RecurringSchedule | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const requiredLabel = t('form.required', { ns: 'common' });

  const createSchedule = useCreateRecurringSchedule();
  const updateSchedule = useUpdateRecurringSchedule(schedule?.id ?? '');
  const mutation = mode === 'create' ? createSchedule : updateSchedule;
  // Preview needs a saved schedule (`GET /fees/schedules/:id/preview`), so
  // it is edit-mode only and shows the audience as it is currently *saved*,
  // not as it is being edited. Fetched lazily, on the button press.
  const [previewRequested, setPreviewRequested] = React.useState(false);
  const previewQuery = useSchedulePreview(schedule?.id, {
    enabled: mode === 'edit' && previewRequested,
  });

  const yearsQuery = useAcademicYears();

  const [name, setName] = React.useState(schedule?.name ?? '');
  const [academicYearId, setAcademicYearId] = React.useState(schedule?.academic_year_id ?? '');
  const [feeIds, setFeeIds] = React.useState<string[]>(schedule?.fee_structure_ids ?? []);
  const [classId, setClassId] = React.useState(schedule?.audience.class_id ?? '');
  const [sectionId, setSectionId] = React.useState(schedule?.audience.section_id ?? '');
  const [programId, setProgramId] = React.useState(schedule?.audience.program_id ?? '');
  const [ruleKind, setRuleKind] = React.useState<'MONTHLY' | 'WEEKLY'>(
    schedule?.rule.kind ?? 'MONTHLY',
  );
  const [dayOfMonth, setDayOfMonth] = React.useState<MonthlyRuleDay>(
    schedule?.rule.day_of_month ?? 1,
  );
  const [weekdays, setWeekdays] = React.useState<Weekday[]>(schedule?.rule.weekdays ?? []);
  // Kept as text so a blank box stays blank (not 0) until the user is told it is required.
  const [dueDays, setDueDays] = React.useState(String(schedule?.due_days_after_period_start ?? 7));
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);
  const [startsOn, setStartsOn] = React.useState<Date | undefined>(
    schedule ? parseServerDate(schedule.starts_on) : new Date(),
  );
  const [endsOn, setEndsOn] = React.useState<Date | undefined>(
    schedule?.ends_on ? parseServerDate(schedule.ends_on) : undefined,
  );
  const [notifyFamilies, setNotifyFamilies] = React.useState(schedule?.notify_families ?? false);
  const [errors, setErrors] = React.useState<FormErrors>({});

  // Dirty = any field differs from where it started; Close / Esc then ask before discarding.
  const snapshot = () =>
    JSON.stringify([
      name,
      academicYearId,
      feeIds,
      classId,
      sectionId,
      programId,
      ruleKind,
      dayOfMonth,
      weekdays,
      dueDays,
      startsOn?.getTime(),
      endsOn?.getTime(),
      notifyFamilies,
    ]);
  const initialSnapshot = React.useRef<string | null>(null);
  initialSnapshot.current ??= snapshot();
  const dirty = snapshot() !== initialSnapshot.current;

  const feesQuery = useFeeStructures(
    academicYearId !== '' ? { academic_year_id: academicYearId, limit: 100 } : {},
  );
  const classesQuery = useClasses(
    academicYearId !== '' ? { academic_year_id: academicYearId } : {},
  );
  const sectionsQuery = useClassSections(classId !== '' ? classId : undefined);
  // A role without `PROGRAM_READ` cannot call `GET /programs` — no request, no program field (B10).
  // Only include archived programs when editing a schedule that already
  // references one — its saved `program_id` must stay visible/selectable
  // in the audience picker. New schedules only ever offer active programs.
  const canReadPrograms = useHasPermission(Permission.PROGRAM_READ);
  const programsQuery = useQuery({
    ...programsQueryOptions({
      includeArchived: mode === 'edit' && (schedule?.audience.program_id ?? '') !== '',
    }),
    enabled: canReadPrograms,
  });

  const selectedYear = yearsQuery.data?.data.find((year) => year.id === academicYearId);
  const yearEndDate = selectedYear ? parseServerDate(selectedYear.end_date) : undefined;

  // Ends-on capped to the selected academic year's end date — issue
  // #679's own acceptance criterion. Clamping here (rather than just
  // disabling later dates in the picker) keeps a year-switch from
  // silently leaving a now-invalid `endsOn` behind.
  React.useEffect(() => {
    if (!yearEndDate || !endsOn) return;
    if (endsOn > yearEndDate) setEndsOn(yearEndDate);
  }, [yearEndDate, endsOn]);

  function toggleWeekday(day: Weekday) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function buildInput(): CreateRecurringScheduleInput | null {
    // Every unmet requirement is reported at once, each under its own field.
    const next: FormErrors = {};
    if (name.trim() === '') next.name = t('schedules.form.nameRequired');
    if (academicYearId === '') next.academicYear = t('schedules.form.academicYearRequired');
    if (feeIds.length === 0) next.fees = t('schedules.form.feesRequired');
    if (ruleKind === 'WEEKLY' && weekdays.length === 0)
      next.weekdays = t('schedules.form.weekdaysRequired');
    // Server: `@Max(60)` on due_days_after_period_start.
    const dueDaysNumber = Number(dueDays);
    if (dueDays.trim() === '') next.dueDays = t('schedules.form.dueDaysRequired');
    else if (dueDaysNumber < 0 || dueDaysNumber > 60) {
      next.dueDays = t('schedules.form.dueDaysRange');
    }
    setErrors(next);
    if (next.dueDays && !next.name && !next.academicYear && !next.fees && !next.weekdays) {
      document.getElementById('schedule-form-due-days')?.focus();
      return null;
    }
    if (next.name || next.academicYear || next.fees || next.weekdays) {
      const firstInvalid = next.name
        ? 'schedule-form-name'
        : next.academicYear
          ? 'schedule-form-year'
          : next.fees
            ? 'schedule-form-fees'
            : 'schedule-form-weekdays';
      document.getElementById(firstInvalid)?.focus();
      return null;
    }
    return {
      name: name.trim(),
      academic_year_id: academicYearId,
      fee_structure_ids: feeIds,
      // `class_id`/`section_id` are `@IsOptional() @IsUUID()` — an explicit
      // `null` fails UUID validation, so "all classes" omits the key
      // entirely rather than sending null. `enrollment_status` is required
      // and `'ACTIVE'` is its only accepted value today.
      audience: {
        ...(classId !== '' ? { class_id: classId } : {}),
        ...(sectionId !== '' ? { section_id: sectionId } : {}),
        ...(programId !== '' ? { program_id: programId } : {}),
        enrollment_status: 'ACTIVE' as const,
      },
      rule:
        ruleKind === 'MONTHLY'
          ? { kind: 'MONTHLY' as const, day_of_month: dayOfMonth }
          : { kind: 'WEEKLY' as const, weekdays },
      due_days_after_period_start: dueDaysNumber,
      starts_on: toDateInput(startsOn ?? new Date()),
      ...(endsOn ? { ends_on: toDateInput(endsOn) } : {}),
      notify_families: notifyFamilies,
      // No control for this in the form — activate/deactivate is a row
      // action on the list. Preserve it on edit, default on to create.
      is_active: schedule?.is_active ?? true,
    };
  }

  function handleSubmit(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const input = buildInput();
    if (!input) return;
    if (mode === 'create') {
      createSchedule.mutate(input, { onSuccess: onSaved });
      return;
    }
    updateSchedule.mutate(input, { onSuccess: onSaved });
  }

  const isEdit = mode === 'edit';
  const title = isEdit ? t('schedules.form.editTitle') : t('schedules.form.createTitle');

  return (
    <FullPageShell
      title={title}
      onClose={onClose}
      dirty={dirty}
      size="form"
      primary={{
        label: t('schedules.form.save'),
        onClick: () => handleSubmit(),
        busy: mutation.isPending,
      }}
      // Cancel asks first when something changed, same as Close / Esc.
      secondary={{
        label: t('schedules.form.cancel'),
        onClick: () => (dirty ? setConfirmingCancel(true) : onClose()),
      }}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card padded>
          <h2 className="text-h2">{t('schedules.form.sectionName')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field
              id="schedule-form-name"
              label={t('schedules.form.nameLabel')}
              required
              requiredLabel={requiredLabel}
              error={errors.name}
              className="md:col-span-2"
            >
              <Input
                id="schedule-form-name"
                value={name}
                placeholder={t('schedules.form.namePlaceholder')}
                onChange={(event) => setName(event.target.value)}
                {...invalidProps('schedule-form-name', errors.name)}
              />
            </Field>

            <Field
              id="schedule-form-year"
              label={t('schedules.form.academicYearLabel')}
              required
              requiredLabel={requiredLabel}
              error={errors.academicYear}
              {...(isEdit ? { help: t('schedules.form.academicYearLocked') } : {})}
              className="md:col-span-2"
            >
              <Select value={academicYearId} onValueChange={setAcademicYearId} disabled={isEdit}>
                <SelectTrigger
                  id="schedule-form-year"
                  disabled={isEdit}
                  {...invalidProps('schedule-form-year', errors.academicYear)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearsQuery.data?.data.map((year) => (
                    <SelectItem key={year.id} value={year.id}>
                      {year.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Card>

        <Card padded>
          <h2 className="text-h2" id="schedule-form-fees-title">
            {t('schedules.form.feesLabel')}
            <span className="text-destructive" aria-hidden="true">
              {' '}
              *
            </span>
            <span className="sr-only"> {requiredLabel}</span>
          </h2>
          <ul
            id="schedule-form-fees"
            tabIndex={-1}
            aria-labelledby="schedule-form-fees-title"
            className="mt-4 divide-y divide-border-subtle rounded-md border border-border-subtle"
            aria-describedby={errors.fees ? 'schedule-form-fees-error' : undefined}
          >
            {(feesQuery.data?.data ?? []).map((fee) => (
              <li key={fee.id} className="px-3">
                <label className="flex min-h-11 items-center gap-3 md:min-h-9">
                  <Checkbox
                    checked={feeIds.includes(fee.id)}
                    onCheckedChange={(checked) =>
                      setFeeIds((prev) =>
                        checked === true ? [...prev, fee.id] : prev.filter((id) => id !== fee.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">{fee.name}</span>
                  <span className="ms-auto shrink-0 text-text-secondary tabular-nums">
                    {formatServerAmount(fee.amount, regionConfig)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {errors.fees && (
            <div className="mt-2">
              <FieldError id="schedule-form-fees-error">{errors.fees}</FieldError>
            </div>
          )}
        </Card>

        <Card padded>
          <div className="flex items-center gap-1">
            <h2 className="text-h2">{t('schedules.form.audienceLegend')}</h2>
            <HelpHint
              helpId="finance.recurringSchedules.field.audience"
              label={t('schedules.form.audienceLegend')}
            />
          </div>
          {/* Not a control: `enrollment_status` accepts only `'ACTIVE'`, so this states the fixed
              rule instead of offering a choice the server would reject. */}
          <p className="mt-0.5 text-text-secondary">{t('schedules.form.activeOnlyNotice')}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field id="schedule-form-class" label={t('schedules.form.classLabel')}>
              <Select
                value={classId === '' ? NO_CLASS : classId}
                onValueChange={(value) => {
                  setClassId(value === NO_CLASS ? '' : value);
                  setSectionId('');
                }}
              >
                <SelectTrigger id="schedule-form-class">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLASS}>{t('schedules.form.allClasses')}</SelectItem>
                  {classesQuery.data?.data.map((klass) => (
                    <SelectItem key={klass.id} value={klass.id}>
                      {klass.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field id="schedule-form-section" label={t('schedules.form.sectionLabel')}>
              <Select
                value={sectionId === '' ? NO_SECTION : sectionId}
                onValueChange={(value) => setSectionId(value === NO_SECTION ? '' : value)}
                disabled={classId === ''}
              >
                <SelectTrigger id="schedule-form-section" disabled={classId === ''}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SECTION}>{t('schedules.form.allSections')}</SelectItem>
                  {sectionsQuery.data?.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.section_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {canReadPrograms && (
              <Field id="schedule-form-program" label={t('schedules.form.programLabel')}>
                <Select
                  value={programId === '' ? NO_PROGRAM : programId}
                  onValueChange={(value) => setProgramId(value === NO_PROGRAM ? '' : value)}
                >
                  <SelectTrigger id="schedule-form-program">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROGRAM}>{t('schedules.form.allPrograms')}</SelectItem>
                    {programsQuery.data?.map((program) => (
                      <SelectItem key={program.id} value={program.id}>
                        {program.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
        </Card>

        <Card padded>
          <h2 className="text-h2">{t('schedules.form.ruleLegend')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field
              id="schedule-form-kind"
              label={t('schedules.form.ruleKindLabel')}
              helpId="finance.recurringSchedules.field.rule"
            >
              <Select
                value={ruleKind}
                onValueChange={(value) => setRuleKind(value as 'MONTHLY' | 'WEEKLY')}
              >
                <SelectTrigger id="schedule-form-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">{t('schedules.form.ruleModeMonthly')}</SelectItem>
                  <SelectItem value="WEEKLY">{t('schedules.form.ruleModeWeekly')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {ruleKind === 'MONTHLY' ? (
              <Field id="schedule-form-day" label={t('schedules.form.dayOfMonthLabel')}>
                <Select
                  value={String(dayOfMonth)}
                  onValueChange={(value) =>
                    setDayOfMonth(value === 'LAST' ? 'LAST' : Number(value))
                  }
                >
                  <SelectTrigger id="schedule-form-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_OF_MONTH_OPTIONS.map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {day === 'LAST'
                          ? t('schedules.form.dayOfMonthLast')
                          : t('schedules.form.dayOfMonthOption', {
                              day: formatNumber(day, regionConfig),
                            })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span id="schedule-form-weekdays-label" className="text-label text-text-primary">
                  {t('schedules.form.weekdaysLabel')}
                  <span className="text-destructive" aria-hidden="true">
                    {' '}
                    *
                  </span>
                  <span className="sr-only"> {requiredLabel}</span>
                </span>
                <div
                  id="schedule-form-weekdays"
                  tabIndex={-1}
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-labelledby="schedule-form-weekdays-label"
                  aria-describedby={errors.weekdays ? 'schedule-form-weekdays-error' : undefined}
                >
                  {WEEKDAYS.map((day) => {
                    const selected = weekdays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleWeekday(day)}
                        className={`inline-flex h-11 items-center rounded-full border px-4 md:h-8 md:px-3 ${
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border-functional bg-surface text-text-primary hover:bg-muted'
                        }`}
                      >
                        {t(`weekdays.${day}`, { ns: 'common', defaultValue: String(day) })}
                      </button>
                    );
                  })}
                </div>
                {errors.weekdays && (
                  <FieldError id="schedule-form-weekdays-error">{errors.weekdays}</FieldError>
                )}
              </div>
            )}

            <Field
              id="schedule-form-due-days"
              helpId="finance.recurringSchedules.field.dueDays"
              label={t('schedules.form.dueDaysLabel')}
              help={t('schedules.form.dueDaysHelp')}
              error={errors.dueDays}
            >
              <Input
                id="schedule-form-due-days"
                inputMode="numeric"
                value={dueDays}
                // Bangla digits are converted, not stripped.
                onChange={(event) =>
                  setDueDays(toLatinDigits(event.target.value).replace(/\D/g, ''))
                }
                {...invalidProps('schedule-form-due-days', errors.dueDays)}
              />
            </Field>
            <div className="hidden md:block" />

            <Field
              id="schedule-form-starts-on"
              label={t('schedules.form.startsOnLabel')}
              required
              requiredLabel={requiredLabel}
            >
              <DatePicker
                id="schedule-form-starts-on"
                value={startsOn}
                onValueChange={setStartsOn}
                config={regionConfig}
                aria-label={t('schedules.form.startsOnLabel')}
              />
            </Field>
            <Field
              id="schedule-form-ends-on"
              label={t('schedules.form.endsOnLabel')}
              {...(yearEndDate
                ? {
                    help: t('schedules.form.endsOnHelp', {
                      date: formatDate(yearEndDate, regionConfig),
                    }),
                  }
                : {})}
            >
              <DatePicker
                id="schedule-form-ends-on"
                value={endsOn}
                onValueChange={(date) =>
                  setEndsOn(date && yearEndDate && date > yearEndDate ? yearEndDate : date)
                }
                max={yearEndDate}
                config={regionConfig}
                aria-label={t('schedules.form.endsOnLabel')}
              />
            </Field>
          </div>

          <div className="mt-4 border-t border-border-subtle pt-3">
            <label className="flex min-h-11 items-center gap-3 md:min-h-8">
              <Checkbox
                checked={notifyFamilies}
                onCheckedChange={(checked) => setNotifyFamilies(checked === true)}
              />
              {t('schedules.form.notifyFamiliesLabel')}
            </label>
          </div>
        </Card>

        {isEdit && (
          <Card padded>
            <h2 className="text-h2">{t('schedules.form.previewTitle')}</h2>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-text-secondary">
                {previewQuery.isFetching
                  ? t('schedules.form.previewLoading')
                  : previewQuery.data
                    ? t('schedules.form.previewLabel', {
                        count: previewQuery.data.total_count,
                        n: formatNumber(previewQuery.data.total_count, regionConfig),
                      })
                    : previewQuery.isError
                      ? t('schedules.form.previewError')
                      : t('schedules.form.previewSavedOnlyNotice')}
              </p>
              <Button type="button" variant="outline" onClick={() => setPreviewRequested(true)}>
                {t('schedules.form.previewButton')}
              </Button>
            </div>
          </Card>
        )}

        {mutation.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon className="size-3.5" aria-hidden="true" />
            {t('schedules.form.errorMessage')}
          </p>
        )}
      </form>
      <ConfirmDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        tone="danger"
        title={t('fullPage.discardTitle', { ns: 'common' })}
        description={t('fullPage.discardDescription', { ns: 'common' })}
        confirmLabel={t('fullPage.discardConfirm', { ns: 'common' })}
        cancelLabel={t('fullPage.keepEditing', { ns: 'common' })}
        onConfirm={() => {
          setConfirmingCancel(false);
          onClose();
        }}
      />
    </FullPageShell>
  );
}
