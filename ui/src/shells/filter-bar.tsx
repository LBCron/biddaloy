/**
 * [8.14.8]: the one typed search form every list page uses instead of
 * hand-rolling its own `filterBar` markup. A page declares *what* it
 * filters on — a `FilterFieldDescriptor[]` — and this component owns
 * *how*: which `@biddaloy/ui` control renders each kind, the 300ms
 * debounce + Bengali-digit normalization (`use-filter-bar-state.ts`), the
 * `'__all__'` Radix-Select sentinel (every page used to redeclare this
 * itself — `client-admin/src/routes/_staff/invoices/index.tsx:36` and
 * two other pages), the mobile "Filters (n)" bottom sheet, and the
 * always-visible active-filter chip row — including a chip for a
 * `values` key **no descriptor covers**, which is the fix for the
 * "invisible active filter" bug class this ticket exists to kill
 * (`invoices/index.tsx` accepts `student_id` in its URL schema but never
 * rendered a control, or a chip, for it).
 *
 * Router-agnostic like every shell in this directory: takes `values` +
 * `onChange` (`ListShellState.filters` / `ListShellActions.setFilters`'s
 * own shape), never calls `useListShellState` itself — see
 * `list-shell.tsx`'s header comment for why that split exists.
 *
 * Two render scopes share one field renderer: `bar` (desktop 12-column row;
 * on a phone only the primary box and the "Filters (n)" button show, the rest
 * is `hidden md:flex`) and `sheet` (the same fields, full width, inside the
 * phone `FilterSheet`, which only mounts while open). The scope is part of
 * every control id so the two copies never collide.
 * The chip row is *never* part of that collapsible tree — an active
 * filter must stay visible and clearable on a 320px phone even while the
 * controls that created it are collapsed behind the sheet button.
 */
import { SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '../components/button';
import { Checkbox } from '../components/checkbox';
import { DatePicker } from '../components/date-picker';
import { FilterSheet } from '../components/filter-sheet';
import { HelpHint, useHelp } from '../components/help-hint';
import { Input } from '../components/input';
import { Label } from '../components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select';
import { useRegionConfig, useTranslation } from '../i18n';
import { formatDate, formatNumber, parseDate, toIsoDate } from '../utils';

import { useFilterBarState } from './use-filter-bar-state';

/** Radix `Select.Item` rejects an empty-string `value` — this is the one
 * place that sentinel is declared; no caller needs its own anymore. */
const ALL_VALUE = '__all__';

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterFieldBase {
  /** A (?) after the field's label (needs a help index entry, Epic 44). */
  helpId?: string | undefined;
}

export interface TextFilterField extends FilterFieldBase {
  kind: 'text';
  key: string;
  label: string;
  placeholder?: string;
  /** Stays inline, always visible, even on a collapsed mobile bar — the
   * issue's own "primary text search stays inline" requirement. At most
   * one field should set this; a second one is a dev-mode warning, not a
   * type error (a tuple/union big enough to enforce "at most one" isn't
   * worth the API complexity for a mistake `console.warn` already flags
   * loudly in development). */
  primary?: boolean;
  /** Display-only chip text, e.g. a numeric text filter shown in tenant digits; the URL keeps the raw value. */
  formatChip?: (value: string) => string;
}

export interface SelectFilterField extends FilterFieldBase {
  kind: 'select';
  key: string;
  label: string;
  /** Label for the built-in "no filter" option — caller-supplied so it
   * stays in the page's own i18n namespace (e.g. "All statuses"),
   * matching every hand-rolled `filterBar` this replaces. */
  allLabel: string;
  options: readonly FilterOption[];
}

export interface DateRangeFilterField extends FilterFieldBase {
  kind: 'date-range';
  /** Explicit URL keys, not derived from a single `key` — live Zod search
   * schemas already use `from_date`/`to_date`, which no `${key}_from`
   * derivation rule would produce; this keeps the URL schema, not the
   * descriptor, as the source of truth for param names. */
  fromKey: string;
  toKey: string;
  label: string;
  fromLabel: string;
  toLabel: string;
}

export interface CheckboxFilterField extends FilterFieldBase {
  kind: 'checkbox';
  key: string;
  label: string;
}

export interface NumberRangeFilterField extends FilterFieldBase {
  kind: 'number-range';
  minKey: string;
  maxKey: string;
  label: string;
  minLabel: string;
  maxLabel: string;
}

export type FilterFieldDescriptor =
  | TextFilterField
  | SelectFilterField
  | DateRangeFilterField
  | CheckboxFilterField
  | NumberRangeFilterField;

export interface FilterBarProps {
  fields: readonly FilterFieldDescriptor[];
  /** `ListShellState.filters`. */
  values: Record<string, string>;
  /** `ListShellActions.setFilters`. */
  onChange: (patch: Record<string, string | null>) => void;
  /** @default 300 */
  debounceMs?: number;
  /** Total matches, shown on the phone sheet's primary button ("Show 48 results"). */
  resultCount?: number;
}

/** `parseDate` throws on anything that isn't a real `YYYY-MM-DD` date — a
 * hand-edited or stale URL param must not crash the whole bar, just show
 * the date field as empty. */
function safeParseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  try {
    return parseDate(raw);
  } catch {
    return undefined;
  }
}

/** Every `values` key a descriptor renders a control for — used to count
 * only the filters actually hidden behind the mobile disclosure. A
 * `primary` text field stays inline (never collapsed) and a deep-linked
 * key with no matching descriptor gets a chip but no control at all, so
 * neither should count toward "Filters (n)" — that count is a promise
 * about what opening the panel reveals, not the total active-filter
 * count (the chip row already shows that in full, uncollapsed). */
export function keysOf(field: FilterFieldDescriptor): string[] {
  switch (field.kind) {
    case 'text':
    case 'select':
    case 'checkbox':
      return [field.key];
    case 'date-range':
      return [field.fromKey, field.toKey];
    case 'number-range':
      return [field.minKey, field.maxKey];
  }
}

interface RangePart {
  label: string;
  id: string;
  control: React.ReactNode;
}

export function FilterBar({ fields, values, onChange, debounceMs, resultCount }: FilterBarProps) {
  const { t } = useTranslation();
  const { resolve } = useHelp();
  const regionConfig = useRegionConfig();
  const baseId = React.useId();
  const [sheetOpen, setSheetOpen] = React.useState(false);

  // Chips show formatted values; the URL keeps the raw ISO date / digits.
  // A value that can't be formatted exactly (bad date, non-number) shows raw,
  // and decimals are kept, so a chip never hides or rounds the active filter.
  const formatValue = React.useCallback(
    (kind: 'date' | 'number', value: string) => {
      if (kind === 'date') return safeParseDate(value) ? formatDate(value, regionConfig) : value;
      if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
      const decimals = value.split('.')[1]?.length ?? 0;
      return formatNumber(Number(value), regionConfig, { decimals });
    },
    [regionConfig],
  );

  // `exactOptionalPropertyTypes` is on for this package, so `debounceMs`
  // (optional on both `FilterBarProps` and `UseFilterBarStateOptions`)
  // can't be forwarded as `number | undefined` even though both sides
  // declare it optional — only an omitted key satisfies "optional",
  // an explicit `undefined` value does not. Spread it in only when set.
  const { localValues, setLocalValue, setValue, chips, clearFilter, clearAll } = useFilterBarState({
    fields,
    values,
    onChange,
    formatValue,
    ...(debounceMs !== undefined ? { debounceMs } : {}),
  });

  const primaryFields = fields.filter(
    (field): field is TextFilterField => field.kind === 'text' && field.primary === true,
  );
  if (process.env.NODE_ENV !== 'production' && primaryFields.length > 1) {
    console.warn(
      '[FilterBar] more than one field has `primary: true` — only the first stays inline on ' +
        'mobile; the rest fall behind the "Filters (n)" sheet like any other field.',
    );
  }
  const primaryField = primaryFields[0];
  const collapsibleFields = fields.filter((field) => field !== primaryField);

  // "Filters (n)" is a promise about what opening the sheet reveals, not
  // the total active-filter count — a `primary` field's own chip (stays
  // inline, never collapsed) and a deep-linked unknown-key chip (no
  // control at all, so nothing to reveal) must not inflate it.
  const collapsibleKeys = new Set(collapsibleFields.flatMap(keysOf));
  const collapsibleActiveCount = chips.filter((chip) => collapsibleKeys.has(chip.key)).length;

  /** The label, plus a (?) beside it when `helpId` resolves; no wrapper otherwise. */
  function withHelp(
    label: React.ReactNode,
    helpId: string | undefined,
    text: string,
    hideOnPhone = false,
  ) {
    if (!resolve(helpId)) return label;
    return (
      <span className="inline-flex items-center gap-1">
        {label}
        <HelpHint
          helpId={helpId}
          label={text}
          className={hideOnPhone ? 'hidden md:inline-flex' : undefined}
        />
      </span>
    );
  }

  function labelled(
    label: string,
    id: string,
    control: React.ReactNode,
    srOnlyOnPhone = false,
    helpId?: string,
  ) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {withHelp(
          <Label htmlFor={id} className={srOnlyOnPhone ? 'sr-only md:not-sr-only' : undefined}>
            {label}
          </Label>,
          helpId,
          label,
          srOnlyOnPhone,
        )}
        {control}
      </div>
    );
  }

  /** Bar scope: one group label over both controls with "–" between. Sheet
   * scope: two separate labelled fields. */
  function range(
    scope: 'bar' | 'sheet',
    groupLabel: string,
    groupKey: string,
    [from, to]: [RangePart, RangePart],
    helpId?: string,
  ) {
    if (scope === 'sheet') {
      return (
        <>
          {labelled(from.label, from.id, from.control, false, helpId)}
          {labelled(to.label, to.id, to.control)}
        </>
      );
    }
    const labelId = `${baseId}-group-${groupKey}`;
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {withHelp(
          <span id={labelId} className="text-label font-medium">
            {groupLabel}
          </span>,
          helpId,
          groupLabel,
        )}
        <div role="group" aria-labelledby={labelId} className="flex items-center gap-1.5">
          {from.control}
          <span aria-hidden="true" className="text-text-secondary">
            –
          </span>
          {to.control}
        </div>
      </div>
    );
  }

  function renderField(f: FilterFieldDescriptor, scope: 'bar' | 'sheet') {
    const id = (key: string) => `${baseId}-${scope}-${key}`;
    switch (f.kind) {
      case 'text': {
        const input = (
          <Input
            id={id(f.key)}
            placeholder={f.placeholder}
            className={f.primary ? 'ps-10' : 'w-full'}
            value={localValues[f.key] ?? ''}
            onChange={(event) => setLocalValue(f.key, event.target.value)}
          />
        );
        return labelled(
          f.label,
          id(f.key),
          f.primary ? (
            <div className="relative">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
              />
              {input}
            </div>
          ) : (
            input
          ),
          f.primary === true && scope === 'bar',
          f.helpId,
        );
      }
      case 'select': {
        const current = values[f.key];
        // A URL/deep-link value that isn't one of `f.options` (a status
        // since renamed, a stale bookmark) must not render the trigger
        // blank — that's the same "invisible active filter" bug class this
        // ticket exists to kill, just one descriptor level down from the
        // no-descriptor-at-all case the chip row already covers. Inject a
        // synthetic item so the trigger still shows *something* and the
        // value stays selectable back to itself / clearable via "All".
        const isKnown =
          current === undefined || f.options.some((option) => option.value === current);
        return labelled(
          f.label,
          id(f.key),
          <Select
            value={current ?? ALL_VALUE}
            onValueChange={(value) => setValue(f.key, value === ALL_VALUE ? null : value)}
          >
            <SelectTrigger id={id(f.key)} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{f.allLabel}</SelectItem>
              {!isKnown && current !== undefined && (
                <SelectItem value={current}>
                  {t('filters.unknownFilter', { key: f.label, value: current })}
                </SelectItem>
              )}
              {f.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
          false,
          f.helpId,
        );
      }
      case 'date-range': {
        const picker = (key: string, label: string) => ({
          label,
          id: id(key),
          control: (
            <DatePicker
              id={id(key)}
              aria-label={label}
              className="w-full"
              config={regionConfig}
              value={safeParseDate(values[key])}
              onValueChange={(date) => setValue(key, date ? toIsoDate(date) : null)}
            />
          ),
        });
        return range(
          scope,
          f.label,
          f.fromKey,
          [picker(f.fromKey, f.fromLabel), picker(f.toKey, f.toLabel)],
          f.helpId,
        );
      }
      case 'checkbox':
        return (
          <div className="flex min-h-11 items-center gap-3 md:min-h-8">
            <Checkbox
              id={id(f.key)}
              className="size-6"
              checked={values[f.key] === 'true'}
              onCheckedChange={(checked) => setValue(f.key, checked === true ? 'true' : null)}
            />
            {withHelp(<Label htmlFor={id(f.key)}>{f.label}</Label>, f.helpId, f.label)}
          </div>
        );
      case 'number-range': {
        const num = (key: string, label: string) => ({
          label,
          id: id(key),
          control: (
            <Input
              id={id(key)}
              aria-label={label}
              type="text"
              inputMode="numeric"
              className="w-full"
              value={localValues[key] ?? ''}
              onChange={(event) => setLocalValue(key, event.target.value)}
            />
          ),
        });
        return range(
          scope,
          f.label,
          f.minKey,
          [num(f.minKey, f.minLabel), num(f.maxKey, f.maxLabel)],
          f.helpId,
        );
      }
    }
  }

  /** Desktop column span for a collapsible field in the 12-column bar. */
  function spanClass(f: FilterFieldDescriptor) {
    switch (f.kind) {
      case 'select':
        return 'md:col-span-2';
      case 'date-range':
        return 'md:col-span-4';
      case 'checkbox':
        return 'md:col-span-2 md:self-end';
      default:
        return 'md:col-span-3';
    }
  }

  return (
    <section aria-label={t('filters.showFiltersNone')} className="space-y-3">
      <div className="flex items-end gap-2 md:grid md:grid-cols-12 md:gap-4">
        {primaryField && (
          <div className="min-w-0 flex-1 md:col-span-4">{renderField(primaryField, 'bar')}</div>
        )}
        {collapsibleFields.length > 0 && (
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 md:hidden md:h-auto"
            aria-haspopup="dialog"
            onClick={() => setSheetOpen(true)}
          >
            <SlidersHorizontalIcon aria-hidden="true" />
            {collapsibleActiveCount === 0
              ? t('filters.showFiltersNone')
              : t('filters.showFilters', { count: collapsibleActiveCount })}
          </Button>
        )}
        {collapsibleFields.map((f) => (
          <div key={keysOf(f).join(':')} className={`hidden md:flex md:flex-col ${spanClass(f)}`}>
            {renderField(f, 'bar')}
          </div>
        ))}
      </div>
      {collapsibleFields.length > 0 && (
        <FilterSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onClearAll={clearAll}
          {...(resultCount !== undefined ? { resultCount } : {})}
        >
          {collapsibleFields.map((f) => (
            <React.Fragment key={keysOf(f).join(':')}>{renderField(f, 'sheet')}</React.Fragment>
          ))}
        </FilterSheet>
      )}
      {chips.length > 0 && (
        <ul
          aria-label={t('filters.activeFilters')}
          className="flex flex-wrap items-center gap-x-2 md:gap-y-2"
        >
          {chips.map((chip) => {
            const label =
              chip.label ?? t('filters.unknownFilter', { key: chip.key, value: chip.value });
            return (
              <li key={chip.key}>
                <button
                  type="button"
                  className="inline-flex h-11 items-center md:h-7"
                  aria-label={t('filters.removeFilter', { label })}
                  onClick={() => clearFilter(chip.key)}
                >
                  <span className="inline-flex h-7 items-center gap-1 rounded-full bg-secondary ps-3 pe-2 text-label text-secondary-foreground">
                    {label}
                    <XIcon className="size-3.5" aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
          {chips.length > 1 && (
            <li>
              <button
                type="button"
                className="inline-flex h-11 items-center rounded-md px-2 text-label font-medium text-primary hover:bg-muted md:h-7"
                onClick={clearAll}
              >
                {t('filters.clearAll')}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
