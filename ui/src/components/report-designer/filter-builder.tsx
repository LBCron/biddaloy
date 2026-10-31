/**
 * [8.15.39] "Only those who…": filters written as sentences, not as a grid of operators.
 *
 * ```
 *  শুধু যাদের…
 *   [ শ্রেণি v ] [ হলো v ] [ ৬ষ্ঠ শ্রেণি, ৭ম শ্রেণি ]    [ ] চালানোর সময় জিজ্ঞেস করবেন   (x)
 *   [ বকেয়া v ] [ বেশি v ] [ ৫,০০০ ]                    [x] চালানোর সময় জিজ্ঞেস করবেন   (x)
 *       └─ the switch turns the value into a question, edited right below by `ParamEditor`
 *   + আরেকটি শর্ত যোগ করুন
 * ```
 *
 * The words after the field follow the field's type, and only these five exist:
 *
 * | field type                 | words                           |
 * | -------------------------- | ------------------------------- |
 * | text, choice from a list   | হলো, নয়                        |
 * | yes / no                   | হলো                             |
 * | number, money, percent     | হলো, নয়, বেশি, কম, মধ্যে       |
 * | date                       | হলো, মধ্যে                      |
 *
 * Under the words sit the engine's operators: "হলো" with several values is `IN`, "নয়" with
 * several is `NOT_IN`, "বেশি" is `GT`, "কম" is `LT`, "মধ্যে" is `BETWEEN`.
 *
 * Props only. The result is the definition's `dataset.filters`, plus `parameters` when a condition
 * is turned into a question (`{ param: key }` as its value), so one `onChange` carries both and a
 * parent that keeps them in one object never overwrites one with the other. `ConditionEditor` is
 * the same sentence on its own; `FormatRulesEditor` reuses it.
 */
import type { FilterOp, ReportFilter, ReportFilterValue, ReportParameter } from '@biddaloy/shared';
import { Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

import { useLocale, useRegionConfig } from '../../i18n';
import { cn } from '../../primitives/lib/utils';
import { parseDate, toIsoDate } from '../../utils';
import { renderDigits } from '../../utils/digits';
import { parseNumber } from '../../utils/number';
import { Button } from '../button';
import { DatePicker } from '../date-picker';
import { Input } from '../input';
import { Label } from '../label';
import { MultiCombobox } from '../multi-combobox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';
import { Switch } from '../switch';

import { useFieldLabel, type DesignerField } from './field-picker';
import { ParamEditor, type ParamEditorLabels } from './param-editor';

export type OpWord = 'is' | 'isNot' | 'more' | 'less' | 'between';

export interface ConditionLabels {
  field: string;
  pickField: string;
  op: string;
  value: string;
  from: string;
  to: string;
  and: string;
  yes: string;
  no: string;
  textHint: string;
  pickValues: string;
  notANumber: string;
  ops: Record<OpWord, string>;
}

export interface FilterBuilderLabels extends ConditionLabels {
  title: string;
  add: string;
  remove: string;
  empty: string;
  ask: string;
  params: ParamEditorLabels;
}

/** How a choice-from-a-list value reads in each language (`ENUM` values are constants, never shown as they are). */
export type EnumLabel = (fieldKey: string, value: string) => { label_en: string; label_bn: string };

const RAW_ENUM: EnumLabel = (_field, value) => ({ label_en: value, label_bn: value });

/** The words a field of this type offers, in the order shown. */
export function opWordsFor(type: DesignerField['type']): OpWord[] {
  switch (type) {
    case 'NUMBER':
    case 'MONEY':
    case 'PERCENT':
      return ['is', 'isNot', 'more', 'less', 'between'];
    case 'DATE':
      return ['is', 'between'];
    case 'BOOLEAN':
      return ['is'];
    default:
      return ['is', 'isNot'];
  }
}

/** The word an operator is shown as. An operator with no word here (`CONTAINS`, `IS_NULL`…) shows as "হলো". */
export function opWordOf(op: FilterOp): OpWord {
  switch (op) {
    case 'NEQ':
    case 'NOT_IN':
      return 'isNot';
    case 'GT':
    case 'GTE':
      return 'more';
    case 'LT':
    case 'LTE':
      return 'less';
    case 'BETWEEN':
      return 'between';
    default:
      return 'is';
  }
}

/** The operator for a word and a value: several values turn "হলো" into `IN` and "নয়" into `NOT_IN`. */
export function filterOpFor(word: OpWord, value: ReportFilterValue | undefined): FilterOp {
  const several = Array.isArray(value) && value.length > 1;
  switch (word) {
    case 'is':
      return several ? 'IN' : 'EQ';
    case 'isNot':
      return several ? 'NOT_IN' : 'NEQ';
    case 'more':
      return 'GT';
    case 'less':
      return 'LT';
    case 'between':
      return 'BETWEEN';
  }
}

function isParamRef(value: unknown): value is { param: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'param' in value;
}

/** The condition's value as a list (a text or list value), whatever shape it was stored in. */
function asList(value: ReportFilterValue | undefined): (string | number)[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' || typeof value === 'number' ? [value] : [];
}

/** A list of one is stored as that one value, so `EQ` and `NEQ` never carry an array. */
function fromList(list: (string | number)[]): ReportFilterValue | undefined {
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0]! : list;
}

function safeDate(iso: unknown): Date | undefined {
  if (typeof iso !== 'string') return undefined;
  try {
    return parseDate(iso);
  } catch {
    return undefined;
  }
}

/** A number box that keeps what is typed (so "1." survives) and says so beside the box when it is not a number. */
function NumberBox({
  value,
  onChange,
  label,
  error,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  label: string;
  error: string;
}) {
  const config = useRegionConfig();
  const [draft, setDraft] = React.useState(() =>
    value === undefined ? '' : renderDigits(String(value), config.numerals),
  );
  const errorId = React.useId();
  const invalid = (() => {
    if (draft.trim() === '') return false;
    try {
      parseNumber(draft);
      return false;
    } catch {
      return true;
    }
  })();
  return (
    <span className="inline-flex flex-col gap-1">
      <Input
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        value={draft}
        className="w-32"
        onChange={(event) => {
          setDraft(event.target.value);
          try {
            onChange(
              event.target.value.trim() === '' ? undefined : parseNumber(event.target.value),
            );
          } catch {
            // Not a number yet: the message below says so, the stored value is unchanged.
          }
        }}
      />
      {invalid && (
        <span id={errorId} className="text-caption text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}

/** Two number boxes. A half-filled range is kept here, and only a complete one is passed on. */
function NumberRange({
  value,
  onChange,
  labels,
}: {
  value: ReportFilterValue | undefined;
  onChange: (value: ReportFilterValue | undefined) => void;
  labels: ConditionLabels;
}) {
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const [pair, setPair] = React.useState<[number | undefined, number | undefined]>(() =>
    Array.isArray(value) ? [num(value[0]), num(value[1])] : [undefined, undefined],
  );
  function set(next: [number | undefined, number | undefined]) {
    setPair(next);
    onChange(next[0] !== undefined && next[1] !== undefined ? [next[0], next[1]] : undefined);
  }
  return (
    <span className="inline-flex flex-wrap items-start gap-2">
      <NumberBox
        label={labels.from}
        error={labels.notANumber}
        value={pair[0]}
        onChange={(from) => set([from, pair[1]])}
      />
      <span className="pt-1.5 text-body text-text-secondary">{labels.and}</span>
      <NumberBox
        label={labels.to}
        error={labels.notANumber}
        value={pair[1]}
        onChange={(to) => set([pair[0], to])}
      />
    </span>
  );
}

function TextListBox({
  value,
  onChange,
  label,
  hint,
}: {
  value: (string | number)[];
  onChange: (list: string[]) => void;
  label: string;
  hint: string;
}) {
  const [draft, setDraft] = React.useState(() => value.join(', '));
  return (
    <Input
      aria-label={label}
      placeholder={hint}
      value={draft}
      className="w-56"
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(
          event.target.value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

interface ValueEditorProps {
  field: DesignerField;
  word: OpWord;
  value: ReportFilterValue | undefined;
  onChange: (value: ReportFilterValue | undefined) => void;
  labels: ConditionLabels;
  enumLabel: EnumLabel;
}

function ValueEditor({ field, word, value, onChange, labels, enumLabel }: ValueEditorProps) {
  const config = useRegionConfig();
  const { locale } = useLocale();

  if (field.type === 'BOOLEAN') {
    return (
      <Select
        value={typeof value === 'boolean' ? String(value) : ''}
        onValueChange={(next) => onChange(next === 'true')}
      >
        <SelectTrigger aria-label={labels.value} className="w-28">
          <SelectValue placeholder={labels.pickField} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{labels.yes}</SelectItem>
          <SelectItem value="false">{labels.no}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'ENUM') {
    const options = (field.enum_values ?? []).map((v) => {
      const names = enumLabel(field.key, v);
      return { value: v, label: locale === 'bn' ? names.label_bn : names.label_en };
    });
    return (
      <MultiCombobox
        aria-label={labels.value}
        placeholder={labels.pickValues}
        options={options}
        value={asList(value).map(String)}
        onValueChange={(list) => onChange(fromList(list))}
        className="w-64"
      />
    );
  }

  if (field.type === 'DATE') {
    const [from, to] = asList(value);
    if (word === 'between') {
      const text = (v: string | number | undefined) => (v === undefined ? '' : String(v));
      const pair = (
        a: string | number | undefined,
        b: string | number | undefined,
      ): ReportFilterValue => [text(a), text(b)];
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          <DatePicker
            aria-label={labels.from}
            config={config}
            value={safeDate(from)}
            onValueChange={(d) => onChange(pair(d ? toIsoDate(d) : '', to))}
            clearable={false}
          />
          <span className="text-body text-text-secondary">{labels.and}</span>
          <DatePicker
            aria-label={labels.to}
            config={config}
            value={safeDate(to)}
            min={safeDate(from)}
            onValueChange={(d) => onChange(pair(from, d ? toIsoDate(d) : ''))}
            clearable={false}
          />
        </span>
      );
    }
    return (
      <DatePicker
        aria-label={labels.value}
        config={config}
        value={safeDate(from)}
        onValueChange={(d) => onChange(d ? toIsoDate(d) : undefined)}
      />
    );
  }

  if (field.type === 'NUMBER' || field.type === 'MONEY' || field.type === 'PERCENT') {
    if (word === 'between')
      return <NumberRange value={value} onChange={onChange} labels={labels} />;
    return (
      <NumberBox
        label={labels.value}
        error={labels.notANumber}
        value={typeof value === 'number' ? value : undefined}
        onChange={(n) => onChange(n)}
      />
    );
  }

  return (
    <TextListBox
      label={labels.value}
      hint={labels.textHint}
      value={asList(value)}
      onChange={(list) => onChange(fromList(list))}
    />
  );
}

export interface ConditionEditorProps {
  condition: ReportFilter;
  fields: DesignerField[];
  onChange: (condition: ReportFilter) => void;
  labels: ConditionLabels;
  enumLabel?: EnumLabel;
  /** Words before the sentence ("যদি"). */
  lead?: React.ReactNode;
  /** Words after the value ("হয়"). */
  trail?: React.ReactNode;
  /** True when the value is a question asked at run time: the value box gives way to nothing. */
  asked?: boolean;
  className?: string;
}

/** One sentence: `[field] [word] [value]`. Choosing another field starts the sentence over. */
export function ConditionEditor({
  condition,
  fields,
  onChange,
  labels,
  enumLabel = RAW_ENUM,
  lead,
  trail,
  asked = false,
  className,
}: ConditionEditorProps) {
  const labelOf = useFieldLabel();
  const field = fields.find((f) => f.key === condition.field);
  const words = field ? opWordsFor(field.type) : [];
  const word = opWordOf(condition.op);

  function pickField(key: string) {
    const next = fields.find((f) => f.key === key);
    if (!next) return;
    if (field && field.type === next.type) return onChange({ ...condition, field: key });
    onChange({ field: key, op: 'EQ' });
  }

  function pickWord(next: OpWord) {
    // A value carries over between words unless one of them is "between", which takes two values.
    const keeps = isParamRef(condition.value) || (word !== 'between' && next !== 'between');
    const value = keeps ? condition.value : undefined;
    onChange({
      field: condition.field,
      op: filterOpFor(next, value),
      ...(value === undefined ? {} : { value }),
    });
  }

  function pickValue(value: ReportFilterValue | undefined) {
    onChange({
      field: condition.field,
      op: filterOpFor(word, value),
      ...(value === undefined ? {} : { value }),
    });
  }

  return (
    <div className={cn('flex flex-wrap items-start gap-2', className)}>
      {lead && <span className="pt-1.5 text-body text-text-primary">{lead}</span>}
      <Select value={field ? field.key : ''} onValueChange={pickField}>
        <SelectTrigger aria-label={labels.field} className="w-44">
          <SelectValue placeholder={labels.pickField} />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {labelOf(f)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {field && (
        <Select value={word} onValueChange={(next) => pickWord(next as OpWord)}>
          <SelectTrigger aria-label={labels.op} className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {words.map((w) => (
              <SelectItem key={w} value={w}>
                {labels.ops[w]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {field && !asked && (
        <ValueEditor
          // A new field or word is a new box: what was typed for the old one does not carry over.
          key={`${field.key}-${word}`}
          field={field}
          word={word}
          value={condition.value}
          onChange={pickValue}
          labels={labels}
          enumLabel={enumLabel}
        />
      )}
      {trail && <span className="pt-1.5 text-body text-text-primary">{trail}</span>}
    </div>
  );
}

/**
 * Whether a condition on this field can be turned into a question. The engine reads a question's
 * answer as text, a date, a range of dates or a choice, so a number, an amount or a yes/no field
 * cannot be asked at run time yet.
 */
export function canAsk(field: DesignerField): boolean {
  return !['NUMBER', 'MONEY', 'PERCENT', 'BOOLEAN'].includes(field.type);
}

/** The question a condition becomes: a class field asks for classes, a date range for two dates, and so on. */
export function parameterFor(
  field: DesignerField,
  word: OpWord,
  key: string,
  enumLabel: EnumLabel,
): ReportParameter {
  const base = { key, label_en: field.label_en, label_bn: field.label_bn, required: false };
  if (field.key === 'class') return { ...base, type: 'CLASS' };
  if (field.key === 'section') return { ...base, type: 'SECTION' };
  if (field.key === 'academic_year') return { ...base, type: 'ACADEMIC_YEAR' };
  if (field.type === 'DATE') return { ...base, type: word === 'between' ? 'DATE_RANGE' : 'DATE' };
  if (field.type === 'ENUM') {
    return {
      ...base,
      type: 'ENUM',
      options: (field.enum_values ?? []).map((value) => ({
        value,
        ...enumLabel(field.key, value),
      })),
    };
  }
  return { ...base, type: 'TEXT' };
}

/** A key no other question uses: `p_class`, then `p_class_2`… */
function freshKey(field: string, taken: Set<string>): string {
  let key = `p_${field}`;
  for (let n = 2; taken.has(key); n++) key = `p_${field}_${n}`;
  return key;
}

export interface FilterBuilderValue {
  filters: ReportFilter[];
  parameters: ReportParameter[];
}

export interface FilterBuilderProps extends FilterBuilderValue {
  /** Every pickable field; only fields (not measures) the server allows filtering on are offered. */
  fields: DesignerField[];
  onChange: (value: FilterBuilderValue) => void;
  labels: FilterBuilderLabels;
  enumLabel?: EnumLabel;
  className?: string;
}

export function FilterBuilder({
  fields,
  filters,
  parameters,
  onChange,
  labels,
  enumLabel = RAW_ENUM,
  className,
}: FilterBuilderProps) {
  const baseId = React.useId();
  const usable = React.useMemo(
    () => fields.filter((f) => f.kind === 'field' && f.filterable),
    [fields],
  );

  const refOf = (filter: ReportFilter) =>
    isParamRef(filter.value) ? filter.value.param : undefined;

  /** A question about classes or sections takes a list, so its words are `IN` and `NOT_IN`. */
  function askOp(question: ReportParameter, word: OpWord): FilterOp {
    if (question.type === 'CLASS' || question.type === 'SECTION') {
      if (word === 'is') return 'IN';
      if (word === 'isNot') return 'NOT_IN';
    }
    return filterOpFor(word, undefined);
  }

  function replace(index: number, condition: ReportFilter) {
    const previous = filters[index]!;
    const key = refOf(previous);
    const field = usable.find((f) => f.key === condition.field);
    const put = (next: ReportFilter) => filters.map((f, i) => (i === index ? next : f));
    if (key === undefined || !field) return onChange({ filters: put(condition), parameters });

    // An asked condition stays asked. Another field gets that field's own question; a date word that
    // changes the kind of question (one day, a range of days) rebuilds it but keeps the wording.
    const word = opWordOf(condition.op);
    const current = parameters.find((p) => p.key === key);
    const rebuilt = parameterFor(field, word, key, enumLabel);
    const sameField = condition.field === previous.field;
    const question =
      sameField && current?.type === rebuilt.type
        ? current
        : sameField && current
          ? { ...rebuilt, label_en: current.label_en, label_bn: current.label_bn }
          : rebuilt;
    onChange({
      filters: put({ field: condition.field, op: askOp(question, word), value: { param: key } }),
      parameters: current
        ? parameters.map((p) => (p.key === key ? question : p))
        : [...parameters, question],
    });
  }

  function setAsked(index: number, asked: boolean) {
    const filter = filters[index]!;
    const field = usable.find((f) => f.key === filter.field);
    if (!field) return;
    const word = opWordOf(filter.op);
    const put = (next: ReportFilter) => filters.map((f, i) => (i === index ? next : f));
    if (!asked) {
      const key = refOf(filter);
      return onChange({
        filters: put({ field: filter.field, op: filterOpFor(word, undefined) }),
        parameters: parameters.filter((p) => p.key !== key),
      });
    }
    const key = freshKey(field.key, new Set(parameters.map((p) => p.key)));
    const question = parameterFor(field, word, key, enumLabel);
    onChange({
      filters: put({ field: filter.field, op: askOp(question, word), value: { param: key } }),
      parameters: [...parameters, question],
    });
  }

  function remove(index: number) {
    const key = refOf(filters[index]!);
    onChange({
      filters: filters.filter((_, i) => i !== index),
      parameters: parameters.filter((p) => p.key !== key),
    });
  }

  function add() {
    onChange({ filters: [...filters, { field: '', op: 'EQ' }], parameters });
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <h3 id={`${baseId}-title`} className="text-h3 text-text-primary">
        {labels.title}
      </h3>
      {filters.length === 0 ? (
        <p className="text-body text-text-secondary">{labels.empty}</p>
      ) : (
        <ul aria-labelledby={`${baseId}-title`} className="flex flex-col gap-3">
          {filters.map((filter, index) => {
            const key = refOf(filter);
            const question = key ? parameters.find((p) => p.key === key) : undefined;
            const askId = `${baseId}-ask-${index}`;
            return (
              <li
                key={`${index}-${filter.field}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <ConditionEditor
                    condition={filter}
                    fields={usable}
                    onChange={(condition) => replace(index, condition)}
                    labels={labels}
                    enumLabel={enumLabel}
                    asked={key !== undefined}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    iconOnly
                    aria-label={labels.remove}
                    onClick={() => remove(index)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {usable.some((f) => f.key === filter.field && canAsk(f)) && (
                  <div className="flex items-center gap-2">
                    <Switch
                      id={askId}
                      checked={key !== undefined}
                      onCheckedChange={(checked) => setAsked(index, checked)}
                    />
                    <Label htmlFor={askId}>{labels.ask}</Label>
                  </div>
                )}
                {question && (
                  <ParamEditor
                    parameter={question}
                    siblings={parameters}
                    labels={labels.params}
                    onChange={(next) =>
                      onChange({
                        filters,
                        parameters: parameters.map((p) => (p.key === next.key ? next : p)),
                      })
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button type="button" variant="outline" onClick={add}>
          <Plus aria-hidden="true" />
          {labels.add}
        </Button>
      </div>
    </div>
  );
}
