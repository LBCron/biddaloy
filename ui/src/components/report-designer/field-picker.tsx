/**
 * [8.15.39] The report designer's field picker, in everyday words (glossary D21). A person picks
 * what the report is about by topic, not by table, and puts each field into one of three trays:
 *
 * ```
 *  [ দেখাবেন ]        [ ভাগ করবেন ]       [ গুনবেন / যোগ করবেন ]     <- the three trays
 *   নাম  শ্রেণি         শ্রেণি              ছাত্রছাত্রী
 *
 *  খুঁজুন: [ শ্রেণি___________ ]                 ২টি পাওয়া গেছে
 *
 *  শ্রেণি ও শাখা
 *   [শ্রেণি | দেখাবেন | ভাগ করবেন]  [শাখা | দেখাবেন | ভাগ করবেন]
 *  ছাত্র
 *   [নাম | দেখাবেন | ভাগ করবেন]  [জন্মতারিখ 🔒 | দেখাবেন | ভাগ করবেন]
 *   [ছাত্রছাত্রী]    <- a field that can only be counted: one click puts it in the count tray
 * ```
 *
 * Props only: the screen hands over the fields of one subject area (from `GET /reports/meta`, via
 * `fieldsFromMeta`), the current picks and a `labels` object built once by `useDesignerLabels()`.
 * Nothing here fetches or calls `useTranslation`; words arrive as props.
 *
 * What goes where: a field can be shown, and split by if the server says it is groupable. A
 * measure (a count or an amount the server works out) can only be counted or added up, so it goes
 * straight to that tray. A field the viewer may not see everywhere carries a small lock whose
 * tooltip says who can see it.
 */
import type { FieldSensitivity, ReportFieldType } from '@biddaloy/shared';
import { Lock, X } from 'lucide-react';
import * as React from 'react';

import { useLocale, useRegionConfig } from '../../i18n';
import { cn } from '../../primitives/lib/utils';
import { toLatinDigits } from '../../utils/digits';
import { formatNumber } from '../../utils/number';
import { Input } from '../input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip';

export type FieldTray = 'show' | 'split' | 'count';

export const FIELD_TRAYS: readonly FieldTray[] = ['show', 'split', 'count'];

/** The everyday topics fields are grouped under, in the order they are listed. */
export const DESIGNER_TOPICS = [
  'student',
  'class',
  'guardian',
  'fee',
  'payment',
  'attendance',
  'staff',
  'exam',
  'other',
] as const;
export type DesignerTopic = (typeof DESIGNER_TOPICS)[number];

/** One thing the designer can pick: a field of a record, or a measure (a count or an amount). */
export interface DesignerField {
  key: string;
  label_en: string;
  label_bn: string;
  type: ReportFieldType;
  sensitivity: FieldSensitivity;
  topic: DesignerTopic;
  /** `field`: something about each record. `measure`: a count or an amount the server works out. */
  kind: 'field' | 'measure';
  /** Fields only: may the report be split by it? Always false for a measure. */
  groupable: boolean;
  /** Fields only: may "only those who…" use it? Always false for a measure. */
  filterable: boolean;
  /** ENUM fields: the raw values the server accepts. Show them through an `enumLabel`, never as they are. */
  enum_values?: string[];
}

/** The keys picked in each tray, in the order picked. */
export type FieldPickerValue = Record<FieldTray, string[]>;

export const EMPTY_PICKS: FieldPickerValue = { show: [], split: [], count: [] };

/** Who can see a locked field: one sentence per level that is not open to everyone. */
export type LockLabels = Record<Exclude<FieldSensitivity, 'PUBLIC'>, string>;

export interface FieldPickerLabels {
  title: string;
  searchLabel: string;
  searchPlaceholder: string;
  /** "২টি পাওয়া গেছে": `n` is already written in the school's digits. */
  found: (n: string) => string;
  noMatch: string;
  empty: string;
  /** "সরান": the field's name follows it in the button's accessible name. */
  remove: string;
  topics: Record<DesignerTopic, string>;
  trays: Record<FieldTray, string>;
  hints: Record<FieldTray, string>;
  lock: LockLabels;
}

/** The trays a field can go into. */
export function allowedTrays(field: DesignerField): FieldTray[] {
  if (field.kind === 'measure') return ['count'];
  return field.groupable ? ['show', 'split'] : ['show'];
}

/** The field's name in the current language. */
export function useFieldLabel(): (field: Pick<DesignerField, 'label_en' | 'label_bn'>) => string {
  const { locale } = useLocale();
  return (field) => (locale === 'bn' ? field.label_bn : field.label_en);
}

/** Lower case, Latin digits, no stray spaces: "  ক্লাস ৬ " and "ক্লাস 6" match each other. */
function normalize(text: string): string {
  return toLatinDigits(text).normalize('NFC').toLowerCase().trim();
}

/** True when `query` appears in the field's Bangla name, English name or key. An empty query matches all. */
export function matchesField(field: DesignerField, query: string): boolean {
  const needle = normalize(query);
  if (needle === '') return true;
  return [field.label_bn, field.label_en, field.key].some((text) =>
    normalize(text).includes(needle),
  );
}

/** The registry area a field came from decides most topics; a few field names decide the rest. */
const CLASS_KEYS = new Set(['class', 'section', 'shift', 'version', 'academic_year']);
const AREA_TOPIC: Record<string, DesignerTopic> = {
  STUDENTS: 'student',
  FEES: 'fee',
  PAYMENTS: 'payment',
  ATTENDANCE: 'attendance',
  STAFF: 'staff',
  PUBLIC_EXAMS: 'exam',
};

export function defaultTopicOf(areaKey: string, fieldKey: string): DesignerTopic {
  if (fieldKey.startsWith('guardian_')) return 'guardian';
  if (CLASS_KEYS.has(fieldKey)) return 'class';
  return AREA_TOPIC[areaKey] ?? 'other';
}

const FIELD_TYPES: readonly string[] = [
  'TEXT',
  'NUMBER',
  'MONEY',
  'PERCENT',
  'DATE',
  'ENUM',
  'BOOLEAN',
];
const SENSITIVITIES: readonly string[] = [
  'PUBLIC',
  'PERSONAL',
  'CONTACT',
  'FINANCIAL',
  'SENSITIVE',
];

/** One subject area as `GET /reports/meta` sends it (`MetaAreaDto` in `api/schema.d.ts`). */
export interface MetaAreaLike {
  key: string;
  fields: {
    key: string;
    label_en: string;
    label_bn: string;
    type: string;
    sensitivity: string;
    filterable: boolean;
    groupable: boolean;
    enum_values?: string[] | undefined;
  }[];
  measures: {
    key: string;
    label_en: string;
    label_bn: string;
    type: string;
    sensitivity: string;
  }[];
}

/**
 * The picker's items for one subject area. A type or sensitivity the server adds later is read as
 * TEXT or SENSITIVE (the safest reading), never passed on as an unknown string.
 */
export function fieldsFromMeta(
  area: MetaAreaLike,
  topicOf: (areaKey: string, fieldKey: string) => DesignerTopic = defaultTopicOf,
): DesignerField[] {
  const type = (value: string) => (FIELD_TYPES.includes(value) ? value : 'TEXT') as ReportFieldType;
  const sensitivity = (value: string) =>
    (SENSITIVITIES.includes(value) ? value : 'SENSITIVE') as FieldSensitivity;
  const fields = area.fields.map((f): DesignerField => ({
    key: f.key,
    label_en: f.label_en,
    label_bn: f.label_bn,
    type: type(f.type),
    sensitivity: sensitivity(f.sensitivity),
    topic: topicOf(area.key, f.key),
    kind: 'field',
    groupable: f.groupable,
    filterable: f.filterable,
    ...(f.enum_values ? { enum_values: f.enum_values } : {}),
  }));
  const measures = area.measures.map((m): DesignerField => ({
    key: m.key,
    label_en: m.label_en,
    label_bn: m.label_bn,
    type: type(m.type),
    sensitivity: sensitivity(m.sensitivity),
    topic: topicOf(area.key, m.key),
    kind: 'measure',
    groupable: false,
    filterable: false,
  }));
  return [...fields, ...measures];
}

const CHIP_BUTTON =
  'inline-flex min-h-11 items-center rounded-full px-3 text-label focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-8';

function PickButton({
  pressed,
  onClick,
  ariaLabel,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        CHIP_BUTTON,
        pressed
          ? 'bg-secondary text-secondary-foreground ring-1 ring-primary'
          : 'text-text-secondary hover:bg-muted hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

export interface FieldPickerProps {
  fields: DesignerField[];
  value: FieldPickerValue;
  onChange: (value: FieldPickerValue) => void;
  labels: FieldPickerLabels;
  className?: string;
}

export function FieldPicker({ fields, value, onChange, labels, className }: FieldPickerProps) {
  const config = useRegionConfig();
  const labelOf = useFieldLabel();
  const [query, setQuery] = React.useState('');
  const baseId = React.useId();

  const byKey = React.useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const visible = React.useMemo(
    () => fields.filter((f) => matchesField(f, query)),
    [fields, query],
  );
  const topics = DESIGNER_TOPICS.map((topic) => ({
    topic,
    items: visible.filter((f) => f.topic === topic),
  })).filter((group) => group.items.length > 0);

  function toggle(tray: FieldTray, key: string) {
    const picked = value[tray];
    onChange({
      ...value,
      [tray]: picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key],
    });
  }

  function chip(field: DesignerField) {
    const name = labelOf(field);
    const trays = allowedTrays(field);
    const locked = field.sensitivity !== 'PUBLIC';
    return (
      <li
        key={field.key}
        className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface ps-1 pe-1"
      >
        {trays.length === 1 ? (
          <PickButton
            pressed={value[trays[0]!].includes(field.key)}
            onClick={() => toggle(trays[0]!, field.key)}
            ariaLabel={`${labels.trays[trays[0]!]}: ${name}`}
          >
            {name}
          </PickButton>
        ) : (
          <>
            <span className="px-2 text-label text-text-primary">{name}</span>
            {trays.map((tray) => (
              <PickButton
                key={tray}
                pressed={value[tray].includes(field.key)}
                onClick={() => toggle(tray, field.key)}
                ariaLabel={`${labels.trays[tray]}: ${name}`}
              >
                {labels.trays[tray]}
              </PickButton>
            ))}
          </>
        )}
        {locked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={labels.lock[field.sensitivity as keyof LockLabels]}
                className="inline-flex size-11 items-center justify-center rounded-full text-text-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:size-8"
              >
                <Lock aria-hidden="true" className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{labels.lock[field.sensitivity as keyof LockLabels]}</TooltipContent>
          </Tooltip>
        )}
      </li>
    );
  }

  return (
    <TooltipProvider>
      <div className={cn('flex flex-col gap-4', className)}>
        <h3 id={`${baseId}-title`} className="text-h3 text-text-primary">
          {labels.title}
        </h3>

        <div className="grid gap-3 md:grid-cols-3">
          {FIELD_TRAYS.map((tray) => {
            const picked = value[tray].map((key) => byKey.get(key)).filter((f) => f !== undefined);
            return (
              <section
                key={tray}
                aria-labelledby={`${baseId}-tray-${tray}`}
                className="flex min-h-24 flex-col gap-2 rounded-lg border border-border bg-muted p-3"
              >
                <h4 id={`${baseId}-tray-${tray}`} className="text-label font-medium">
                  {labels.trays[tray]}
                </h4>
                {picked.length === 0 ? (
                  <p className="text-caption text-text-secondary">{labels.hints[tray]}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {picked.map((field) => (
                      <li
                        key={field.key}
                        className="inline-flex items-center gap-1 rounded-full bg-surface ps-3 pe-1 text-label ring-1 ring-border"
                      >
                        {labelOf(field)}
                        <button
                          type="button"
                          aria-label={`${labels.remove}: ${labelOf(field)}`}
                          onClick={() => toggle(tray, field.key)}
                          className="inline-flex size-11 items-center justify-center rounded-full hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:size-8"
                        >
                          <X aria-hidden="true" className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5">
          <Input
            type="search"
            aria-label={labels.searchLabel}
            placeholder={labels.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <p role="status" className="text-caption text-text-secondary">
            {query.trim() === ''
              ? ''
              : visible.length === 0
                ? labels.noMatch
                : labels.found(formatNumber(visible.length, config))}
          </p>
        </div>

        {fields.length === 0 ? (
          <p className="text-body text-text-secondary">{labels.empty}</p>
        ) : (
          topics.map(({ topic, items }) => (
            <section key={topic} aria-labelledby={`${baseId}-topic-${topic}`}>
              <h4
                id={`${baseId}-topic-${topic}`}
                className="mb-2 text-label font-medium text-text-secondary"
              >
                {labels.topics[topic]}
              </h4>
              <ul className="flex flex-wrap gap-2">{items.map(chip)}</ul>
            </section>
          ))
        )}
      </div>
    </TooltipProvider>
  );
}
