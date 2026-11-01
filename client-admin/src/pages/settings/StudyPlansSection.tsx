/**
 * [66.3] "Study plans" settings section — deadline, reminder, escalation and
 * digest timings (D25) plus the guardian digest SMS switch (D26, default off).
 * Same partial-save shape as `EvaluationsSection.tsx`: PATCHes
 * `{ version: 1, studyPlans: {...} }` only. A summary row above the fields
 * reads the form's live values, so editing a time updates the sentence before
 * saving.
 */
import { DEFAULT_STUDY_PLANS_SETTINGS, type StudyPlansSettings } from '@biddaloy/shared';
import {
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  TimeInput,
} from '@biddaloy/ui/components';
import { useSmsCredits, useUpdateSchoolSettings } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatTime } from '@biddaloy/ui/utils';
import {
  BellRingIcon,
  CalendarCheckIcon,
  ClockIcon,
  MailCheckIcon,
  type LucideIcon,
} from 'lucide-react';
import { useForm } from 'react-hook-form';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

const DEFAULTS = DEFAULT_STUDY_PLANS_SETTINGS;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

interface FormValues {
  statusDeadline: string;
  reminderTime: string;
  /** Text while typing; validated to an integer 1-10 on save. */
  escalateAfterSchoolDays: string;
  weeklyDigestTime: string;
  guardianDigestSms: boolean;
}

interface StudyPlansSectionProps {
  schoolId: string;
  studyPlans: StudyPlansSettings | undefined;
  /** The server's "SMS is set up" (D32). `null` = not known yet (loading or failed): no warning. */
  smsConfigured?: boolean | null;
}

export function StudyPlansSection({
  schoolId,
  studyPlans,
  smsConfigured = false,
}: StudyPlansSectionProps) {
  const { t } = useTranslation('settings');
  const config = useRegionConfig();
  const form = useForm<FormValues>({
    defaultValues: {
      statusDeadline: studyPlans?.statusDeadline ?? DEFAULTS.statusDeadline,
      reminderTime: studyPlans?.reminderTime ?? DEFAULTS.reminderTime,
      escalateAfterSchoolDays: String(
        studyPlans?.escalateAfterSchoolDays ?? DEFAULTS.escalateAfterSchoolDays,
      ),
      weeklyDigestTime: studyPlans?.weeklyDigestTime ?? DEFAULTS.weeklyDigestTime,
      guardianDigestSms: studyPlans?.guardianDigestSms ?? DEFAULTS.guardianDigestSms,
    },
    ...useFormShellMode(),
  });
  useWarnUnsavedChanges(form.formState.isDirty);
  const updateSettings = useUpdateSchoolSettings(schoolId);
  const credits = useSmsCredits(1, 1, schoolId);
  const balance = credits.data?.metering === 'PLATFORM' ? credits.data.available : undefined;

  const live = form.watch();
  const liveDays = Number.parseInt(live.escalateAfterSchoolDays, 10);

  function handleSave(values: FormValues) {
    const studyPlansPatch = {
      statusDeadline: values.statusDeadline,
      reminderTime: values.reminderTime,
      escalateAfterSchoolDays: Number(values.escalateAfterSchoolDays),
      weeklyDigestTime: values.weeklyDigestTime,
      guardianDigestSms: values.guardianDigestSms,
    };
    updateSettings.mutate(
      { version: 1, studyPlans: studyPlansPatch },
      {
        onSuccess: () =>
          form.reset(values, { keepIsSubmitSuccessful: true, keepDirtyValues: true }),
      },
    );
  }

  const timeField = (
    name: 'statusDeadline' | 'reminderTime' | 'weeklyDigestTime',
    label: string,
    help: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      rules={{ validate: (value) => TIME.test(value) || t('studyPlans.invalidTime') }}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={`studyPlans-${name}`}>{label}</FormLabel>
          <TimeInput
            id={`studyPlans-${name}`}
            aria-label={label}
            value={field.value}
            onValueChange={field.onChange}
          />
          <FormDescription>{help}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <SettingsSection
        id="study-plans-section"
        title={t('studyPlans.legend')}
        description={t('studyPlans.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <section aria-label={t('studyPlans.summaryTitle')} className="mt-4">
          <h3 className="text-h3">{t('studyPlans.summaryTitle')}</h3>
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            <SummaryTile
              icon={ClockIcon}
              value={formatTime(live.statusDeadline, config)}
              text={t('studyPlans.summary.deadline')}
            />
            <SummaryTile
              icon={BellRingIcon}
              value={t('studyPlans.summary.reminderValue', {
                time: formatTime(live.reminderTime, config),
              })}
              text={t('studyPlans.summary.reminder')}
            />
            <SummaryTile
              icon={CalendarCheckIcon}
              value={t('studyPlans.summary.escalateValue', {
                count: Number.isFinite(liveDays) ? liveDays : 0,
              })}
              text={t('studyPlans.summary.escalate')}
            />
            <SummaryTile
              icon={MailCheckIcon}
              value={t('studyPlans.summary.digestValue', {
                time: formatTime(live.weeklyDigestTime, config),
              })}
              text={t('studyPlans.summary.digest')}
            />
          </ul>
        </section>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {timeField(
            'statusDeadline',
            t('studyPlans.statusDeadline'),
            t('studyPlans.statusDeadlineHelp'),
          )}
          {timeField(
            'reminderTime',
            t('studyPlans.reminderTime'),
            t('studyPlans.reminderTimeHelp'),
          )}
          <FormField
            control={form.control}
            name="escalateAfterSchoolDays"
            rules={{
              validate: (value) => {
                const n = Number(value);
                return (Number.isInteger(n) && n >= 1 && n <= 10) || t('studyPlans.escalateRange');
              },
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="studyPlans-escalateAfterSchoolDays">
                  {t('studyPlans.escalateAfter')}
                </FormLabel>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Input
                      id="studyPlans-escalateAfterSchoolDays"
                      inputMode="numeric"
                      className="w-20"
                      {...field}
                    />
                  </FormControl>
                  <span className="text-text-secondary">{t('studyPlans.escalateSuffix')}</span>
                </div>
                <FormDescription>{t('studyPlans.escalateHelp')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {timeField(
            'weeklyDigestTime',
            t('studyPlans.weeklyDigestTime'),
            t('studyPlans.weeklyDigestHelp'),
          )}
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <FormField
            control={form.control}
            name="guardianDigestSms"
            render={({ field }) => (
              <FormItem className="flex min-h-11 flex-row items-center gap-3 md:min-h-8">
                <FormControl>
                  <Checkbox
                    id="studyPlans-guardianDigestSms"
                    checked={field.value}
                    disabled={smsConfigured === false && !field.value}
                    aria-describedby="studyPlans-guardianSmsHint"
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel htmlFor="studyPlans-guardianDigestSms" className="flex-1 self-stretch">
                  {t('studyPlans.guardianSms')}
                </FormLabel>
              </FormItem>
            )}
          />
          <p id="studyPlans-guardianSmsHint" className="text-caption text-text-secondary">
            {t('studyPlans.guardianSmsHelp')}
            {balance !== undefined && <> {t('studyPlans.smsBalance', { count: balance })}</>}
            {smsConfigured === false && <> {t('evaluations.providerNotConfigured')}</>}
          </p>
        </div>
      </SettingsSection>
    </Form>
  );
}

function SummaryTile({
  icon: Icon,
  value,
  text,
}: {
  icon: LucideIcon;
  value: string;
  text: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-md bg-muted p-3">
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-text-secondary" />
      <p>
        <strong className="font-semibold">{value}</strong>
        <span className="text-text-secondary"> — {text}</span>
      </p>
    </li>
  );
}
