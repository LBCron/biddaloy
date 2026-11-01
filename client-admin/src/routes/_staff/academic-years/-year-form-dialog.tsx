/**
 * The shared Create/Edit academic year dialog — [8.11.1]. Three fields
 * (name, start date, end date) plus an `is_current` checkbox, local
 * `useState` rather than `FormShell`/react-hook-form: that machinery
 * (autosave, unsaved-changes warning, submit-error focus summary) earns
 * its keep on the Student admission form's field count, not a 3-field
 * modal — same weight class as a plain 3-field dialog.
 *
 * Owns only the fields and their client-side validation; the actual
 * mutation (create vs. update) is the caller's — this dialog just calls
 * `onSubmit` with a payload shaped for either.
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ConfirmDialog,
  DatePicker,
  Input,
  Label,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { toIsoDate } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface YearFormPayload {
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

export interface YearFormInitialValues {
  name: string;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
}

export interface YearFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialValues?: YearFormInitialValues;
  isPending: boolean;
  isError: boolean;
  onSubmit: (payload: YearFormPayload) => void;
}

const EMPTY_VALUES: YearFormInitialValues = {
  name: '',
  startDate: undefined as unknown as Date,
  endDate: undefined as unknown as Date,
  isCurrent: false,
};

/** Label with a visual required mark; the control carries `aria-required`. */
export function Field({
  label,
  htmlFor,
  helpId,
  children,
}: {
  label: string;
  htmlFor?: string;
  helpId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} helpId={helpId} helpLabel={label}>
        {label}
        <span className="text-destructive" aria-hidden="true">
          {' *'}
        </span>
      </Label>
      {children}
    </div>
  );
}

export function YearFormDialog({
  open,
  onOpenChange,
  mode,
  initialValues,
  isPending,
  isError,
  onSubmit,
}: YearFormDialogProps) {
  const { t } = useTranslation('academicYears');
  const regionConfig = useRegionConfig();

  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [startDate, setStartDate] = React.useState<Date | undefined>(initialValues?.startDate);
  const [endDate, setEndDate] = React.useState<Date | undefined>(initialValues?.endDate);
  const [isCurrent, setIsCurrent] = React.useState(initialValues?.isCurrent ?? false);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [confirmingIsCurrent, setConfirmingIsCurrent] = React.useState(false);

  const [discardOpen, setDiscardOpen] = React.useState(false);
  const initial = initialValues ?? EMPTY_VALUES;
  const isDirty =
    name !== initial.name ||
    isCurrent !== initial.isCurrent ||
    startDate?.getTime() !== initial.startDate?.getTime() ||
    endDate?.getTime() !== initial.endDate?.getTime();

  /** Every close path (Esc, X, outside, Cancel) comes through here: never mid-request,
   * and ask first when there are unsaved edits. */
  function requestClose() {
    if (isPending) return;
    if (isDirty) setDiscardOpen(true);
    else onOpenChange(false);
  }

  /** Checking the box unsets every other current academic year server-side
   * (`academic-year.service.ts`'s `create`/`update`) — same side effect
   * `SetCurrentDialog` requires explicit confirmation for. Route through
   * the same confirmation here rather than flipping `isCurrent` straight
   * from the checkbox, so this form can't bypass it. Unchecking has no
   * such side effect and stays a direct toggle. */
  function handleIsCurrentChange(checked: boolean) {
    if (checked) {
      setConfirmingIsCurrent(true);
      return;
    }
    setIsCurrent(false);
  }

  function handleConfirmIsCurrent() {
    setIsCurrent(true);
    setConfirmingIsCurrent(false);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (name.trim() === '') {
      setValidationError(t('form.errorNameRequired'));
      return;
    }
    if (!startDate || !endDate) {
      setValidationError(t('form.errorDatesRequired'));
      return;
    }
    if (endDate <= startDate) {
      setValidationError(t('form.errorEndBeforeStart'));
      return;
    }

    setValidationError(null);
    onSubmit({
      name: name.trim(),
      start_date: toIsoDate(startDate),
      end_date: toIsoDate(endDate),
      is_current: isCurrent,
    });
  }

  const title = mode === 'create' ? t('form.createTitle') : t('form.editTitle');

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogContent size="md" onInteractOutside={(e) => isPending && e.preventDefault()}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{t('form.description')}</DialogDescription>
            </DialogHeader>

            <Field label={t('form.nameLabel')} htmlFor="year-form-name">
              <Input
                id="year-form-name"
                aria-required="true"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('form.namePlaceholder')}
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('form.startDateLabel')} helpId="academics.academicYears.field.dates">
                <DatePicker
                  aria-label={t('form.startDateLabel')}
                  config={regionConfig}
                  value={startDate}
                  onValueChange={setStartDate}
                />
              </Field>
              <Field label={t('form.endDateLabel')}>
                <DatePicker
                  aria-label={t('form.endDateLabel')}
                  config={regionConfig}
                  value={endDate}
                  onValueChange={setEndDate}
                />
              </Field>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="year-form-is-current"
                checked={isCurrent}
                onCheckedChange={(checked) => handleIsCurrentChange(checked === true)}
              />
              <Label
                htmlFor="year-form-is-current"
                helpId="academics.academicYears.field.isCurrent"
              >
                {t('form.isCurrentLabel')}
              </Label>
            </div>

            {confirmingIsCurrent && (
              <div className="rounded-md border border-border-subtle bg-muted p-3">
                <p>{t('form.confirmIsCurrentDescription')}</p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmingIsCurrent(false)}
                  >
                    {t('form.confirmIsCurrentCancel')}
                  </Button>
                  <Button type="button" onClick={handleConfirmIsCurrent}>
                    {t('form.confirmIsCurrentConfirm')}
                  </Button>
                </div>
              </div>
            )}

            {validationError && (
              <p role="alert" className="text-destructive">
                {validationError}
              </p>
            )}
            {isError && (
              <p role="alert" className="text-destructive">
                {t('form.errorMessage')}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={isPending} onClick={requestClose}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="submit" loading={isPending}>
                {isPending ? t('form.saving') : t('form.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        tone="default"
        title={t('fullPage.discardTitle', { ns: 'common' })}
        description={t('fullPage.discardDescription', { ns: 'common' })}
        confirmLabel={t('fullPage.discardConfirm', { ns: 'common' })}
        cancelLabel={t('fullPage.keepEditing', { ns: 'common' })}
        onConfirm={() => {
          setDiscardOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
