/**
 * One text, two languages: bn first, en beside it (stacked on a phone). Only bn is required;
 * an empty en keeps `{ bn, en: '' }` and the site falls back to bn (D8, D25).
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { Input } from './input';
import { Textarea } from './textarea';

export interface BilingualValue {
  bn: string;
  en: string;
}

export interface BilingualFieldProps {
  label: string;
  value: BilingualValue;
  onChange: (value: BilingualValue) => void;
  multiline?: boolean;
  required?: boolean;
  /** Shown under the en column. */
  enHint?: string;
  className?: string;
}

export function BilingualField({
  label,
  value,
  onChange,
  multiline,
  required,
  enHint = 'ঐচ্ছিক, খালি রাখলে বাংলা দেখাবে',
  className,
}: BilingualFieldProps) {
  const id = React.useId();
  const Control = multiline ? Textarea : Input;
  const col = (lang: 'bn' | 'en', name: string, isRequired: boolean) => (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`${id}-${lang}`} className="text-sm font-medium">
        {`${label} (${name})`}
        {isRequired && <span aria-hidden="true"> *</span>}
      </label>
      <Control
        id={`${id}-${lang}`}
        lang={lang}
        value={value[lang]}
        required={isRequired}
        aria-describedby={lang === 'en' ? `${id}-hint` : undefined}
        onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
      />
      {lang === 'en' && (
        <p id={`${id}-hint`} className="text-caption text-text-secondary">
          {enHint}
        </p>
      )}
    </div>
  );
  return (
    <div
      data-slot="bilingual-field"
      className={cn('grid grid-cols-1 gap-3 md:grid-cols-2', className)}
    >
      {col('bn', 'বাংলা', !!required)}
      {col('en', 'English', false)}
    </div>
  );
}
