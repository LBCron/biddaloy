/**
 * [52.5.7] "Applications" settings section: one school-wide knob, whether the
 * final decision on an application also sends an SMS (in-app is always on).
 * Partial save: PATCHes `{ version: 1, applications: {...} }` only. Default off.
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
  smsOnDecision: boolean;
}

interface ApplicationsSectionProps {
  schoolId: string;
  applications: MaskedTenantSettings['applications'] | undefined;
  /** The server's "SMS is set up" (D32). `null` = not known yet (loading or failed): no warning. */
  smsConfigured?: boolean | null;
}

export function ApplicationsSection({
  schoolId,
  applications,
  smsConfigured = false,
}: ApplicationsSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<FormValues>({
    defaultValues: { smsOnDecision: applications?.smsOnDecision ?? false },
    ...useFormShellMode(),
  });
  const smsOn = form.watch('smsOnDecision');
  useWarnUnsavedChanges(form.formState.isDirty);
  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: FormValues) {
    updateSettings.mutate(
      { version: 1, applications: { smsOnDecision: values.smsOnDecision } },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  return (
    <Form {...form}>
      <SettingsSection
        id="applications-section"
        title={t('applications.legend')}
        description={t('applications.description')}
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
            name="smsOnDecision"
            render={({ field }) => (
              <FormItem className="flex min-h-11 flex-row items-center gap-3 md:min-h-8">
                <FormControl>
                  <Checkbox
                    id="applications-smsOnDecision"
                    checked={field.value}
                    aria-describedby="applications-smsHint"
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel htmlFor="applications-smsOnDecision" className="flex-1 self-stretch">
                  {t('applications.smsOnDecisionLabel')}
                </FormLabel>
              </FormItem>
            )}
          />
          <p id="applications-smsHint" className="text-caption text-text-secondary">
            {t('applications.smsOnDecisionHint')}
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
              {t('applications.providerMissingWarning')}
            </p>
          )}
        </div>
      </SettingsSection>
    </Form>
  );
}
