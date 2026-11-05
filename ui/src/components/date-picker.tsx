/**
 * Button trigger showing the formatted value; the popover is a hand-rolled
 * month grid (roving tabindex + arrow keys) with the shared `MonthHeader`.
 * No `react-day-picker`: the grid must render Bengali numerals via this
 * package's own `renderDigits` and start the week on the tenant's first day.
 * The header label opens a month grid (year jump) so a date of birth years
 * back is reachable without hundreds of month clicks.
 */
import { CalendarIcon } from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../i18n';
import type { RegionConfig } from '../i18n/region-config';
import { cn } from '../primitives/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';
import { formatDate, formatMonth, toIsoDate } from '../utils/date';
import { renderDigits } from '../utils/digits';

import { MonthHeader } from './month-header';
import { MonthButtons, PickerClear, pickerTriggerClass } from './month-picker';

export interface DatePickerProps extends Omit<
  React.ComponentProps<'button'>,
  'value' | 'onChange' | 'children' | 'aria-label' | 'type'
> {
  value: Date | undefined;
  onValueChange: (date: Date | undefined) => void;
  config: RegionConfig;
  'aria-label': string;
  /** Default `t('date.pick')`. */
  placeholder?: string;
  /** Inclusive. */
  min?: Date | undefined;
  max?: Date | undefined;
  /** A "Clear" button under the grid sets the value back to `undefined`.
   * Default `true`, like the typed input this replaced; pass `false` on a
   * field that must always hold a date. */
  clearable?: boolean;
}

export function DatePicker({
  value,
  onValueChange,
  config,
  placeholder,
  min,
  max,
  clearable = true,
  className,
  ...props
}: DatePickerProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = React.useState(false);
  const [viewMonth, setViewMonth] = React.useState(() => value ?? new Date());
  const visibleText = value ? formatDate(value, config) : (placeholder ?? t('date.pick'));

  React.useEffect(() => {
    if (value) setViewMonth(value);
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...props}
          // WCAG 2.5.3 (label in name): the name is the field's label followed by
          // exactly the text on screen, so a voice user who says what they see
          // ("5 Nov 2026") reaches the control.
          aria-label={`${props['aria-label']}, ${visibleText}`}
          className={cn(pickerTriggerClass, !value && 'text-text-secondary', className)}
        >
          <span>{visibleText}</span>
          <CalendarIcon className="size-4 text-text-secondary" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-fit rounded-lg border border-border-subtle bg-surface p-3 shadow-e2">
        <Calendar
          month={viewMonth}
          selected={value}
          config={config}
          min={min}
          max={max}
          onMonthChange={setViewMonth}
          onSelect={(date) => {
            onValueChange(date);
            setOpen(false);
          }}
        />
        {clearable && value && (
          <PickerClear
            onClear={() => {
              onValueChange(undefined);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

interface CalendarProps {
  month: Date;
  selected: Date | undefined;
  config: RegionConfig;
  min?: Date | undefined;
  max?: Date | undefined;
  onMonthChange: (date: Date) => void;
  onSelect: (date: Date) => void;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

const ymKey = (d: Date) => toIsoDate(d).slice(0, 7);

/** Exported for its own story/tests; not part of the package's public
 * `components` surface (not in `index.ts`) — `DatePicker` is the real
 * public API, this is its implementation detail. */
export function Calendar({
  month,
  selected,
  config,
  min,
  max,
  onMonthChange,
  onSelect,
}: CalendarProps) {
  const { t } = useTranslation('common');
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const today = new Date();
  const firstDow = config.date.firstDayOfWeek;
  const offset = (new Date(year, monthIndex, 1).getDay() - firstDow + 7) % 7;
  const weekCount = Math.ceil((offset + daysInMonth(year, monthIndex)) / 7);
  // Full weeks: leading/trailing days belong to the neighbouring months.
  const cells = Array.from(
    { length: weekCount * 7 },
    (_, i) => new Date(year, monthIndex, 1 - offset + i),
  );
  const weeks = Array.from({ length: weekCount }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  // Jan 7, 2024 is a Sunday: 7 consecutive real dates for `Intl`, rotated to
  // start on the tenant's first day of week.
  const weekdayLabels = React.useMemo(() => {
    const formatter = new Intl.DateTimeFormat(config.locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) =>
      formatter.format(new Date(2024, 0, 7 + ((firstDow + i) % 7))),
    );
  }, [config.locale, firstDow]);

  const [view, setView] = React.useState<'days' | 'months'>('days');
  const [pickYear, setPickYear] = React.useState(year);
  const [focused, setFocused] = React.useState<Date>(() => selected ?? new Date());
  const gridRef = React.useRef<HTMLDivElement>(null);
  // Set at the *start* of a keyboard move, before the state change that can
  // replace the focused button with a different DOM node (crossing a month
  // boundary) — by the time the effect runs, `document.activeElement` may
  // already be `<body>`. Capturing intent up front keeps the refocus reliable.
  const hadFocusRef = React.useRef(false);

  React.useEffect(() => {
    if (!hadFocusRef.current) return;
    hadFocusRef.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[data-focused="true"]')?.focus();
  }, [focused, month]);

  // Esc in the months view goes back to days before it closes the popover.
  // Radix listens on `document` in the capture phase; this listener is
  // registered at mount (a child effect, so before Radix's) and reads the
  // view from a ref, so stopping propagation here wins.
  const viewRef = React.useRef(view);
  viewRef.current = view;
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || viewRef.current !== 'months') return;
      event.stopImmediatePropagation();
      setView('days');
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  const minKey = min ? toIsoDate(min) : undefined;
  const maxKey = max ? toIsoDate(max) : undefined;
  const isDisabled = (d: Date) => {
    const key = toIsoDate(d);
    return (minKey !== undefined && key < minKey) || (maxKey !== undefined && key > maxKey);
  };

  // Roving tab stop: the focused day if it is in the shown month, else the
  // selected day, else today, else the 1st. A disabled candidate falls back
  // to the first enabled day of the month so the grid stays Tab-reachable.
  const first = new Date(year, monthIndex, 1);
  const candidate = sameMonth(focused, month)
    ? focused
    : selected && sameMonth(selected, month)
      ? selected
      : sameMonth(today, month)
        ? today
        : first;
  const roving = isDisabled(candidate)
    ? (cells.find((d) => sameMonth(d, month) && !isDisabled(d)) ?? candidate)
    : candidate;

  // Arrow keys never land on a disabled day: clamp into [min, max].
  const clamp = (d: Date) =>
    minKey !== undefined && toIsoDate(d) < minKey
      ? new Date(min!.getFullYear(), min!.getMonth(), min!.getDate())
      : maxKey !== undefined && toIsoDate(d) > maxKey
        ? new Date(max!.getFullYear(), max!.getMonth(), max!.getDate())
        : d;

  function moveFocus(delta: number) {
    hadFocusRef.current = !!gridRef.current?.contains(document.activeElement);
    const next = clamp(new Date(roving.getFullYear(), roving.getMonth(), roving.getDate() + delta));
    setFocused(next);
    if (!sameMonth(next, month)) onMonthChange(new Date(next.getFullYear(), next.getMonth(), 1));
  }

  const inMonths = view === 'months';
  return (
    <div>
      <div className="mb-2">
        <MonthHeader
          label={
            inMonths ? renderDigits(String(pickYear), config.numerals) : formatMonth(month, config)
          }
          previousLabel={inMonths ? t('date.previousYear') : undefined}
          nextLabel={inMonths ? t('date.nextYear') : undefined}
          onPrevious={() =>
            inMonths ? setPickYear((y) => y - 1) : onMonthChange(new Date(year, monthIndex - 1, 1))
          }
          onNext={() =>
            inMonths ? setPickYear((y) => y + 1) : onMonthChange(new Date(year, monthIndex + 1, 1))
          }
          onToday={
            inMonths
              ? undefined
              : () => {
                  onMonthChange(new Date(today.getFullYear(), today.getMonth(), 1));
                  setFocused(today);
                }
          }
          todayDisabled={isDisabled(today)}
          onLabelClick={() => {
            setPickYear(year);
            setView(inMonths ? 'days' : 'months');
          }}
          labelExpanded={inMonths}
        />
      </div>
      {inMonths ? (
        <MonthButtons
          year={pickYear}
          selected={ymKey(month)}
          min={min ? ymKey(min) : undefined}
          max={max ? ymKey(max) : undefined}
          config={config}
          onPick={(m) => {
            onMonthChange(new Date(pickYear, m - 1, 1));
            setView('days');
          }}
        />
      ) : (
        // `role="grid"` requires `row` children containing cells — each row
        // uses `display: contents` so its children still lay out against
        // this element's `grid-cols-7`, while the rows exist in the
        // accessibility tree.
        <div ref={gridRef} role="grid" aria-label={t('date.calendar')} className="grid grid-cols-7">
          <div role="row" className="contents">
            {weekdayLabels.map((label, index) => (
              <span
                key={index}
                role="columnheader"
                aria-label={label}
                className="h-8 text-center text-caption text-text-secondary"
              >
                {label}
              </span>
            ))}
          </div>
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} role="row" className="contents">
              {week.map((date) => {
                const isFocused = sameDay(date, roving);
                const isToday = sameDay(date, today);
                const isSelected = selected ? sameDay(date, selected) : false;
                const outside = !sameMonth(date, month);
                const disabled = isDisabled(date);
                // D26: with no value, today shows the selected look.
                const filled = isSelected || (!selected && isToday);
                return (
                  <button
                    key={toIsoDate(date)}
                    type="button"
                    role="gridcell"
                    data-focused={isFocused}
                    data-date={toIsoDate(date)}
                    data-today={isToday ? '' : undefined}
                    data-outside={outside ? '' : undefined}
                    tabIndex={isFocused ? 0 : -1}
                    aria-selected={isSelected}
                    aria-label={formatDate(date, config)}
                    aria-disabled={disabled ? 'true' : undefined}
                    disabled={disabled}
                    // [8.14.14]: shared two-tone focus ring, with two
                    // deliberate deviations: `ring-offset-popover` (this grid
                    // sits on the popover surface, not the page ground) and
                    // `relative z-10` so neighbours' backgrounds do not paint
                    // over the ring.
                    className={cn(
                      'flex size-11 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover disabled:pointer-events-none disabled:opacity-40 md:size-9',
                      outside && 'text-text-secondary opacity-60',
                    )}
                    onClick={() => onSelect(date)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        moveFocus(1);
                      } else if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        moveFocus(-1);
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        moveFocus(7);
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        moveFocus(-7);
                      } else if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (!disabled) onSelect(date);
                      }
                    }}
                  >
                    <span
                      className={cn(
                        'flex size-7 items-center justify-center rounded-full text-label',
                        isToday && 'font-semibold text-primary ring-2 ring-primary ring-inset',
                        filled && 'bg-primary font-semibold text-primary-foreground',
                      )}
                    >
                      {renderDigits(String(date.getDate()), config.numerals)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
