/**
 * [8.11.5]'s shared Create/Edit fee-structure dialog. Tier B form — plain
 * `useState`, like `academic-years/-year-form-dialog.tsx` — because
 * `FormShell`/react-hook-form's machinery (autosave, unsaved-changes
 * warning, submit-error focus summary) earns its keep on the Student
 * admission form's field count, not on a modal this size.
 *
 * One behaviour the API still forces on this dialog: `UpdateFeeStructureDto`
 * accepts no `academic_year_id`, so in edit mode that field renders
 * disabled. `class_id`/`section_id` are patchable in both modes.
 */
import { FeeType } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelpHint,
  Input,
  Label,
  MoneyInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useClasses,
  useClassSections,
  useCreateFeeStructure,
  useUpdateFeeStructure,
  type FeeStructure,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { minorUnitsToDecimalString, serverAmountToMinorUnits } from '@biddaloy/ui/utils';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';

/** Radix `Select.Item` rejects an empty-string `value`, so "no section"
 * needs a real sentinel — `section_id` is never this string. */
const NO_SECTION = '__none__';
/** Same sentinel trick for "no class" — a school-wide structure has a
 * null `class_id`, which Radix's `Select.Item` also can't represent
 * directly. */
const NO_CLASS = '__none__';

interface FormErrors {
  name?: string;
  amount?: string;
  academicYear?: string;
}

/** `aria-invalid` + `aria-describedby` for a control whose error sits under it. */
function invalidProps(id: string, error: string | undefined) {
  return error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {};
}

/** Visible label tied to its control, optional required mark, and the field's own error. */
function Field({
  id,
  label,
  required,
  requiredLabel,
  error,
  className,
  helpId,
  children,
}: {
  id: string;
  helpId?: string;
  label: string;
  required?: boolean;
  requiredLabel?: string;
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
      {error && (
        <p id={`${id}-error`} className="flex items-center gap-1 text-caption text-destructive">
          <CircleAlertIcon className="size-3.5" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

export interface StructureFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** The list row being edited. */
  structure?: FeeStructure;
  onSaved: () => void;
}

export function StructureFormDialog({
  open,
  onOpenChange,
  mode,
  structure,
  onSaved,
}: StructureFormDialogProps) {
  const { t } = useTranslation('feeStructures');
  const regionConfig = useRegionConfig();
  const requiredLabel = t('form.required', { ns: 'common' });

  const createStructure = useCreateFeeStructure();
  const updateStructure = useUpdateFeeStructure(structure?.id ?? '');
  const mutation = mode === 'create' ? createStructure : updateStructure;

  const yearsQuery = useAcademicYears();
  const [academicYearId, setAcademicYearId] = React.useState(structure?.academic_year_id ?? '');
  const [classId, setClassId] = React.useState(structure?.class_id ?? '');
  const classesQuery = useClasses(
    academicYearId !== '' ? { academic_year_id: academicYearId } : {},
  );
  const sectionsQuery = useClassSections(classId !== '' ? classId : undefined);

  const [name, setName] = React.useState(structure?.name ?? '');
  const [feeType, setFeeType] = React.useState<FeeType>(
    (structure?.fee_type as FeeType) ?? FeeType.MONTHLY_TUITION,
  );
  const [amountMinorUnits, setAmountMinorUnits] = React.useState<number | undefined>(undefined);
  const [sectionId, setSectionId] = React.useState(structure?.section_id ?? '');
  const [errors, setErrors] = React.useState<FormErrors>({});

  // Reset only on open/close transitions, so typing isn't clobbered by a
  // background refetch of the list the `structure` prop came from.
  React.useEffect(() => {
    if (!open) return;
    mutation.reset();
    setName(structure?.name ?? '');
    setFeeType((structure?.fee_type as FeeType) ?? FeeType.MONTHLY_TUITION);
    setAmountMinorUnits(
      structure ? serverAmountToMinorUnits(structure.amount, regionConfig) : undefined,
    );
    setAcademicYearId(structure?.academic_year_id ?? '');
    setClassId(structure?.class_id ?? '');
    setSectionId(structure?.section_id ?? '');
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const next: FormErrors = {};
    if (name.trim() === '') next.name = t('form.errorNameRequired');
    if (amountMinorUnits === undefined || amountMinorUnits <= 0) {
      next.amount = t('form.errorAmountRequired');
    }
    if (mode === 'create' && academicYearId === '') {
      next.academicYear = t('form.errorAcademicYearRequired');
    }
    setErrors(next);
    if (next.name || next.amount || next.academicYear || amountMinorUnits === undefined) {
      const firstInvalid = next.name
        ? 'structure-form-name'
        : next.amount
          ? 'structure-form-amount'
          : 'structure-form-year';
      // After React renders the messages, so the field is described when focused.
      requestAnimationFrame(() => document.getElementById(firstInvalid)?.focus());
      return;
    }

    // `MoneyInput` speaks integer minor units; the DTO's `amount` is
    // decimal taka. `minorUnitsToDecimalString` is the only supported
    // bridge between the two — never `parseFloat`/`toFixed`.
    const amount = Number(minorUnitsToDecimalString(amountMinorUnits, regionConfig));

    const shared = {
      fee_type: feeType,
      name: name.trim(),
      amount,
      class_id: classId !== '' ? classId : null,
      // `null`, not an omitted key, is what widens a section-scoped
      // structure back to the whole class — the server leaves the column
      // untouched for keys it doesn't receive.
      section_id: sectionId !== '' ? sectionId : null,
    };

    if (mode === 'create') {
      createStructure.mutate(
        { ...shared, academic_year_id: academicYearId },
        { onSuccess: onSaved },
      );
      return;
    }
    updateStructure.mutate(shared, { onSuccess: onSaved });
  }

  const isEdit = mode === 'edit';
  const title = isEdit ? t('form.editTitle') : t('form.createTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <div className="flex items-center gap-1">
              <DialogTitle>{title}</DialogTitle>
              {isEdit && <HelpHint helpId="finance.feeStructures.action.edit" />}
            </div>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="structure-form-name"
              label={t('form.nameLabel')}
              required
              requiredLabel={requiredLabel}
              error={errors.name}
              className="md:col-span-2"
            >
              <Input
                id="structure-form-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('form.namePlaceholder')}
                {...invalidProps('structure-form-name', errors.name)}
              />
            </Field>

            <Field
              id="structure-form-type"
              helpId="finance.feeStructures.field.feeType"
              label={t('form.feeTypeLabel')}
              required
              requiredLabel={requiredLabel}
            >
              <Select value={feeType} onValueChange={(value) => setFeeType(value as FeeType)}>
                <SelectTrigger id="structure-form-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(FeeType).map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`feeTypes.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              id="structure-form-amount"
              helpId="finance.feeStructures.field.amount"
              label={t('form.amountLabel')}
              required
              requiredLabel={requiredLabel}
              error={errors.amount}
            >
              <MoneyInput
                id="structure-form-amount"
                config={regionConfig}
                value={amountMinorUnits}
                onValueChange={setAmountMinorUnits}
                {...invalidProps('structure-form-amount', errors.amount)}
              />
            </Field>

            <Field
              id="structure-form-year"
              helpId="finance.feeStructures.field.academicYear"
              label={t('form.academicYearLabel')}
              required={!isEdit}
              requiredLabel={requiredLabel}
              error={errors.academicYear}
              className="md:col-span-2"
            >
              <Select value={academicYearId} onValueChange={setAcademicYearId} disabled={isEdit}>
                <SelectTrigger
                  id="structure-form-year"
                  disabled={isEdit}
                  {...invalidProps('structure-form-year', errors.academicYear)}
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
              {isEdit && (
                <p className="text-caption text-text-secondary">{t('form.academicYearLocked')}</p>
              )}
            </Field>

            <Field
              id="structure-form-class"
              label={t('form.classLabel')}
              helpId="finance.feeStructures.field.class"
            >
              <Select
                value={classId === '' ? NO_CLASS : classId}
                onValueChange={(value) => {
                  setClassId(value === NO_CLASS ? '' : value);
                  setSectionId('');
                }}
              >
                <SelectTrigger id="structure-form-class">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLASS}>{t('list.wholeSchool')}</SelectItem>
                  {classesQuery.data?.data.map((klass) => (
                    <SelectItem key={klass.id} value={klass.id}>
                      {klass.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field id="structure-form-section" label={t('form.sectionLabel')}>
              <Select
                value={sectionId === '' ? NO_SECTION : sectionId}
                onValueChange={(value) => setSectionId(value === NO_SECTION ? '' : value)}
                disabled={classId === ''}
              >
                <SelectTrigger id="structure-form-section" disabled={classId === ''}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SECTION}>{t('form.allSections')}</SelectItem>
                  {sectionsQuery.data?.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.section_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {mutation.isError && (
            <p role="alert" className="text-caption text-destructive">
              {t('form.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('form.saving') : t('form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
