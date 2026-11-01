/**
 * [27.9] Shared create/edit body for an `admission_intakes` row — used by
 * both the create dialog (`IntakeList`) and the edit page (`$intakeId`).
 */
import { AdmissionDocumentType } from '@biddaloy/shared';
import {
  Checkbox,
  DatePicker,
  HelpHint,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseServerDate, toIsoDate } from '@biddaloy/ui/utils';
import { CircleAlertIcon } from 'lucide-react';
import type * as React from 'react';

import { ALL_DOCUMENT_TYPES, useClassSectionOptions, type IntakeInput } from './hooks/useIntakes';

export interface IntakeFormValue {
  title: string;
  class_section_id: string;
  seat_count: string;
  open_date: string;
  close_date: string;
  required_document_types: AdmissionDocumentType[];
}

export const EMPTY_INTAKE_FORM: IntakeFormValue = {
  title: '',
  class_section_id: '',
  seat_count: '',
  open_date: '',
  close_date: '',
  required_document_types: [],
};

export function toIntakeInput(value: IntakeFormValue): IntakeInput {
  return {
    title: value.title.trim(),
    class_section_id: value.class_section_id,
    seat_count: Number(value.seat_count),
    open_date: value.open_date,
    close_date: value.close_date,
    required_document_types: value.required_document_types,
  };
}

export function isIntakeFormValid(value: IntakeFormValue): boolean {
  return (
    value.title.trim().length > 0 &&
    value.class_section_id.length > 0 &&
    Number(value.seat_count) > 0 &&
    value.open_date.length > 0 &&
    value.close_date.length > 0 &&
    value.open_date <= value.close_date
  );
}

const DOCUMENT_TYPE_LABEL_KEY: Record<AdmissionDocumentType, string> = {
  [AdmissionDocumentType.PHOTO]: 'form.documentPhoto',
  [AdmissionDocumentType.BIRTH_CERTIFICATE]: 'form.documentBirthCertificate',
  [AdmissionDocumentType.TRANSCRIPT]: 'form.documentTranscript',
};

/** Label + a visible required mark (the star is decorative, the word is for screen readers). */
function RequiredLabel({
  htmlFor,
  helpId,
  children,
}: {
  htmlFor?: string;
  /** A (?) after the label; a sibling, so clicking the label still focuses the field. */
  helpId?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('admission-staff-intakes');
  return (
    <Label
      htmlFor={htmlFor}
      helpId={helpId}
      helpLabel={typeof children === 'string' ? children : undefined}
    >
      {children}
      <span className="text-destructive" aria-hidden="true">
        {' *'}
      </span>
      <span className="sr-only">{t('form.required', { ns: 'common' })}</span>
    </Label>
  );
}

export function IntakeForm({
  value,
  onChange,
}: {
  value: IntakeFormValue;
  onChange: (value: IntakeFormValue) => void;
}) {
  const { t } = useTranslation('admission-staff-intakes');
  const regionConfig = useRegionConfig();
  const { options: sectionOptions } = useClassSectionOptions();
  const rangeInvalid =
    value.open_date.length > 0 && value.close_date.length > 0 && value.open_date > value.close_date;

  function toggleDocumentType(type: AdmissionDocumentType, checked: boolean) {
    onChange({
      ...value,
      required_document_types: checked
        ? [...value.required_document_types, type]
        : value.required_document_types.filter((existing) => existing !== type),
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-1.5 md:col-span-2">
        <RequiredLabel htmlFor="intake-title">{t('form.titleLabel')}</RequiredLabel>
        <Input
          id="intake-title"
          value={value.title}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <RequiredLabel
          htmlFor="intake-class-section"
          helpId="people.admissionIntakes.field.classSection"
        >
          {t('form.classSectionLabel')}
        </RequiredLabel>
        <Select
          value={value.class_section_id}
          onValueChange={(next) => onChange({ ...value, class_section_id: next })}
        >
          <SelectTrigger id="intake-class-section">
            <SelectValue placeholder={t('form.selectPlaceholder', { ns: 'common' })} />
          </SelectTrigger>
          <SelectContent>
            {sectionOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.className} · {option.sectionName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <RequiredLabel htmlFor="intake-seat-count" helpId="people.admissionIntakes.field.seatCount">
          {t('form.seatCountLabel')}
        </RequiredLabel>
        <Input
          id="intake-seat-count"
          type="number"
          inputMode="numeric"
          min={1}
          value={value.seat_count}
          onChange={(event) => onChange({ ...value, seat_count: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <RequiredLabel htmlFor="intake-open-date" helpId="people.admissionIntakes.field.dates">
          {t('form.openDateLabel')}
        </RequiredLabel>
        <DatePicker
          id="intake-open-date"
          aria-label={t('form.openDateLabel')}
          config={regionConfig}
          value={value.open_date ? parseServerDate(value.open_date) : undefined}
          onValueChange={(d) => onChange({ ...value, open_date: d ? toIsoDate(d) : '' })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <RequiredLabel htmlFor="intake-close-date">{t('form.closeDateLabel')}</RequiredLabel>
        <DatePicker
          id="intake-close-date"
          aria-label={t('form.closeDateLabel')}
          aria-invalid={rangeInvalid}
          config={regionConfig}
          value={value.close_date ? parseServerDate(value.close_date) : undefined}
          onValueChange={(d) => onChange({ ...value, close_date: d ? toIsoDate(d) : '' })}
        />
        {rangeInvalid && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
            {t('form.dateRangeError')}
          </p>
        )}
      </div>
      <p className="text-caption text-text-secondary md:col-span-2">{t('form.datesHelp')}</p>

      {/* The name is set here so the (?) inside the legend stays out of it. */}
      <fieldset
        className="flex flex-col gap-1.5 md:col-span-2"
        aria-label={t('form.requiredDocumentsLabel')}
      >
        <legend className="flex items-center gap-1 text-label">
          {t('form.requiredDocumentsLabel')}
          <HelpHint
            helpId="people.admissionIntakes.field.requiredDocuments"
            label={t('form.requiredDocumentsLabel')}
          />
        </legend>
        <p className="text-caption text-text-secondary">{t('form.documentsHelp')}</p>
        {ALL_DOCUMENT_TYPES.map((type) => (
          <label key={type} className="flex min-h-11 items-center gap-3 md:min-h-8">
            <Checkbox
              checked={value.required_document_types.includes(type)}
              onCheckedChange={(checked) => toggleDocumentType(type, checked === true)}
            />
            {t(DOCUMENT_TYPE_LABEL_KEY[type])}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
