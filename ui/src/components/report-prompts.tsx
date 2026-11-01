/**
 * [8.15.28] The questions a report asks before it runs ("Ask when running" in the glossary), and
 * the one-line summary that stands in for them once the answers are in.
 *
 * ```
 *  ২০২৬ · ৬ষ্ঠ শ্রেণি · সব শাখা · বদলান          <- PromptSummary (the collapsed line)
 *
 *  শিক্ষাবর্ষ   [ ২০২৬ v ]                             <- ReportPrompts (opened by the line)
 *  শ্রেণি       [ ৬ষ্ঠ শ্রেণি x ] [ সব শ্রেণি ]
 *  শাখা       [ সব শাখা ]   (only sections of the chosen classes)
 *                                   [ রিপোর্ট দেখান ]
 * ```
 *
 * The component is props-driven: it never fetches. The screen hands it the report's `parameters`,
 * the current `value`, and the school's classes, sections and years. Values are what the report
 * engine filters on, which for classes, sections and years is the **name** (the registry's `class`,
 * `section` and `academic_year` fields are text), not an id.
 *
 * What each parameter type becomes:
 *
 * | type          | control                      | value                       | default                      |
 * | ------------- | ---------------------------- | --------------------------- | ---------------------------- |
 * | ACADEMIC_YEAR | one choice                   | the year's name             | the current year             |
 * | CLASS         | pick several (none = all)    | list of class names         | none, which means all        |
 * | SECTION       | pick several, narrowed       | list of section names       | none, which means all        |
 * | DATE          | date picker                  | `YYYY-MM-DD`                | today                        |
 * | DATE_RANGE    | two date pickers             | `{ from, to }`              | this month                   |
 * | ENUM          | one choice                   | the option's value          | the first option if required |
 * | TEXT          | text box                     | the text                    | empty                        |
 *
 * A SECTION prompt only offers sections of the classes chosen in the prompt it depends on, and is
 * emptied when those classes change. A required prompt with no answer does not run: the message
 * sits beside the field, in plain words ("একটি শ্রেণি বেছে নিন"). Enter in any field runs the report.
 *
 * On a phone the opened prompts are a bottom sheet (`FilterSheet`): closing it with changes made
 * runs the report, like every other filter sheet in the app.
 *
 * Words come from `reports.json` `prompts.*` (the 8.15 glossary).
 */
import { PencilIcon } from 'lucide-react';
import * as React from 'react';

import { useLocale, useRegionConfig, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { formatDate, formatDateRange, parseDate, renderDigits, toIsoDate } from '../utils';

import { Button } from './button';
import { DatePicker } from './date-picker';
import { FilterSheet } from './filter-sheet';
import { HelpHint } from './help-hint';
import { Input } from './input';
import { Label } from './label';
import { MultiCombobox } from './multi-combobox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

/** The parameter shape of a report definition (`ReportParameter` in `@biddaloy/shared`), as the prompts read it. */
export interface PromptParameter {
  key: string;
  type: 'ACADEMIC_YEAR' | 'CLASS' | 'SECTION' | 'DATE' | 'DATE_RANGE' | 'ENUM' | 'TEXT';
  label_en: string;
  label_bn: string;
  required: boolean;
  default?: string | number | boolean | null | { from: string; to: string } | undefined;
  options?: { value: string; label_en: string; label_bn: string }[] | undefined;
  depends_on?: string | undefined;
}

export interface PromptDateRange {
  from: string;
  to: string;
}

/** One answer. A CLASS or SECTION answer is a list; an empty list means "all". */
export type PromptValue = string | string[] | PromptDateRange | undefined;
export type PromptValues = Record<string, PromptValue>;

/** The school's reference lists the prompts offer. */
export interface PromptChoices {
  /** Class names, in the order to show them. */
  classes: { name: string }[];
  /** Sections by name; `className` ties each to its class so a class choice can narrow them. */
  sections: { name: string; className: string }[];
  /** Academic years by name; the current one is the default. */
  academicYears: { name: string; isCurrent?: boolean }[];
}

export const NO_CHOICES: PromptChoices = { classes: [], sections: [], academicYears: [] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRange(value: unknown): value is PromptDateRange {
  const candidate = value as { from?: unknown; to?: unknown } | null | undefined;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.from === 'string' &&
    typeof candidate.to === 'string'
  );
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' && value !== '' ? [value] : [];
}

/** The first and last day of `today`'s month, as `YYYY-MM-DD`. */
function thisMonth(today: Date): PromptDateRange {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: toIsoDate(first), to: toIsoDate(last) };
}

/** The parameter a SECTION prompt narrows by: its `depends_on`, else the first CLASS prompt. */
function parentKey(parameter: PromptParameter, parameters: PromptParameter[]): string | undefined {
  if (parameter.type !== 'SECTION') return parameter.depends_on;
  return parameter.depends_on ?? parameters.find((p) => p.type === 'CLASS')?.key;
}

/**
 * What every prompt holds the moment the report opens (D22: the first thing a person sees is the
 * answer). A definition's own `default` wins; otherwise the year is the current one, class and
 * section are "all", a date is today and a range is this month.
 */
export function defaultPromptValues(
  parameters: PromptParameter[],
  choices: PromptChoices = NO_CHOICES,
  today: Date = new Date(),
): PromptValues {
  const values: PromptValues = {};
  for (const parameter of parameters) {
    const given = parameter.default;
    switch (parameter.type) {
      case 'ACADEMIC_YEAR': {
        const current = choices.academicYears.find((y) => y.isCurrent) ?? choices.academicYears[0];
        values[parameter.key] = typeof given === 'string' && given !== '' ? given : current?.name;
        break;
      }
      case 'CLASS':
      case 'SECTION':
        values[parameter.key] = asList(given);
        break;
      case 'DATE':
        values[parameter.key] =
          typeof given === 'string' && ISO_DATE.test(given) ? given : toIsoDate(today);
        break;
      case 'DATE_RANGE':
        values[parameter.key] = isRange(given)
          ? { from: given.from, to: given.to }
          : thisMonth(today);
        break;
      case 'ENUM':
        values[parameter.key] =
          typeof given === 'string' && given !== ''
            ? given
            : parameter.required
              ? parameter.options?.[0]?.value
              : undefined;
        break;
      case 'TEXT':
        values[parameter.key] = typeof given === 'string' ? given : undefined;
        break;
    }
  }
  return values;
}

/** True when a required prompt has no answer. Class and section need at least one name when required. */
function isUnanswered(parameter: PromptParameter, value: PromptValue): boolean {
  switch (parameter.type) {
    case 'CLASS':
    case 'SECTION':
      return asList(value).length === 0;
    case 'DATE_RANGE':
      return !isRange(value) || value.from === '' || value.to === '';
    default:
      return typeof value !== 'string' || value.trim() === '';
  }
}

/** Keys of the required prompts that still need an answer. Empty means the report can run. */
export function missingPrompts(parameters: PromptParameter[], values: PromptValues): string[] {
  return parameters.filter((p) => p.required && isUnanswered(p, values[p.key])).map((p) => p.key);
}

/** The answers as the report engine takes them: unanswered optional prompts are left out (the filter then does not apply). */
export function promptParams(
  parameters: PromptParameter[],
  values: PromptValues,
): Record<string, string | string[] | PromptDateRange> {
  const params: Record<string, string | string[] | PromptDateRange> = {};
  for (const parameter of parameters) {
    const value = values[parameter.key];
    if (isUnanswered(parameter, value)) continue;
    if (parameter.type === 'CLASS' || parameter.type === 'SECTION')
      params[parameter.key] = asList(value);
    else if (isRange(value)) params[parameter.key] = { from: value.from, to: value.to };
    else if (typeof value === 'string') params[parameter.key] = value;
  }
  return params;
}

/**
 * Turns anything read from the address bar into answers the prompts can show. A wrong type, an
 * unknown key or a malformed date is dropped (the prompt then falls back to its default), so a
 * hand-edited link never breaks the page.
 */
export function sanitizePromptValues(raw: unknown, parameters: PromptParameter[]): PromptValues {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const values: PromptValues = {};
  for (const parameter of parameters) {
    const value = source[parameter.key];
    if (value === undefined || value === null) continue;
    if (parameter.type === 'CLASS' || parameter.type === 'SECTION') {
      values[parameter.key] = asList(value);
    } else if (parameter.type === 'DATE_RANGE') {
      if (isRange(value) && ISO_DATE.test(value.from) && ISO_DATE.test(value.to)) {
        values[parameter.key] = { from: value.from, to: value.to };
      }
    } else if (parameter.type === 'DATE') {
      if (typeof value === 'string' && ISO_DATE.test(value)) values[parameter.key] = value;
    } else if (typeof value === 'string' || typeof value === 'number') {
      values[parameter.key] = String(value).slice(0, 200);
    }
  }
  return values;
}

/** Fills the blanks of `value` with the defaults, so a link that carries only some answers still has every one. */
export function withDefaults(
  parameters: PromptParameter[],
  value: PromptValues,
  choices: PromptChoices,
  today?: Date,
): PromptValues {
  const defaults = defaultPromptValues(parameters, choices, today);
  const merged: PromptValues = { ...defaults };
  for (const [key, answer] of Object.entries(value)) {
    if (answer !== undefined) merged[key] = answer;
  }
  return merged;
}

function useIsPhone(): boolean {
  const [phone, setPhone] = React.useState(
    () => typeof matchMedia === 'function' && matchMedia('(max-width: 767px)').matches,
  );
  React.useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(max-width: 767px)');
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return phone;
}

function useParameterLabel() {
  const { locale } = useLocale();
  return (p: { label_en: string; label_bn: string }) => (locale === 'bn' ? p.label_bn : p.label_en);
}

function safeDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  try {
    return parseDate(iso);
  } catch {
    return undefined;
  }
}

/** The sections a SECTION prompt offers: those of the chosen classes (all of them when none is chosen), each name once. */
function sectionOptions(choices: PromptChoices, classes: string[]): string[] {
  const inScope =
    classes.length === 0
      ? choices.sections
      : choices.sections.filter((s) => classes.includes(s.className));
  return [...new Set(inScope.map((s) => s.name))];
}

export interface ReportPromptsProps {
  parameters: PromptParameter[];
  value: PromptValues;
  onChange: (value: PromptValues) => void;
  /** Called when every required prompt is answered and the person asks for the report (button or Enter). */
  onRun: () => void;
  choices?: PromptChoices;
  /** Shown while the report is being fetched; the button is busy and a second run is ignored. */
  running?: boolean;
  /** Whether the prompts are showing. Closed, they render nothing: the summary line stands in. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A (?) after the Show report button (Epic 44). Desktop only: the phone sheet has no such button. */
  runHelpId?: string | undefined;
  className?: string;
}

export function ReportPrompts({
  parameters,
  value,
  onChange,
  onRun,
  choices = NO_CHOICES,
  running = false,
  open,
  onOpenChange,
  runHelpId,
  className,
}: ReportPromptsProps) {
  const { t } = useTranslation('reports');
  const regionConfig = useRegionConfig();
  const labelOf = useParameterLabel();
  const { locale } = useLocale();
  const phone = useIsPhone();
  const baseId = React.useId();
  const [attempted, setAttempted] = React.useState(false);
  const atOpen = React.useRef<string>('');
  const wasOpen = React.useRef(false);

  // What the prompts held when they opened, so closing the phone sheet knows whether anything changed.
  if (open && !wasOpen.current) atOpen.current = JSON.stringify(value);
  wasOpen.current = open;

  const missing = missingPrompts(parameters, value);

  function set(parameter: PromptParameter, next: PromptValue) {
    const updated: PromptValues = { ...value, [parameter.key]: next };
    // A class change empties every prompt narrowed by it (and, in turn, what narrows by those).
    const queue = [parameter.key];
    while (queue.length > 0) {
      const changed = queue.shift();
      for (const dependent of parameters) {
        if (parentKey(dependent, parameters) === changed && dependent.key !== changed) {
          updated[dependent.key] = [];
          queue.push(dependent.key);
        }
      }
    }
    onChange(updated);
  }

  function run() {
    if (running) return;
    if (missing.length > 0) {
      setAttempted(true);
      document.getElementById(`${baseId}-${missing[0]}`)?.focus();
      return;
    }
    setAttempted(false);
    onRun();
  }

  function onSheetOpenChange(next: boolean) {
    if (next) return onOpenChange(true);
    if (JSON.stringify(value) === atOpen.current) return onOpenChange(false);
    run();
  }

  function reset() {
    onChange(defaultPromptValues(parameters, choices));
    setAttempted(false);
  }

  function error(parameter: PromptParameter): string | undefined {
    if (!attempted || !missing.includes(parameter.key)) return undefined;
    return t(`prompts.missing.${parameter.type}`);
  }

  function field(parameter: PromptParameter) {
    const id = `${baseId}-${parameter.key}`;
    const message = error(parameter);
    const label = labelOf(parameter);
    const common = {
      id,
      'aria-label': label,
      'aria-invalid': message ? true : undefined,
      'aria-describedby': message ? `${id}-error` : undefined,
    } as const;
    const current = value[parameter.key];
    let control: React.ReactNode;
    switch (parameter.type) {
      case 'ACADEMIC_YEAR':
        control = (
          <Select
            value={typeof current === 'string' ? current : ''}
            onValueChange={(next) => set(parameter, next)}
          >
            <SelectTrigger {...common} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.academicYears.map((year) => (
                <SelectItem key={year.name} value={year.name}>
                  {renderDigits(year.name, regionConfig.numerals)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
        break;
      case 'CLASS':
        control = (
          <MultiCombobox
            {...common}
            options={choices.classes.map((c) => ({ value: c.name, label: c.name }))}
            value={asList(current)}
            onValueChange={(next) => set(parameter, next)}
            placeholder={t('prompts.allClasses')}
            className="w-full"
          />
        );
        break;
      case 'SECTION': {
        const parent = parentKey(parameter, parameters);
        const classes = parent ? asList(value[parent]) : [];
        control = (
          <MultiCombobox
            {...common}
            options={sectionOptions(choices, classes).map((name) => ({ value: name, label: name }))}
            value={asList(current)}
            onValueChange={(next) => set(parameter, next)}
            placeholder={t('prompts.allSections')}
            className="w-full"
          />
        );
        break;
      }
      case 'DATE':
        control = (
          <DatePicker
            {...common}
            config={regionConfig}
            value={safeDate(typeof current === 'string' ? current : undefined)}
            onValueChange={(date) => set(parameter, date ? toIsoDate(date) : undefined)}
            clearable={!parameter.required}
            className="w-full"
          />
        );
        break;
      case 'DATE_RANGE': {
        const range = isRange(current) ? current : { from: '', to: '' };
        control = (
          <div className="grid gap-2 sm:grid-cols-2">
            <DatePicker
              {...common}
              aria-label={`${label} — ${t('prompts.from')}`}
              config={regionConfig}
              value={safeDate(range.from)}
              onValueChange={(date) =>
                set(parameter, { from: date ? toIsoDate(date) : '', to: range.to })
              }
              clearable={false}
              max={safeDate(range.to)}
              placeholder={t('prompts.from')}
              className="w-full"
            />
            <DatePicker
              aria-label={`${label} — ${t('prompts.to')}`}
              config={regionConfig}
              value={safeDate(range.to)}
              onValueChange={(date) =>
                set(parameter, { from: range.from, to: date ? toIsoDate(date) : '' })
              }
              clearable={false}
              min={safeDate(range.from)}
              placeholder={t('prompts.to')}
              className="w-full"
            />
          </div>
        );
        break;
      }
      case 'ENUM':
        control = (
          <Select
            value={typeof current === 'string' ? current : ''}
            onValueChange={(next) => set(parameter, next)}
          >
            <SelectTrigger {...common} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(parameter.options ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {locale === 'bn' ? option.label_bn : option.label_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
        break;
      case 'TEXT':
        control = (
          <Input
            {...common}
            value={typeof current === 'string' ? current : ''}
            onChange={(event) => set(parameter, event.target.value)}
            className="w-full"
          />
        );
        break;
    }
    return (
      <div key={parameter.key} className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={id}>
          {label}
          {parameter.required && (
            <>
              <span aria-hidden="true" className="text-destructive">
                {' *'}
              </span>
              <span className="sr-only"> ({t('prompts.required')})</span>
            </>
          )}
        </Label>
        {control}
        {message && (
          <p id={`${id}-error`} className="text-sm text-destructive">
            {message}
          </p>
        )}
      </div>
    );
  }

  if (!open) return null;

  const fields = parameters.map(field);
  const form = (children: React.ReactNode, footer: React.ReactNode) => (
    <form
      aria-label={t('prompts.title')}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        run();
      }}
      className={cn('flex flex-col gap-4', className)}
    >
      {children}
      {footer}
    </form>
  );

  if (phone) {
    return (
      <FilterSheet
        open
        onOpenChange={onSheetOpenChange}
        title={t('prompts.title')}
        onClearAll={reset}
      >
        {form(fields, <button type="submit" hidden aria-hidden="true" tabIndex={-1} />)}
      </FilterSheet>
    );
  }

  return form(
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields}</div>,
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" loading={running}>
        {t('prompts.run')}
      </Button>
      {runHelpId !== undefined && <HelpHint helpId={runHelpId} />}
      <Button type="button" variant="ghost" onClick={reset}>
        {t('prompts.reset')}
      </Button>
    </div>,
  );
}

/** The answers in plain words, one part each: "২০২৬", "৬ষ্ঠ শ্রেণি", "সব শাখা". */
export function promptSummaryParts(
  parameters: PromptParameter[],
  value: PromptValues,
  t: (key: string) => string,
  config: ReturnType<typeof useRegionConfig>,
  labelOf: (option: { label_en: string; label_bn: string }) => string,
): string[] {
  const parts: string[] = [];
  for (const parameter of parameters) {
    const answer = value[parameter.key];
    switch (parameter.type) {
      case 'ACADEMIC_YEAR':
        if (typeof answer === 'string' && answer !== '') {
          parts.push(renderDigits(answer, config.numerals));
        }
        break;
      case 'CLASS': {
        const list = asList(answer);
        parts.push(list.length === 0 ? t('prompts.allClasses') : list.join(', '));
        break;
      }
      case 'SECTION': {
        const list = asList(answer);
        parts.push(list.length === 0 ? t('prompts.allSections') : list.join(', '));
        break;
      }
      case 'DATE':
        if (typeof answer === 'string' && answer !== '') parts.push(formatDate(answer, config));
        break;
      case 'DATE_RANGE':
        if (isRange(answer) && answer.from !== '' && answer.to !== '') {
          parts.push(formatDateRange(answer.from, answer.to, config));
        }
        break;
      case 'ENUM': {
        const option = parameter.options?.find((o) => o.value === answer);
        if (option) parts.push(labelOf(option));
        break;
      }
      case 'TEXT':
        if (typeof answer === 'string' && answer.trim() !== '') parts.push(answer.trim());
        break;
    }
  }
  return parts;
}

export interface PromptSummaryProps {
  parameters: PromptParameter[];
  value: PromptValues;
  /** Whether the full prompts are showing; the line reports it to assistive technology. */
  expanded: boolean;
  /** Opens the full prompts (or closes them, when they are already open). */
  onToggle: () => void;
  className?: string;
}

/** The collapsed line above a result. Click or press Enter to change the answers. */
export function PromptSummary({
  parameters,
  value,
  expanded,
  onToggle,
  className,
}: PromptSummaryProps) {
  const { t } = useTranslation('reports');
  const config = useRegionConfig();
  const labelOf = useParameterLabel();
  const parts = promptSummaryParts(parameters, value, t, config, labelOf);
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        'flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-surface px-3 py-2 text-start text-body text-text-primary hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-8',
        className,
      )}
    >
      {parts.map((part, index) => (
        <React.Fragment key={`${index}-${part}`}>
          {index > 0 && (
            <span aria-hidden="true" className="text-text-secondary">
              ·
            </span>
          )}
          <span>{part}</span>
        </React.Fragment>
      ))}
      {parts.length > 0 && (
        <span aria-hidden="true" className="text-text-secondary">
          ·
        </span>
      )}
      <span className="inline-flex items-center gap-1 font-medium text-primary">
        <PencilIcon aria-hidden="true" className="size-4" />
        {t('prompts.change')}
      </span>
    </button>
  );
}
