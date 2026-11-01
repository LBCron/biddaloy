/**
 * [TIME-11] "Homework" settings section: two school-wide switches for the
 * guardian SMS on assign and on not-submitted. Both default off.
 * Partial save: PATCHes `{ version: 1, homework: {...} }` only.
 */
import {
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  StatusBadge,
} from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type MaskedTenantSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

interface FormValues {
  notifyOnAssign: boolean;
  notifyDefaulters: boolean;
}

interface HomeworkSectionProps {
  schoolId: string;
  homework: MaskedTenantSettings['homework'] | undefined;
  /** The server's "SMS is set up" (D32). `null` = not known yet (loading or failed): no warning. */
  smsConfigured?: boolean | null;
}

const SWITCHES = ['notifyOnAssign', 'notifyDefaulters'] as const;

export function HomeworkSection({
  schoolId,
  homework,
  smsConfigured = false,
}: HomeworkSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<FormValues>({
    defaultValues: {
      notifyOnAssign: homework?.notifyOnAssign ?? false,
      notifyDefaulters: homework?.notifyDefaulters ?? false,
    },
    ...useFormShellMode(),
  });
  useWarnUnsavedChanges(form.formState.isDirty);
  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: FormValues) {
    updateSettings.mutate(
      {
        version: 1,
        homework: {
          notifyOnAssign: values.notifyOnAssign,
          notifyDefaulters: values.notifyDefaulters,
        },
      },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  return (
    <Form {...form}>
      <SettingsSection
        id="homework-section"
        title={t('homework.legend')}
        description={t('homework.description')}
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
          {SWITCHES.map((name) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem className="flex flex-col gap-1">
                  <div className="flex min-h-11 flex-row items-center gap-3 md:min-h-8">
                    <FormControl>
                      <Checkbox
                        id={`homework-${name}`}
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                    </FormControl>
                    <FormLabel htmlFor={`homework-${name}`} className="flex-1 self-stretch">
                      {t(`homework.${name}`)}
                    </FormLabel>
                  </div>
                  <FormDescription>{t(`homework.${name}Help`)}</FormDescription>
                </FormItem>
              )}
            />
          ))}
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
        </div>
      </SettingsSection>
    </Form>
  );
}
