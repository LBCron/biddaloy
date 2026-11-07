/**
 * [9.10] The "Attendance" settings section — a UI over [9.2]'s already-
 * shipped `AttendancePolicyDto` (no schema change here, plan's own
 * scoping note). Same partial-save shape as every other section on this
 * page (`RegionalSection.tsx`, `SmsSection.tsx`, ...): its own
 * `SettingsSection` card that PATCHes `{ version: 1, attendance: {...} }` only, never the whole
 * `TenantSettingsInput` — a save here can't clobber `communications`/
 * `region`, which is what "changed fields only" means at this page's
 * granularity (per-section, not per-field within a section — matching
 * every existing section here, which all resubmit their whole own slice).
 *
 * `autoAbsentNotification.enabled` gets an explicit confirm step before it
 * can be checked ([9.10]'s own acceptance criterion): a `ConfirmDialog`
 * (D29). Unchecking has no such side effect and stays a direct toggle.
 */
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  HelpHint,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TimeInput,
} from '@biddaloy/ui/components';
import {
  useShifts,
  useUpdateSchoolSettings,
  type AttendancePolicySettings,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatDateRange, formatTime } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { latinBounded } from './latin-digits';
import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';
import { SpecialTimingDialog, type SpecialTiming } from './SpecialTimingDialog';

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Literal per-day keys, not `t(\`attendance.weekday.${day}\`)` — a
 * computed key is invisible to `check-i18n-keys.mjs`, same reasoning
 * `attendance-month-grid.tsx`'s own `WEEKDAY_KEYS` documents. */
const WEEKDAY_LABEL_KEYS = [
  'attendance.weekday.0',
  'attendance.weekday.1',
  'attendance.weekday.2',
  'attendance.weekday.3',
  'attendance.weekday.4',
  'attendance.weekday.5',
  'attendance.weekday.6',
] as const;

const DAILY_SOURCES = ['ANY', 'CLASS_TEACHER', 'FIRST_PERIOD', 'DEVICE'] as const;

const attendanceSchema = z
  .object({
    weeklyOff0: z.boolean(),
    weeklyOff1: z.boolean(),
    weeklyOff2: z.boolean(),
    weeklyOff3: z.boolean(),
    weeklyOff4: z.boolean(),
    weeklyOff5: z.boolean(),
    weeklyOff6: z.boolean(),
    lateAfter: z.string().regex(HH_MM_PATTERN),
    absentAfter: z.string().regex(HH_MM_PATTERN),
    correctionWindowDays: latinBounded(0, 365),
    lowAttendanceThresholdPercent: latinBounded(0, 100),
    lateCountsAsPresent: z.boolean(),
    leaveCountsAsWorkingDay: z.boolean(),
    allowFutureDates: z.boolean(),
    percentageDenominator: z.enum(['WORKING_DAYS', 'MARKED_DAYS']),
    autoAbsentEnabled: z.boolean(),
    autoAbsentCutoffTime: z.string().regex(HH_MM_PATTERN),
    arrivalEnabled: z.boolean(),
    arrivalSmsAllowed: z.boolean(),
    periodEnabled: z.boolean(),
    dailySource: z.enum(['ANY', 'CLASS_TEACHER', 'FIRST_PERIOD', 'DEVICE']),
    // Keyed by shift id; '' or missing = not set. Entries for deleted shifts stay in
    // form state but are filtered out on save (see `handleSave`).
    shiftTimes: z.record(
      z.string(),
      z.object({ lateAfter: z.string().optional(), absentAfter: z.string().optional() }),
    ),
    // Edited through SpecialTimingDialog, which validates; the server re-checks.
    specialTimings: z.array(
      z.object({
        name: z.string(),
        from: z.string(),
        to: z.string(),
        shiftId: z.string().nullable(),
        lateAfter: z.string(),
        absentAfter: z.string(),
        periods: z.array(
          z.object({ sequence: z.number(), startsAt: z.string(), endsAt: z.string() }),
        ),
      }),
    ),
  })
  .superRefine((values, ctx) => {
    // Exactly one of the pair is an error; the message is shown translated
    // (`attendance.shiftBothRequired`), never this string.
    for (const [id, row] of Object.entries(values.shiftTimes)) {
      if (Boolean(row.lateAfter) !== Boolean(row.absentAfter)) {
        ctx.addIssue({
          code: 'custom',
          message: 'both-required',
          path: ['shiftTimes', id, row.lateAfter ? 'absentAfter' : 'lateAfter'],
        });
      }
    }
  });

type AttendanceFormValues = z.infer<typeof attendanceSchema>;

interface AttendanceSectionProps {
  schoolId: string;
  attendance: AttendancePolicySettings | undefined;
}

const WEEKDAY_FIELD = [
  'weeklyOff0',
  'weeklyOff1',
  'weeklyOff2',
  'weeklyOff3',
  'weeklyOff4',
  'weeklyOff5',
  'weeklyOff6',
] as const;

// Mirrors server DEFAULT_ATTENDANCE_SETTINGS (tenant-settings-defaults.ts); change both together.
const DEFAULT_VALUES: AttendanceFormValues = {
  weeklyOff0: false,
  weeklyOff1: false,
  weeklyOff2: false,
  weeklyOff3: false,
  weeklyOff4: false,
  weeklyOff5: true,
  weeklyOff6: false,
  lateAfter: '08:15',
  absentAfter: '10:00',
  correctionWindowDays: '2',
  lowAttendanceThresholdPercent: '75',
  lateCountsAsPresent: true,
  leaveCountsAsWorkingDay: false,
  allowFutureDates: false,
  percentageDenominator: 'WORKING_DAYS',
  autoAbsentEnabled: false,
  autoAbsentCutoffTime: '11:00',
  arrivalEnabled: false,
  arrivalSmsAllowed: false,
  periodEnabled: false,
  dailySource: 'ANY',
  shiftTimes: {},
  specialTimings: [],
};

function toFormValues(attendance: AttendancePolicySettings | undefined): AttendanceFormValues {
  if (!attendance) return DEFAULT_VALUES;
  const offDays = new Set(attendance.weeklyOffDays);
  const weekdayValues = Object.fromEntries(
    WEEKDAY_FIELD.map((field, day) => [field, offDays.has(day)]),
  ) as Pick<AttendanceFormValues, (typeof WEEKDAY_FIELD)[number]>;
  return {
    ...weekdayValues,
    lateAfter: attendance.lateAfter,
    absentAfter: attendance.absentAfter,
    correctionWindowDays: String(attendance.correctionWindowDays),
    lowAttendanceThresholdPercent: String(attendance.lowAttendanceThresholdPercent),
    lateCountsAsPresent: attendance.lateCountsAsPresent,
    leaveCountsAsWorkingDay: attendance.leaveCountsAsWorkingDay,
    allowFutureDates: attendance.allowFutureDates,
    percentageDenominator: attendance.percentageDenominator,
    autoAbsentEnabled: attendance.autoAbsentNotification.enabled,
    autoAbsentCutoffTime: attendance.autoAbsentNotification.cutoffTime,
    arrivalEnabled: attendance.arrivalNotice?.enabled ?? false,
    arrivalSmsAllowed: attendance.arrivalNotice?.smsAllowed ?? false,
    periodEnabled: attendance.periodAttendance?.enabled ?? false,
    dailySource: attendance.dailySource ?? 'ANY',
    shiftTimes: Object.fromEntries(
      (attendance.shiftTimes ?? []).map((row) => [
        row.shiftId,
        { lateAfter: row.lateAfter, absentAfter: row.absentAfter },
      ]),
    ),
    specialTimings: attendance.specialTimings ?? [],
  };
}

export function AttendanceSection({ schoolId, attendance }: AttendanceSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<AttendanceFormValues>({
    resolver: zodResolver(attendanceSchema),
    defaultValues: toFormValues(attendance),
    ...useFormShellMode(),
  });
  const [confirmingAutoAbsent, setConfirmingAutoAbsent] = React.useState(false);
  // `index` = entry being edited, -1 = adding, null = closed.
  const [editingTiming, setEditingTiming] = React.useState<number | null>(null);
  const regionConfig = useRegionConfig();

  // Not `isDirty && !isSubmitSuccessful` (the pattern most sibling
  // settings sections use): `handleSave` below calls `.mutate()` without
  // awaiting it, so React Hook Form marks the submit "successful" as soon
  // as that synchronous call returns — before the PATCH has actually
  // resolved. A failed save would then leave the form dirty with the
  // warning already suppressed. `isDirty` alone still clears correctly on
  // success, since the `onSuccess` callback calls `form.reset(values)`.
  useWarnUnsavedChanges(form.formState.isDirty);

  const updateSettings = useUpdateSchoolSettings(schoolId);
  const shiftsQuery = useShifts();
  const shifts = shiftsQuery.data?.data ?? [];

  function handleAutoAbsentChange(checked: boolean, onChange: (value: boolean) => void) {
    if (checked) {
      setConfirmingAutoAbsent(true);
      return;
    }
    onChange(false);
  }

  function handleConfirmAutoAbsent(onChange: (value: boolean) => void) {
    onChange(true);
    setConfirmingAutoAbsent(false);
  }

  const arrivalEnabled = form.watch('arrivalEnabled');
  const dailySource = form.watch('dailySource');

  function handleSave(values: AttendanceFormValues) {
    const policy: AttendancePolicySettings = {
      weeklyOffDays: WEEKDAY_FIELD.map((field, day) => (values[field] ? day : -1)).filter(
        (day) => day >= 0,
      ),
      lateAfter: values.lateAfter,
      absentAfter: values.absentAfter,
      correctionWindowDays: Number(values.correctionWindowDays),
      lowAttendanceThresholdPercent: Number(values.lowAttendanceThresholdPercent),
      lateCountsAsPresent: values.lateCountsAsPresent,
      leaveCountsAsWorkingDay: values.leaveCountsAsWorkingDay,
      allowFutureDates: values.allowFutureDates,
      percentageDenominator: values.percentageDenominator,
      autoAbsentNotification: {
        enabled: values.autoAbsentEnabled,
        cutoffTime: values.autoAbsentCutoffTime,
      },
      // SMS is off whenever notices are off, so turning notices back on never brings SMS
      // (which spends credit) back without anyone ticking it again.
      arrivalNotice: {
        enabled: values.arrivalEnabled,
        smsAllowed: values.arrivalEnabled && values.arrivalSmsAllowed,
      },
      periodAttendance: { enabled: values.periodEnabled },
      dailySource: values.dailySource,
      specialTimings: values.specialTimings,
    };
    // Only once the shift list has loaded: sending [] early would wipe the
    // saved array (the server replaces it whole). Complete rows of shifts
    // that still exist only.
    if (shiftsQuery.data) {
      policy.shiftTimes = shifts.flatMap((shift) => {
        const row = values.shiftTimes[shift.id];
        return row?.lateAfter && row.absentAfter
          ? [{ shiftId: shift.id, lateAfter: row.lateAfter, absentAfter: row.absentAfter }]
          : [];
      });
    }
    updateSettings.mutate(
      { version: 1, attendance: policy },
      {
        onSuccess: () =>
          form.reset(
            { ...values, arrivalSmsAllowed: policy.arrivalNotice?.smsAllowed ?? false },
            { keepIsSubmitSuccessful: true },
          ),
      },
    );
  }

  const specialTimings = form.watch('specialTimings');
  const setSpecialTimings = (next: SpecialTiming[]) =>
    form.setValue('specialTimings', next, { shouldDirty: true });
  const editing =
    editingTiming !== null && editingTiming >= 0 ? specialTimings[editingTiming] : undefined;

  const weekdayField = (day: (typeof WEEKDAYS)[number]) => (
    <FormField
      key={day}
      control={form.control}
      name={WEEKDAY_FIELD[day]}
      render={({ field }) => (
        <FormItem className="flex min-h-11 flex-row items-center gap-3 md:min-h-8">
          <FormControl>
            <Checkbox
              id={`attendance-weekly-off-${day}`}
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          </FormControl>
          <FormLabel htmlFor={`attendance-weekly-off-${day}`} className="flex-1 self-stretch">
            {t(WEEKDAY_LABEL_KEYS[day])}
          </FormLabel>
        </FormItem>
      )}
    />
  );

  const timeField = (name: 'lateAfter' | 'absentAfter' | 'autoAbsentCutoffTime', label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={`attendance-${name}`}>{label}</FormLabel>
          <TimeInput
            id={`attendance-${name}`}
            aria-label={label}
            value={field.value}
            onValueChange={field.onChange}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const numberField = (
    name: 'correctionWindowDays' | 'lowAttendanceThresholdPercent',
    label: string,
    help: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={`attendance-${name}`}>{label}</FormLabel>
          <FormControl>
            <Input id={`attendance-${name}`} inputMode="numeric" {...field} />
          </FormControl>
          <FormDescription>{help}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const checkboxField = (
    name:
      | 'lateCountsAsPresent'
      | 'leaveCountsAsWorkingDay'
      | 'allowFutureDates'
      | 'periodEnabled'
      | 'arrivalEnabled'
      | 'arrivalSmsAllowed',
    label: string,
    options: { help?: string; disabled?: boolean } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex min-h-11 flex-row items-center gap-3 md:col-span-2 md:min-h-8">
          <FormControl>
            <Checkbox
              id={`attendance-${name}`}
              checked={field.value}
              disabled={options.disabled === true}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          </FormControl>
          <div className="flex-1 self-stretch">
            <FormLabel htmlFor={`attendance-${name}`}>{label}</FormLabel>
            {options.help && <FormDescription>{options.help}</FormDescription>}
          </div>
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <SettingsSection
        id="attendance-section"
        title={t('attendance.legend')}
        helpId="administration.settings.section.attendance"
        description={t('attendance.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <fieldset className="mt-4">
          <legend className="text-label text-text-primary">
            {t('attendance.dailySource.legend')}
          </legend>
          <FormField
            control={form.control}
            name="dailySource"
            render={({ field }) => (
              <FormItem>
                <FormDescription>{t('help.dailySource')}</FormDescription>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  aria-label={t('attendance.dailySource.legend')}
                  className="mt-1.5 gap-1"
                >
                  {DAILY_SOURCES.map((source) => (
                    <div key={source} className="flex min-h-11 items-start gap-3 md:min-h-8">
                      <RadioGroupItem value={source} id={`attendance-dailySource-${source}`} />
                      <label htmlFor={`attendance-dailySource-${source}`} className="flex-1">
                        <span className="text-label text-text-primary">
                          {t(`attendance.dailySource.${source}`)}
                        </span>
                        <span className="block text-caption text-text-secondary">
                          {t(`attendance.dailySource.${source}Help`)}
                        </span>
                      </label>
                    </div>
                  ))}
                </RadioGroup>
                {dailySource === 'DEVICE' && (
                  <p className="text-caption text-text-secondary">
                    {t('attendance.dailySource.deviceNote')}
                  </p>
                )}
                {(dailySource === 'CLASS_TEACHER' || dailySource === 'FIRST_PERIOD') && (
                  <p className="text-caption text-text-secondary">
                    {t('attendance.dailySource.teacherNote')}
                  </p>
                )}
              </FormItem>
            )}
          />
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-label text-text-primary">
            {t('attendance.weeklyOffLegend')}
          </legend>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 md:flex md:flex-wrap md:gap-x-6">
            {WEEKDAYS.map((day) => weekdayField(day))}
          </div>
          <p className="mt-1.5 text-caption text-text-secondary">{t('attendance.weeklyOffHint')}</p>
        </fieldset>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {timeField('lateAfter', t('attendance.lateAfter'))}
          {timeField('absentAfter', t('attendance.absentAfter'))}
          {numberField(
            'correctionWindowDays',
            t('attendance.correctionWindowDays'),
            t('attendance.correctionWindowHelp'),
          )}
          {numberField(
            'lowAttendanceThresholdPercent',
            t('attendance.lowAttendanceThresholdPercent'),
            t('attendance.lowAttendanceHelp'),
          )}
          <FormField
            control={form.control}
            name="percentageDenominator"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel htmlFor="attendance-percentageDenominator">
                  {t('attendance.percentageDenominator')}
                </FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger id="attendance-percentageDenominator">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="WORKING_DAYS">
                      {t('attendance.percentageDenominatorWorkingDays')}
                    </SelectItem>
                    <SelectItem value="MARKED_DAYS">
                      {t('attendance.percentageDenominatorMarkedDays')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {checkboxField('lateCountsAsPresent', t('attendance.lateCountsAsPresent'))}
          {checkboxField('leaveCountsAsWorkingDay', t('attendance.leaveCountsAsWorkingDay'))}
          {checkboxField('allowFutureDates', t('attendance.allowFutureDates'))}
        </div>

        <h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">
          {t('attendance.autoAbsentLegend')}
        </h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="autoAbsentEnabled"
            render={({ field }) => (
              <FormItem className="flex min-h-11 flex-row items-center gap-3 md:col-span-2 md:min-h-8">
                <FormControl>
                  <Checkbox
                    id="attendance-autoAbsentEnabled"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      handleAutoAbsentChange(checked === true, field.onChange)
                    }
                  />
                </FormControl>
                <FormLabel htmlFor="attendance-autoAbsentEnabled" className="flex-1 self-stretch">
                  {t('attendance.autoAbsentEnabled')}
                </FormLabel>
                <HelpHint helpId="administration.settings.field.autoAbsentEnabled" />
                <ConfirmDialog
                  open={confirmingAutoAbsent}
                  onOpenChange={setConfirmingAutoAbsent}
                  title={t('attendance.confirmEnableNotificationTitle')}
                  description={t('attendance.confirmEnableNotificationDescription')}
                  confirmLabel={t('attendance.confirmEnableNotificationConfirm')}
                  cancelLabel={t('attendance.confirmEnableNotificationCancel')}
                  tone="default"
                  onConfirm={() => handleConfirmAutoAbsent(field.onChange)}
                />
              </FormItem>
            )}
          />
          {timeField('autoAbsentCutoffTime', t('attendance.autoAbsentCutoffTime'))}
          {checkboxField('arrivalEnabled', t('attendance.arrivalEnabled'), {
            help: t('help.arrivalNoticeEnabled'),
          })}
          {checkboxField('arrivalSmsAllowed', t('attendance.arrivalSmsAllowed'), {
            help: t('help.arrivalNoticeSmsAllowed'),
            disabled: !arrivalEnabled,
          })}
        </div>

        {shifts.length > 0 && (
          <fieldset className="mt-6 border-t border-border-subtle pt-4">
            <legend className="text-h3">{t('attendance.shiftTimesLegend')}</legend>
            <p className="mt-1 text-caption text-text-secondary">
              {t('attendance.shiftTimesHelp')}
            </p>
            <div className="mt-4 grid gap-4">
              {shifts.map((shift) => {
                const row = form.watch(`shiftTimes.${shift.id}`);
                return (
                  <div
                    key={shift.id}
                    role="group"
                    aria-label={shift.name}
                    className="grid gap-2 md:grid-cols-3 md:items-start md:gap-4"
                  >
                    <div className="md:pt-2">
                      <p className="text-label text-text-primary">{shift.name}</p>
                      {/* TimeInput can't be emptied; this drops the override (an
                        empty pair sends no row) so the school times apply again. */}
                      {(row?.lateAfter || row?.absentAfter) && (
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto px-0"
                          onClick={() =>
                            form.setValue(
                              `shiftTimes.${shift.id}`,
                              { lateAfter: '', absentAfter: '' },
                              { shouldDirty: true, shouldValidate: true },
                            )
                          }
                        >
                          {t('attendance.shiftUseSchoolTimes')}
                        </Button>
                      )}
                    </div>
                    {(['lateAfter', 'absentAfter'] as const).map((key) => (
                      <FormField
                        key={key}
                        control={form.control}
                        name={`shiftTimes.${shift.id}.${key}`}
                        render={({ field }) => {
                          const label = t(
                            key === 'lateAfter'
                              ? 'attendance.shiftLateAfter'
                              : 'attendance.shiftAbsentAfter',
                          );
                          return (
                            <FormItem>
                              <FormLabel htmlFor={`attendance-shift-${shift.id}-${key}`}>
                                {label}
                              </FormLabel>
                              <TimeInput
                                id={`attendance-shift-${shift.id}-${key}`}
                                aria-label={`${shift.name} — ${label}`}
                                value={field.value || undefined}
                                onValueChange={field.onChange}
                              />
                              {form.formState.errors.shiftTimes?.[shift.id]?.[key] && (
                                <p role="alert" className="text-caption text-destructive">
                                  {t('attendance.shiftBothRequired')}
                                </p>
                              )}
                            </FormItem>
                          );
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}

        <fieldset className="mt-6 border-t border-border-subtle pt-4">
          <legend className="text-h3">{t('attendance.specialTimings.legend')}</legend>
          <p className="mt-1 text-caption text-text-secondary">
            {t('attendance.specialTimings.help')}
          </p>
          <ul className="mt-3 grid gap-2">
            {specialTimings.map((timing, index) => (
              <li
                key={`${timing.name}-${timing.from}-${timing.shiftId ?? 'all'}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle p-2"
              >
                <span className="flex-1 text-body">
                  <span className="text-label">{timing.name}</span>
                  {' · '}
                  {formatDateRange(timing.from, timing.to, regionConfig)}
                  {' · '}
                  {timing.shiftId === null
                    ? t('attendance.specialTimings.allShifts')
                    : (shifts.find((s) => s.id === timing.shiftId)?.name ?? '—')}
                  {' · '}
                  {t('attendance.specialTimings.lateAfterShort', {
                    time: formatTime(timing.lateAfter, regionConfig),
                  })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('attendance.specialTimings.edit')} ${timing.name}`}
                  onClick={() => setEditingTiming(index)}
                >
                  {t('attendance.specialTimings.edit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('attendance.specialTimings.remove')} ${timing.name}`}
                  onClick={() => setSpecialTimings(specialTimings.filter((_, i) => i !== index))}
                >
                  {t('attendance.specialTimings.remove')}
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => setEditingTiming(-1)}
          >
            {t('attendance.specialTimings.add')}
          </Button>
          <SpecialTimingDialog
            open={editingTiming !== null}
            onOpenChange={(open) => !open && setEditingTiming(null)}
            initial={editing}
            shifts={shifts}
            shiftsWithOwnTimes={shifts
              .filter((s) => form.watch(`shiftTimes.${s.id}.lateAfter`))
              .map((s) => s.id)}
            others={specialTimings.filter((_, i) => i !== editingTiming)}
            schoolLateAfter={form.watch('lateAfter')}
            schoolAbsentAfter={form.watch('absentAfter')}
            onSave={(timing) =>
              setSpecialTimings(
                editingTiming !== null && editingTiming >= 0
                  ? specialTimings.map((x, i) => (i === editingTiming ? timing : x))
                  : [...specialTimings, timing],
              )
            }
          />
        </fieldset>

        <h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">
          {t('attendance.periodLegend')}
        </h3>
        <div className="mt-4 grid gap-1 md:grid-cols-2">
          {checkboxField('periodEnabled', t('attendance.periodEnabled'))}
          <p className="text-caption text-text-secondary md:col-span-2">
            {t('attendance.periodHelp')}
          </p>
        </div>
      </SettingsSection>
    </Form>
  );
}
