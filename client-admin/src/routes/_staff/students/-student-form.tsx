/**
 * The shared Add/Edit Student form — [8.10.3]. A grouped single form
 * (Identity → Placement → Guardians → Preferences) on `FormShell`, not a
 * wizard, per the issue's own context note: the field count here is low
 * enough that steps would add friction, not remove it.
 *
 * Identical fields/validation for create and edit — the caller supplies
 * `initialValues`/`initialGuardians`, the mutation to run, and how to turn
 * form values into that mutation's input (`buildPayload`). Enrollment
 * status is deliberately not a field here: [8.10.2]'s Transfer/Change
 * Status dialog already owns that change, and duplicating it here would
 * give staff two different places to do the same thing. No student-level
 * email/phone fields either — see `-student-form-schema.ts`'s own header
 * comment on why (`Student` has no such columns; that's `Guardian`'s job).
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  DatePicker,
  ConfirmDialog,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import { useClasses, useClassSections, type Guardian, type Student } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FormSection,
  FormShell,
  FullPageShell,
  applyServerFieldErrors,
  buildFormShellErrors,
  useFormAutosave,
  useFormShellMode,
  useWarnUnsavedChanges,
} from '@biddaloy/ui/shells';
import { parseValidationFieldErrors } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import type { UseMutationResult } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { MutationErrorMessage } from '../../../components/MutationErrorMessage';

import { GuardianPicker } from './-guardian-picker';
import {
  PREFERRED_COMMUNICATION_VALUES,
  STUDENT_FORM_SERVER_FIELDS,
  BLOOD_GROUP_VALUES,
  GENDER_VALUES,
  buildStudentFormSchema,
  type StudentFormValues,
} from './-student-form-schema';

/** Radix `Select` can't hold an empty-string item, so "Not set" travels as this sentinel. */
const BLOOD_GROUP_NOT_SET = '__not_set__';
const GENDER_NOT_SET = '__not_set__';

export interface StudentFormProps<TInput> {
  initialValues: StudentFormValues;
  initialGuardians?: Guardian[];
  autosaveKey: string;
  submitLabel: string;
  title: string;
  onClose: () => void;
  // `TError` is `unknown`: `error instanceof ApiError` below narrows it. Mutations no longer
  // carry `retry: shouldRetryQuery` (#2596), so this is just the loosest type callers can pass.
  mutation: UseMutationResult<Student, unknown, TInput>;
  buildPayload: (values: StudentFormValues) => TInput;
  onSuccess: (student: Student) => void;
  /** [2603] Edit mode: an unchanged form would send an empty PATCH, so Save stays disabled. */
  disableSubmitWhenClean?: boolean;
}

function fieldId(field: string): string {
  return `student-form-${field}`;
}

export function StudentForm<TInput>({
  initialValues,
  initialGuardians = [],
  autosaveKey,
  submitLabel,
  title,
  onClose,
  mutation,
  buildPayload,
  disableSubmitWhenClean,
  onSuccess,
}: StudentFormProps<TInput>) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const classesQuery = useClasses();

  const schema = React.useMemo(
    () =>
      buildStudentFormSchema({
        fullNameRequired: t('form.errors.fullNameRequired'),
        classSectionRequired: t('form.errors.classSectionRequired'),
        rollNumberInvalid: t('form.errors.rollNumberInvalid'),
        fullNameBnTooLong: t('form.errors.fullNameBnTooLong'),
        bloodGroupInvalid: t('form.errors.bloodGroupInvalid'),
      }),
    [t],
  );

  const form = useForm<StudentFormValues>({
    ...useFormShellMode(),
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  const classId = form.watch('classId');
  const sectionsQuery = useClassSections(classId || undefined);

  const hasUnsavedChanges = form.formState.isDirty && !form.formState.isSubmitSuccessful;
  useWarnUnsavedChanges(hasUnsavedChanges);
  // The router calls `shouldBlockFn` against whatever closure was current
  // at the *last committed* render — calling `navigate()` in the same tick
  // as `form.reset()` (this component's own `onSuccess` below does both)
  // races that commit, so `hasUnsavedChanges` can still read stale/`true`
  // when the blocker fires. A ref sidesteps the render-timing question
  // entirely: it's set synchronously, before `onSuccess(student)` is even
  // called, so the very next `shouldBlockFn` invocation already sees it.
  const submittedSuccessfullyRef = React.useRef(false);
  // `enableBeforeUnload: false` — closing the tab/refreshing is already
  // covered by `useWarnUnsavedChanges`'s own `beforeunload` listener above;
  // this only needs to own in-app navigation (a route link, back button).
  // `withResolver: true` renders a real confirmation `Dialog` below rather
  // than `window.confirm` — this repo's own lint rule
  // (`no-window-alert/no-window-alert`) bans the native dialog precisely
  // so every blocking confirmation looks and behaves the same way.
  const blocker = useBlocker({
    shouldBlockFn: () => !submittedSuccessfullyRef.current && hasUnsavedChanges,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const values = form.watch();
  // [2683] Edit mode compares the real payload, not `isDirty`: a whitespace-only edit is dirty
  // but trims to nothing, and would otherwise send an empty PATCH.
  const nothingToSave =
    !!disableSubmitWhenClean && Object.keys(buildPayload(values) as object).length === 0;

  const autosave = useFormAutosave(autosaveKey, values, {
    enabled: !form.formState.isSubmitSuccessful,
  });
  const [draftBannerVisible, setDraftBannerVisible] = React.useState(autosave.draftAvailable);

  // [2594] react-hook-form validates asynchronously before calling this, so a fast second click
  // can arrive before `mutation.isPending` is true. This ref closes that gap.
  const inFlight = React.useRef(false);

  function handleSubmit(values: StudentFormValues) {
    if (inFlight.current) return;
    // Enter in a field submits without the (disabled) button.
    if (disableSubmitWhenClean && Object.keys(buildPayload(values) as object).length === 0) return;
    inFlight.current = true;
    mutation.mutate(buildPayload(values), {
      onSettled: () => {
        inFlight.current = false;
      },
      onSuccess: (student) => {
        submittedSuccessfullyRef.current = true;
        autosave.clearDraft();
        form.reset(values, { keepIsSubmitSuccessful: true });
        onSuccess(student);
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          const fieldErrors = parseValidationFieldErrors(
            error.messages,
            STUDENT_FORM_SERVER_FIELDS,
          );
          applyServerFieldErrors(form.setError, fieldErrors);
        }
      },
    });
  }

  const summaryErrors = buildFormShellErrors(form.formState.errors, fieldId);

  return (
    <Form {...form}>
      <FullPageShell
        title={title}
        onClose={onClose}
        size="form"
        primary={{
          label: submitLabel,
          onClick: () => void form.handleSubmit(handleSubmit)(),
          busy: mutation.isPending,
          disabled: nothingToSave,
        }}
        secondary={{ label: t('form.cancelAction'), onClick: onClose }}
      >
        <ConfirmDialog
          open={blocker.status === 'blocked'}
          onOpenChange={(open) => !open && blocker.reset?.()}
          title={t('form.unsavedChangesDialog.title')}
          description={t('form.unsavedChangesDialog.description')}
          cancelLabel={t('form.unsavedChangesDialog.stayAction')}
          confirmLabel={t('form.unsavedChangesDialog.leaveAction')}
          tone="danger"
          onConfirm={() => blocker.proceed?.()}
        />

        {draftBannerVisible && (
          <div
            role="status"
            className="mx-auto mt-4 flex w-full max-w-3xl flex-col gap-3 rounded-lg border border-border-subtle bg-secondary p-3 md:flex-row md:items-center md:justify-between"
          >
            <span>{t('form.draftAvailable')}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const draft = autosave.restoreDraft();
                  // Drafts saved before a field existed omit it; fill from the defaults.
                  // `keepDefaultValues`: the server values stay the baseline, so the restored
                  // edits count as unsaved and Save is enabled [2683].
                  // The draft is JSON, so `date_of_birth` comes back as a string; rebuild the Date.
                  // `guardian_ids` stays the current set: a stale drafted set would unlink a
                  // guardian linked since, and its ids may have no name to show [2683].
                  if (draft)
                    form.reset(
                      {
                        ...initialValues,
                        ...draft,
                        date_of_birth: draft.date_of_birth
                          ? new Date(draft.date_of_birth)
                          : initialValues.date_of_birth,
                        guardian_ids: initialValues.guardian_ids,
                      },
                      { keepDefaultValues: true },
                    );
                  setDraftBannerVisible(false);
                }}
              >
                {t('form.restoreDraftAction')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  autosave.discardDraft();
                  setDraftBannerVisible(false);
                }}
              >
                {t('form.discardDraftAction')}
              </Button>
            </div>
          </div>
        )}

        <FormShell
          errors={summaryErrors}
          submitCount={form.formState.submitCount}
          onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
        >
          <FormSection legend={t('form.sections.identity')}>
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={fieldId('full_name')} required>
                    {t('form.fields.fullName')}
                  </FormLabel>
                  <FormControl>
                    <Input id={fieldId('full_name')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="full_name_bn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={fieldId('full_name_bn')}>
                    {t('form.fields.fullNameBn')}
                  </FormLabel>
                  <FormControl>
                    <Input id={fieldId('full_name_bn')} lang="bn" maxLength={200} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="blood_group"
              render={({ field }) => (
                <FormItem>
                  <FormLabel
                    htmlFor={fieldId('blood_group')}
                    helpId="people.students.field.bloodGroup"
                  >
                    {t('form.fields.bloodGroup')}
                  </FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(value) =>
                        field.onChange(value === BLOOD_GROUP_NOT_SET ? '' : value)
                      }
                    >
                      <SelectTrigger
                        id={fieldId('blood_group')}
                        aria-label={t('form.fields.bloodGroup')}
                        className="w-full"
                      >
                        <SelectValue placeholder={t('form.selectPlaceholder', { ns: 'common' })} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={BLOOD_GROUP_NOT_SET}>
                          {t('form.bloodGroupNotSet')}
                        </SelectItem>
                        {BLOOD_GROUP_VALUES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="date_of_birth"
              render={({ field }) => (
                // No explicit `htmlFor`/`id` here — `DatePicker` doesn't accept
                // a caller `id` (see `form-shell.tsx`'s own note that a
                // composite widget's focusable element isn't a single
                // `id`-bearing input), so both fall back to the auto
                // `formItemId` `FormLabel`/`FormControl` already share.
                <FormItem>
                  <FormLabel>{t('form.fields.dateOfBirth')}</FormLabel>
                  <FormControl>
                    <DatePicker
                      aria-label={t('form.fields.dateOfBirth')}
                      value={field.value}
                      config={config}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={fieldId('gender')}>{t('form.fields.gender')}</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(value) =>
                        field.onChange(value === GENDER_NOT_SET ? '' : value)
                      }
                    >
                      <SelectTrigger
                        id={fieldId('gender')}
                        aria-label={t('form.fields.gender')}
                        className="w-full"
                      >
                        <SelectValue placeholder={t('form.selectPlaceholder', { ns: 'common' })} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={GENDER_NOT_SET}>{t('form.bloodGroupNotSet')}</SelectItem>
                        {GENDER_VALUES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`form.fields.genderOptions.${value}`)}
                          </SelectItem>
                        ))}
                        {/* Old free text stays selectable so editing never loses it. */}
                        {field.value !== '' &&
                          !(GENDER_VALUES as readonly string[]).includes(field.value) && (
                            <SelectItem value={field.value}>{field.value}</SelectItem>
                          )}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>

          <FormSection legend={t('form.sections.placement')}>
            <FormField
              control={form.control}
              name="classId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={fieldId('classId')} required>
                    {t('form.fields.class')}
                  </FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        form.setValue('class_section_id', '', { shouldDirty: true });
                      }}
                    >
                      <SelectTrigger
                        id={fieldId('classId')}
                        aria-label={t('form.fields.class')}
                        className="w-full"
                      >
                        <SelectValue placeholder={t('form.fields.classPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {classesQuery.data?.data.map((klass) => (
                          <SelectItem key={klass.id} value={klass.id}>
                            {klass.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="class_section_id"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel htmlFor={fieldId('class_section_id')} required>
                    {t('form.fields.section')}
                  </FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!classId}>
                      <SelectTrigger
                        id={fieldId('class_section_id')}
                        aria-label={t('form.fields.section')}
                        aria-invalid={fieldState.invalid}
                        className="w-full"
                      >
                        <SelectValue placeholder={t('form.fields.sectionPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {sectionsQuery.data?.map((section) => (
                          <SelectItem key={section.id} value={section.id}>
                            {section.section_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="roll_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel
                    htmlFor={fieldId('roll_number')}
                    helpId="people.students.field.rollNumber"
                  >
                    {t('form.fields.rollNumber')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      id={fieldId('roll_number')}
                      type="text"
                      inputMode="numeric"
                      placeholder={t('form.fields.rollNumberPlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t('form.fields.rollNumberHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>

          <FormSection legend={t('form.sections.guardians')}>
            <p className="text-text-secondary">{t('form.sections.guardiansHelp')}</p>
            <FormField
              control={form.control}
              name="guardian_ids"
              render={({ field }) => (
                <FormItem>
                  <GuardianPicker
                    selectedIds={field.value}
                    onSelectedIdsChange={field.onChange}
                    initialGuardians={initialGuardians}
                    config={config}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>

          <FormSection legend={t('form.sections.preferences')}>
            <FormField
              control={form.control}
              name="preferred_communication"
              render={({ field }) => (
                <FormItem>
                  <FormLabel
                    htmlFor={fieldId('preferred_communication')}
                    helpId="people.students.field.preferredCommunication"
                  >
                    {t('form.fields.preferredCommunication')}
                  </FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id={fieldId('preferred_communication')}
                        aria-label={t('form.fields.preferredCommunication')}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PREFERRED_COMMUNICATION_VALUES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`form.preferredCommunicationOptions.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="home_address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={fieldId('home_address')}>
                    {t('form.fields.address')}
                  </FormLabel>
                  <FormControl>
                    <Textarea id={fieldId('home_address')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>

          {mutation.isError && <MutationErrorMessage error={mutation.error} />}
        </FormShell>
      </FullPageShell>
    </Form>
  );
}
