/**
 * [17.4.2] / [31.4] Create/edit calendar event — a full-page modal
 * (`FullPageShell`, D21/D22) opened by `/calendar?panel=new-event` or
 * `?panel=edit-event&event_id=…`. File name kept: `unregistered-actions.ts`
 * lists it.
 *
 * Server 422s (`CALENDAR_EVENT_LOCKED`, `CALENDAR_OUTSIDE_ACADEMIC_YEAR`,
 * `CALENDAR_DAY_HAS_ATTENDANCE`, `CALENDAR_INVALID_CLASS`,
 * `CALENDAR_INVALID_RANGE`, `CALENDAR_REASON_REQUIRED`,
 * `CALENDAR_MAKEUP_MUST_COUNT`) are mapped by `error.details.code` to a
 * translated message — see `calendar.json`'s `eventForm.errors`.
 */
import { CalendarEventType } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Card,
  Checkbox,
  ConfirmDialog,
  DatePicker,
  HelpHint,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import type { CalendarEvent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { tenantTodayIso, toIsoDate } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface EventFormPayload {
  type: CalendarEventType;
  name: string;
  description?: string | undefined;
  start_date: string;
  end_date: string;
  counts_as_working_day?: boolean | undefined;
  publish: boolean;
  notify?: boolean | undefined;
  notify_sms?: boolean | undefined;
  /** Create only: required when the event ends before today. */
  reason?: string | undefined;
}

export interface EventFormPageProps {
  mode: 'create' | 'edit';
  initialValues?: CalendarEvent | undefined;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (payload: EventFormPayload) => void;
}

function parseDateOnly(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parts = value.split('-').map(Number);
  return new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

const KNOWN_ERROR_CODES = [
  'CALENDAR_EVENT_LOCKED',
  'CALENDAR_OUTSIDE_ACADEMIC_YEAR',
  'CALENDAR_DAY_HAS_ATTENDANCE',
  'CALENDAR_INVALID_CLASS',
  'CALENDAR_INVALID_RANGE',
  'CALENDAR_REASON_REQUIRED',
  'CALENDAR_MAKEUP_MUST_COUNT',
] as const;

const MIN_REASON_LENGTH = 3;

const LABEL = 'text-label';

function CheckRow({
  id,
  label,
  checked,
  disabled,
  onChange,
  helpId,
}: {
  helpId?: string;
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 md:min-h-8">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled ?? false}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label htmlFor={id}>{label}</label>
      {helpId && <HelpHint helpId={helpId} label={label} />}
    </div>
  );
}

/** Same rule as the server ([2620]): only a Holiday is not a working day by default. */
const defaultWorking = (t: CalendarEventType) => t !== CalendarEventType.HOLIDAY;

export function EventFormPage({
  mode,
  initialValues,
  isPending,
  error,
  onClose,
  onSubmit,
}: EventFormPageProps) {
  const { t } = useTranslation('calendar');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useRegionConfig();

  const initialStart = initialValues?.start_date;
  const initialEnd = initialValues?.end_date;
  const initialType = initialValues?.type ?? CalendarEventType.EVENT;
  const initial = {
    type: initialType,
    name: initialValues?.name ?? '',
    description: initialValues?.description ?? '',
    start: initialStart ?? '',
    end: initialEnd ?? '',
    working: initialValues?.counts_as_working_day ?? defaultWorking(initialType),
  };

  const [type, setType] = React.useState<CalendarEventType>(initial.type);
  const [name, setName] = React.useState(initial.name);
  const [description, setDescription] = React.useState(initial.description);
  const [startDate, setStartDate] = React.useState<Date | undefined>(parseDateOnly(initialStart));
  const [endDate, setEndDate] = React.useState<Date | undefined>(parseDateOnly(initialEnd));
  const [countsAsWorkingDay, setCountsAsWorkingDay] = React.useState(initial.working);
  // Once the user ticks or unticks the box by hand (or it holds a saved value), a type change
  // leaves their choice alone.
  const [workingTouched, setWorkingTouched] = React.useState(
    mode === 'edit' || initialValues?.counts_as_working_day !== undefined,
  );
  const [publish, setPublish] = React.useState(true);
  const [notify, setNotify] = React.useState(false);
  const [notifySms, setNotifySms] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  // A make-up day exists to add a school day, so it always counts.
  const isMakeup = type === CalendarEventType.MAKEUP_DAY;
  const working = isMakeup || countsAsWorkingDay;
  // A closure with a day that has already passed (on the school's clock, like
  // the server) is recorded after the fact: it needs a reason, and is
  // published at once with no announcement.
  const isPast = !!startDate && toIsoDate(startDate) < tenantTodayIso(regionConfig);
  const lateClosure = mode === 'create' && isPast && !working;

  const isDirty =
    type !== initial.type ||
    name !== initial.name ||
    description !== initial.description ||
    (startDate ? toIsoDate(startDate) : '') !== initial.start ||
    (endDate ? toIsoDate(endDate) : '') !== initial.end ||
    countsAsWorkingDay !== initial.working ||
    notify ||
    notifySms ||
    (mode === 'create' && !publish);

  // A pending save must not be abandoned mid-request (Esc / X / Cancel).
  const close = () => {
    if (!isPending) onClose();
  };

  function submit() {
    if (!name.trim()) {
      setValidationError(t('eventForm.errors.nameRequired'));
      return;
    }
    if (!startDate || !endDate || toIsoDate(endDate) < toIsoDate(startDate)) {
      setValidationError(t('eventForm.errors.CALENDAR_INVALID_RANGE'));
      return;
    }
    if (lateClosure && reason.trim().length < MIN_REASON_LENGTH) {
      setValidationError(t('eventForm.errors.CALENDAR_REASON_REQUIRED'));
      return;
    }
    setValidationError(null);
    onSubmit({
      type,
      name: name.trim(),
      description: description.trim() || undefined,
      start_date: toIsoDate(startDate),
      end_date: toIsoDate(endDate),
      counts_as_working_day: working,
      publish: lateClosure ? true : publish,
      notify: lateClosure ? false : notify,
      notify_sms: lateClosure ? false : notifySms,
      reason: lateClosure ? reason.trim() : undefined,
    });
  }

  const errorCode =
    error instanceof ApiError && typeof error.details?.code === 'string'
      ? error.details.code
      : undefined;
  const errorMessage = validationError
    ? validationError
    : error
      ? t(
          `eventForm.errors.${
            errorCode && (KNOWN_ERROR_CODES as readonly string[]).includes(errorCode)
              ? errorCode
              : 'generic'
          }`,
        )
      : null;

  return (
    <>
      <FullPageShell
        title={mode === 'create' ? t('eventForm.createTitle') : t('eventForm.editTitle')}
        size="form"
        dirty={isDirty}
        onClose={close}
        secondary={{
          label: t('eventForm.cancel'),
          // The shell's footer Cancel bypasses its own discard prompt.
          onClick: () => (isDirty ? setDiscardOpen(true) : close()),
        }}
        primary={{ label: t('eventForm.save'), onClick: submit, busy: isPending }}
      >
        {errorMessage && (
          <p role="alert" className="text-destructive">
            {errorMessage}
          </p>
        )}

        <Card className="p-4 md:p-5">
          <h2 className="text-h3">{t('eventForm.sectionDetails')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-form-type" className={LABEL}>
                {t('eventForm.type')}
              </label>
              <Select
                value={type}
                onValueChange={(value) => {
                  const next = value as CalendarEventType;
                  // Leaving MAKEUP_DAY, or an untouched box: follow the new type's default.
                  if ((isMakeup && next !== CalendarEventType.MAKEUP_DAY) || !workingTouched) {
                    setCountsAsWorkingDay(defaultWorking(next));
                  }
                  setType(next);
                }}
              >
                <SelectTrigger id="event-form-type">
                  <SelectValue placeholder={t('eventForm.typePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(CalendarEventType).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`types.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-form-name" className={LABEL}>
                {t('eventForm.name')}
              </label>
              <Input
                id="event-form-name"
                value={name}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>{t('eventForm.startDate')}</span>
              <DatePicker
                aria-label={t('eventForm.startDate')}
                config={regionConfig}
                value={startDate}
                onValueChange={setStartDate}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>{t('eventForm.endDate')}</span>
              <DatePicker
                aria-label={t('eventForm.endDate')}
                config={regionConfig}
                value={endDate}
                min={startDate}
                onValueChange={setEndDate}
              />
            </div>

            {lateClosure && (
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <span className="inline-flex items-center gap-1">
                  <label htmlFor="event-form-late-reason" className={LABEL}>
                    {t('eventForm.lateReason')}
                  </label>
                  <HelpHint
                    helpId="people.calendar.field.lateReason"
                    label={t('eventForm.lateReason')}
                  />
                </span>
                <Textarea
                  id="event-form-late-reason"
                  value={reason}
                  required
                  maxLength={500}
                  aria-describedby="event-form-late-reason-hint"
                  onChange={(event) => setReason(event.target.value)}
                />
                <p id="event-form-late-reason-hint" className="text-muted-foreground">
                  {t('eventForm.lateReasonHint')}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label htmlFor="event-form-description" className={LABEL}>
                {t('eventForm.description')}
              </label>
              <Textarea
                id="event-form-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
        </Card>

        <Card className="p-4 md:p-5">
          <h2 className="text-h3">{t('eventForm.sectionOptions')}</h2>
          <div className="mt-2">
            <CheckRow
              id="event-form-working-day"
              helpId="people.calendar.field.countsAsWorkingDay"
              label={t('eventForm.countsAsWorkingDay')}
              checked={working}
              disabled={isMakeup}
              onChange={(value) => {
                setWorkingTouched(true);
                setCountsAsWorkingDay(value);
              }}
            />
            {/* The update DTO has no `publish`: publishing an existing draft is its own action. */}
            {mode === 'create' && (
              <CheckRow
                id="event-form-publish"
                label={t('eventForm.publishNow')}
                checked={lateClosure ? true : publish}
                disabled={lateClosure}
                onChange={setPublish}
              />
            )}
            <CheckRow
              id="event-form-notify"
              helpId="people.calendar.field.notify"
              label={t('eventForm.notify')}
              checked={lateClosure ? false : notify}
              disabled={lateClosure}
              onChange={setNotify}
            />
            <CheckRow
              id="event-form-notify-sms"
              label={t('eventForm.notifySms')}
              checked={notifySms}
              disabled={!notify || lateClosure}
              onChange={setNotifySms}
            />
          </div>
        </Card>
      </FullPageShell>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={tCommon('fullPage.discardTitle')}
        description={tCommon('fullPage.discardDescription')}
        confirmLabel={tCommon('fullPage.discardConfirm')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        // A save that started meanwhile can't be abandoned: wait for it, as `close` does.
        busy={isPending}
        onConfirm={() => {
          if (isPending) return;
          setDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}
