/**
 * [8.15.47] "Email this regularly": the dialog behind the runner's More menu (Epic 8.15 D15, D21).
 *
 * ```
 *  Email this report regularly
 *  Every [month v] on day [1 v] at [9:00 am v], send to [Accountant v]       <- one sentence
 *  (Bangla: প্রতি [মাসের] [১] তারিখ [সকাল ৯টায়] [হিসাবরক্ষক]-কে পাঠান)
 *                                            [Cancel] [Start emailing]
 *  Already emailed regularly
 *   Every month on day 1 at 9:00 am, send to Accountant            [Stop]
 * ```
 *
 * The form is a sentence, so nobody meets a "frequency" or a "cron" word. The order of the pieces
 * comes from the translation (`delivery.email.sentence.*`): Bangla puts the day before "তারিখ" and the
 * role before "-কে পাঠান", English does not. Defaults: every month, on the 1st, at 9 am, to the
 * person's own role. The server builds the cron from these fields; this page never sends one. The
 * report arrives as a link in an email (D15), as Excel.
 *
 * Saving carries an `Idempotency-Key` (one per body) and never retries (`useCreateReportSchedule`).
 * Only an admin may open it (`REPORTS_DESIGN`, checked by the menu and by the server).
 */
import {
  ExportFormat,
  Permission,
  ReportScheduleFrequency,
  UserRole,
  roleHasPermission,
} from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelpHint,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@biddaloy/ui/components';
import {
  useActiveRole,
  useCreateReportSchedule,
  useDeleteReportSchedule,
  useReportSchedules,
  type CreateReportScheduleInput,
  type ReportSchedule,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

/** The roles a report can be sent to: they may open reports and take the file (the server checks too). */
const RECIPIENT_ROLES = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.COMMITTEE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
].filter(
  (role) =>
    roleHasPermission(role, Permission.REPORTS_VIEW) &&
    roleHasPermission(role, Permission.REPORTS_EXPORT),
);

/** The times of day offered: 6 am to 9 pm, on the hour. */
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => i + 1);
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const hh = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

function periodOf(hour: number) {
  if (hour < 12) return 'morning';
  if (hour < 16) return 'noon';
  if (hour < 18) return 'afternoon';
  if (hour < 20) return 'evening';
  return 'night';
}

/** Words for the pieces of the sentence, shared by the form and the "already emailed" lines. */
function useSentenceWords() {
  const { t } = useTranslation('reports');
  const { t: tStaff } = useTranslation('staff');
  const config = useRegionConfig();
  return {
    frequency: (f: string) => t(`delivery.email.frequency.${f}`),
    weekday: (d: number) => t(`delivery.email.weekdays.${d}`),
    dayOfMonth: (d: number) => formatNumber(d, config),
    time: (localTime: string) => {
      const hour = Number(localTime.slice(0, 2));
      return t('delivery.email.time', {
        hour: formatNumber(hour % 12 === 0 ? 12 : hour % 12, config),
        period: t(`delivery.email.periods.${periodOf(hour)}`),
      });
    },
    role: (role: string) => tStaff(`roles.${role}`),
    sentence: (frequency: string) =>
      t(`delivery.email.sentence.${frequency}`, {
        frequency: '[[frequency]]',
        day: '[[day]]',
        time: '[[time]]',
        role: '[[role]]',
      }),
  };
}

/** The sentence with each `[[token]]` replaced by what `pieces` makes of it. */
function fillSentence(
  template: string,
  pieces: Record<string, React.ReactNode>,
): React.ReactNode[] {
  return template.split(/(\[\[\w+\]\])/).map((part, index) => {
    const token = /^\[\[(\w+)\]\]$/.exec(part)?.[1];
    return token ? <React.Fragment key={index}>{pieces[token]}</React.Fragment> : part;
  });
}

function plainSentence(schedule: ReportSchedule, words: ReturnType<typeof useSentenceWords>) {
  const day =
    schedule.frequency === ReportScheduleFrequency.WEEKLY
      ? words.weekday(schedule.day_of_week ?? 0)
      : words.dayOfMonth(schedule.day_of_month ?? 1);
  return words
    .sentence(schedule.frequency)
    .replace('[[frequency]]', words.frequency(schedule.frequency))
    .replace('[[day]]', day)
    .replace('[[time]]', words.time(schedule.local_time))
    .replace('[[role]]', schedule.recipient_roles.map(words.role).join(', '));
}

export interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definitionId: string;
  /** The answers the report was run with, so the email shows the same view. */
  params: Record<string, unknown>;
}

export function ScheduleDialog({ open, onOpenChange, ...rest }: ScheduleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {/* Mounts with the dialog, so the list is read only while it is open. */}
        <ScheduleForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PieceSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={className ?? 'w-auto min-w-24'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ScheduleForm({
  definitionId,
  params,
  onClose,
}: Omit<ScheduleDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const { t } = useTranslation('reports');
  const { t: tCommon } = useTranslation('common');
  const words = useSentenceWords();
  const ownRole = useActiveRole();
  const existing = useReportSchedules(definitionId);
  const create = useCreateReportSchedule(definitionId);
  const remove = useDeleteReportSchedule(definitionId);

  // Defaults: every month, on the 1st, at 9 am, to the person's own role.
  const [frequency, setFrequency] = React.useState<string>(ReportScheduleFrequency.MONTHLY);
  const [dayOfMonth, setDayOfMonth] = React.useState(1);
  const [dayOfWeek, setDayOfWeek] = React.useState(1);
  const [hour, setHour] = React.useState(9);
  const [role, setRole] = React.useState<string>(
    ownRole && RECIPIENT_ROLES.includes(ownRole as (typeof RECIPIENT_ROLES)[number])
      ? ownRole
      : (RECIPIENT_ROLES[0] ?? UserRole.ADMIN),
  );

  const pieces = {
    frequency: (
      <PieceSelect
        label={t('delivery.email.frequencyLabel')}
        value={frequency}
        onChange={setFrequency}
        options={Object.values(ReportScheduleFrequency).map((f) => ({
          value: f,
          label: words.frequency(f),
        }))}
      />
    ),
    day:
      frequency === ReportScheduleFrequency.WEEKLY ? (
        <PieceSelect
          label={t('delivery.email.dayOfWeekLabel')}
          value={String(dayOfWeek)}
          onChange={(v) => setDayOfWeek(Number(v))}
          options={WEEKDAYS.map((d) => ({ value: String(d), label: words.weekday(d) }))}
        />
      ) : (
        <PieceSelect
          label={t('delivery.email.dayOfMonthLabel')}
          value={String(dayOfMonth)}
          onChange={(v) => setDayOfMonth(Number(v))}
          options={DAYS_OF_MONTH.map((d) => ({ value: String(d), label: words.dayOfMonth(d) }))}
          className="w-auto min-w-20"
        />
      ),
    time: (
      <PieceSelect
        label={t('delivery.email.timeLabel')}
        value={String(hour)}
        onChange={(v) => setHour(Number(v))}
        options={HOURS.map((h) => ({ value: String(h), label: words.time(hh(h)) }))}
        className="w-auto min-w-32"
      />
    ),
    role: (
      <PieceSelect
        label={t('delivery.email.roleLabel')}
        value={role}
        onChange={setRole}
        options={RECIPIENT_ROLES.map((r) => ({ value: r, label: words.role(r) }))}
        className="w-auto min-w-36"
      />
    ),
  };

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (create.isPending) return;
    create.mutate(
      {
        frequency: frequency as ReportScheduleFrequency,
        ...(frequency === ReportScheduleFrequency.WEEKLY ? { day_of_week: dayOfWeek } : {}),
        ...(frequency === ReportScheduleFrequency.MONTHLY ? { day_of_month: dayOfMonth } : {}),
        local_time: hh(hour),
        ...(Object.keys(params).length > 0 ? { params } : {}),
        recipient_roles: [role] as CreateReportScheduleInput['recipient_roles'],
        format: ExportFormat.XLSX,
      },
      {
        onSuccess: () => {
          toast.success(t('delivery.email.saved', { role: words.role(role) }));
          onClose();
        },
      },
    );
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-1">
          <DialogTitle>{t('delivery.email.title')}</DialogTitle>
          <HelpHint helpId="reports.hub.action.emailRegularly" />
        </div>
        <DialogDescription>{t('delivery.email.description')}</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('delivery.email.legend')}</legend>
          <p className="flex flex-wrap items-center gap-2">
            {fillSentence(words.sentence(frequency), pieces)}
          </p>
        </fieldset>
        {create.isError && (
          <p role="alert" className="text-destructive">
            {t('delivery.email.error')}
          </p>
        )}
        <DialogFooter showCloseButton closeLabel={tCommon('actions.cancel')}>
          <Button type="submit" loading={create.isPending}>
            {t('delivery.email.save')}
          </Button>
        </DialogFooter>
      </form>
      {existing.isError && (
        <p role="alert" className="text-destructive">
          {t('delivery.email.existing.loadError')}
        </p>
      )}
      {(existing.data?.length ?? 0) > 0 && (
        <section aria-labelledby="existing-emails" className="flex flex-col gap-2">
          <h3 id="existing-emails" className="text-h3">
            {t('delivery.email.existing.title')}
          </h3>
          <ul className="flex flex-col gap-2">
            {existing.data?.map((schedule) => {
              const sentence = plainSentence(schedule, words);
              return (
                <li key={schedule.id} className="flex items-center justify-between gap-2">
                  <span>{sentence}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={t('delivery.email.existing.stopLabel', { sentence })}
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(schedule.id, {
                        onSuccess: () => toast.success(t('delivery.email.existing.stopped')),
                        onError: () => toast.error(t('delivery.email.existing.stopError')),
                      })
                    }
                  >
                    {t('delivery.email.existing.stop')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
