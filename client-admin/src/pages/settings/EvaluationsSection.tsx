/**
 * [28.4.3] "Evaluations" settings section — one school-wide knob:
 * whether a new incident report also sends an SMS (push is always on).
 * Same partial-save shape as `FeesSection.tsx`: PATCHes
 * `{ version: 1, evaluations: {...} }` only. Default off.
 */
import {
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  StatusBadge,
} from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type MaskedTenantSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, CircleAlertIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

interface FormValues {
  incidentSmsEnabled: boolean;
}

interface EvaluationsSectionProps {
  schoolId: string;
  evaluations: MaskedTenantSettings['evaluations'] | undefined;
  /** The server's "SMS is set up" (D32). `null` = not known yet (loading or failed): no warning. */
  smsConfigured?: boolean | null;
}

export function EvaluationsSection({
  schoolId,
  evaluations,
  smsConfigured = false,
}: EvaluationsSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<FormValues>({
    defaultValues: { incidentSmsEnabled: evaluations?.incidentSmsEnabled ?? false },
    ...useFormShellMode(),
  });
  const smsOn = form.watch('incidentSmsEnabled');
  useWarnUnsavedChanges(form.formState.isDirty);
  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: FormValues) {
    updateSettings.mutate(
      { version: 1, evaluations: { incidentSmsEnabled: values.incidentSmsEnabled } },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  return (
    <Form {...form}>
      <SettingsSection
        id="evaluations-section"
        title={t('evaluations.legend')}
        description={t('evaluations.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <div className="mt-4 flex flex-col gap-3">
          <FormField
            control={form.control}
            name="incidentSmsEnabled"
            render={({ field }) => (
              <FormItem className="flex min-h-11 flex-row items-center gap-3 md:min-h-8">
                <FormControl>
                  <Checkbox
                    id="evaluations-incidentSmsEnabled"
                    checked={field.value}
                    aria-describedby="evaluations-incidentSmsHint"
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel htmlFor="evaluations-incidentSmsEnabled" className="flex-1 self-stretch">
                  {t('evaluations.incidentSmsLabel')}
                </FormLabel>
              </FormItem>
            )}
          />
          <p id="evaluations-incidentSmsHint" className="text-caption text-text-secondary">
            {t('evaluations.incidentSmsHint')} {t('evaluations.pushAlwaysOn')}
          </p>
          {smsConfigured !== null && (
            <div className="flex flex-col gap-2 rounded-md bg-muted p-3 md:flex-row md:items-center md:justify-between">
              <StatusBadge
                tone={smsConfigured ? 'success' : 'warning'}
                label={t(
                  smsConfigured ? 'evaluations.providerReady' : 'evaluations.providerNotConfigured',
                )}
              />
              {!smsConfigured && (
                <Link
                  to="/settings"
                  search={{ section: 'communication' }}
                  className="inline-flex h-11 items-center gap-1 rounded-md px-2 font-medium text-primary hover:bg-surface md:h-8"
                >
                  <ArrowRightIcon aria-hidden="true" className="size-4" />
                  {t('evaluations.openSmsSettings')}
                </Link>
              )}
            </div>
          )}
          {smsOn && smsConfigured === false && (
            <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
              <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
              {t('evaluations.providerMissingWarning')}
            </p>
          )}
        </div>
      </SettingsSection>
    </Form>
  );
}
