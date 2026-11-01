/**
 * [8.15.39] Edits one question a report asks when it runs ("Ask when running" in the glossary). It
 * edits one entry of a definition's `parameters` (`ReportParameter` in `@biddaloy/shared`), the
 * same shape `ReportPrompts` ([8.15.28]) reads, so what is set here is exactly what the person
 * running the report is asked.
 *
 * ```
 *  শ্রেণি                                   <- the kind of answer (read-only)
 *  প্রশ্ন (বাংলায়)     [ শ্রেণি            ]
 *  প্রশ্ন (ইংরেজিতে)   [ Class             ]
 *  [x] উত্তর দেওয়া আবশ্যক
 *  শুরুতে যা ধরা থাকবে  [ ৬ষ্ঠ শ্রেণি       ]
 * ```
 *
 * Props only. `FilterBuilder` shows one of these under a condition whose "Ask when running"
 * switch is on. `siblings` are the report's other questions, so a section question can say which
 * class question narrows it.
 */
import type { ReportParameter } from '@biddaloy/shared';
import * as React from 'react';

import { useLocale, useRegionConfig } from '../../i18n';
import { cn } from '../../primitives/lib/utils';
import { parseDate, toIsoDate } from '../../utils';
import { Checkbox } from '../checkbox';
import { DatePicker } from '../date-picker';
import { Input } from '../input';
import { Label } from '../label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';

export interface ParamEditorLabels {
  title: string;
  labelBn: string;
  labelEn: string;
  required: string;
  startsAs: string;
  /** The choice that leaves a starting answer empty. */
  noDefault: string;
  from: string;
  to: string;
  dependsOn: string;
  dependsNone: string;
  types: Record<ReportParameter['type'], string>;
}

export interface ParamEditorProps {
  parameter: ReportParameter;
  onChange: (parameter: ReportParameter) => void;
  /** The report's other questions. */
  siblings?: ReportParameter[];
  labels: ParamEditorLabels;
  className?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NONE = '__none__';

function safeDate(iso: unknown): Date | undefined {
  if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return undefined;
  try {
    return parseDate(iso);
  } catch {
    return undefined;
  }
}

function isRange(value: unknown): value is { from: string; to: string } {
  const range = value as { from?: unknown; to?: unknown } | null | undefined;
  return typeof range === 'object' && range !== null && typeof range.from === 'string';
}

/** `parameter` with `default` set, or removed when `next` is empty (the type allows no `undefined` value). */
function withDefault(
  parameter: ReportParameter,
  next: ReportParameter['default'],
): ReportParameter {
  const copy = { ...parameter };
  delete copy.default;
  return next === undefined || next === '' ? copy : { ...copy, default: next };
}

export function ParamEditor({
  parameter,
  onChange,
  siblings = [],
  labels,
  className,
}: ParamEditorProps) {
  const { locale } = useLocale();
  const config = useRegionConfig();
  const baseId = React.useId();
  const id = (part: string) => `${baseId}-${part}`;
  const range = isRange(parameter.default) ? parameter.default : { from: '', to: '' };
  const others = siblings.filter((p) => p.key !== parameter.key);

  function dependsOn(next: string) {
    const copy = { ...parameter };
    delete copy.depends_on;
    onChange(next === NONE ? copy : { ...copy, depends_on: next });
  }

  let startsAs: React.ReactNode;
  switch (parameter.type) {
    case 'ENUM':
      startsAs = (
        <Select
          value={typeof parameter.default === 'string' ? parameter.default : NONE}
          onValueChange={(next) =>
            onChange(withDefault(parameter, next === NONE ? undefined : next))
          }
        >
          <SelectTrigger id={id('default')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{labels.noDefault}</SelectItem>
            {(parameter.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {locale === 'bn' ? option.label_bn : option.label_en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'DATE':
      startsAs = (
        <DatePicker
          id={id('default')}
          aria-label={labels.startsAs}
          config={config}
          value={safeDate(parameter.default)}
          onValueChange={(date) =>
            onChange(withDefault(parameter, date ? toIsoDate(date) : undefined))
          }
          className="w-full"
        />
      );
      break;
    case 'DATE_RANGE':
      startsAs = (
        <div className="grid gap-2 sm:grid-cols-2">
          <DatePicker
            id={id('default')}
            aria-label={`${labels.startsAs}: ${labels.from}`}
            config={config}
            value={safeDate(range.from)}
            onValueChange={(date) =>
              onChange(withDefault(parameter, { from: date ? toIsoDate(date) : '', to: range.to }))
            }
            clearable={false}
            className="w-full"
          />
          <DatePicker
            aria-label={`${labels.startsAs}: ${labels.to}`}
            config={config}
            value={safeDate(range.to)}
            min={safeDate(range.from)}
            onValueChange={(date) =>
              onChange(
                withDefault(parameter, { from: range.from, to: date ? toIsoDate(date) : '' }),
              )
            }
            clearable={false}
            className="w-full"
          />
        </div>
      );
      break;
    default:
      startsAs = (
        <Input
          id={id('default')}
          value={typeof parameter.default === 'string' ? parameter.default : ''}
          onChange={(event) => onChange(withDefault(parameter, event.target.value))}
        />
      );
  }

  return (
    <div
      role="group"
      aria-label={`${labels.title}: ${locale === 'bn' ? parameter.label_bn : parameter.label_en}`}
      className={cn('flex flex-col gap-3 rounded-lg border border-border bg-muted p-3', className)}
    >
      <p className="text-label font-medium text-text-secondary">{labels.types[parameter.type]}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('bn')}>{labels.labelBn}</Label>
          <Input
            id={id('bn')}
            value={parameter.label_bn}
            onChange={(event) => onChange({ ...parameter, label_bn: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('en')}>{labels.labelEn}</Label>
          <Input
            id={id('en')}
            value={parameter.label_en}
            onChange={(event) => onChange({ ...parameter, label_en: event.target.value })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={id('required')}
          checked={parameter.required}
          onCheckedChange={(checked) => onChange({ ...parameter, required: checked === true })}
        />
        <Label htmlFor={id('required')}>{labels.required}</Label>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id('default')}>{labels.startsAs}</Label>
        {startsAs}
      </div>
      {parameter.type === 'SECTION' && others.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('depends')}>{labels.dependsOn}</Label>
          <Select value={parameter.depends_on ?? NONE} onValueChange={dependsOn}>
            <SelectTrigger id={id('depends')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{labels.dependsNone}</SelectItem>
              {others.map((other) => (
                <SelectItem key={other.key} value={other.key}>
                  {locale === 'bn' ? other.label_bn : other.label_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
