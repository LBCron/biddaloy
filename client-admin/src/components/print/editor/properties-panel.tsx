/**
 * [32.3.1] The form for the selected element (D29, D31): position and size in mm,
 * and what each kind of element needs (text: content, font, size, colour,
 * alignment, overflow policy; image: source and fit; shape: stroke and fill).
 *
 * Numbers are edited as text and COMMITTED on blur or Enter, then clamped to the
 * allowed range. Committing per keystroke would fight the editor's validation:
 * typing "1" on the way to "10" is below the 4 pt minimum and would be refused.
 * Data fields come from the server's field catalog (D29) — nothing else can be picked.
 */
import {
  FIELD_CATALOG,
  OverflowPolicy,
  type DocumentKind,
  type PrintElement,
} from '@biddaloy/shared';
import {
  BUNDLED_PRINT_FONTS,
  Checkbox,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  HelpHint,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { slotLabel } from './element-label';

export interface PropertiesPanelProps {
  element: PrintElement | undefined;
  kind: DocumentKind;
  /** Uploaded font families, added to the bundled ones. */
  extraFonts?: string[];
  onChange: (patch: Record<string, unknown>) => void;
}

/* ------------------------------------------------------------ small parts */

const fmt = (n: number | undefined) => (n === undefined ? '' : String(n));

export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 0.1,
  optional = false,
  help,
  helpId,
  onCommit,
}: {
  id: string;
  label: string;
  /** A (?) after the label (needs a help index entry, Epic 44). */
  helpId?: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  optional?: boolean;
  help?: string;
  onCommit: (value: number | undefined) => void;
}) {
  const [text, setText] = React.useState(fmt(value));
  // Follow the element when it changes elsewhere (a keyboard nudge, undo, a drag).
  React.useEffect(() => setText(fmt(value)), [value]);

  function commit() {
    const trimmed = text.trim();
    if (trimmed === '' && optional) {
      if (value !== undefined) onCommit(undefined);
      return;
    }
    const n = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(n)) {
      setText(fmt(value)); // not a number: put the old one back
      return;
    }
    const clamped = Math.min(Math.max(n, min), max);
    setText(fmt(clamped));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <HelpHint helpId={helpId} />
      </span>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        aria-describedby={help ? `${id}-help` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
      {help ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}

function Choice<T extends string>({
  id,
  label,
  value,
  options,
  help,
  placeholder,
  onChange,
  onCloseAutoFocus,
}: {
  id: string;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  help?: string;
  placeholder?: string;
  onChange: (value: T) => void;
  /** Runs once the list has closed; `preventDefault()` keeps focus off the trigger. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span id={`${id}-label`} className="text-xs font-medium">
        {label}
      </span>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} aria-labelledby={`${id}-label`}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent onCloseAutoFocus={onCloseAutoFocus}>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

function ColourField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [colour, setColour] = React.useState(value);
  React.useEffect(() => setColour(value), [value]);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      {/* Commit when the picker closes, not on every drag inside it (each commit is an undo step). */}
      <input
        id={id}
        type="color"
        value={colour}
        className="h-8 w-full cursor-pointer rounded-md border border-input bg-card"
        onChange={(e) => setColour(e.target.value)}
        onBlur={() => colour !== value && onCommit(colour)}
      />
    </div>
  );
}

/** Fixed text as a sentence: commits on blur, and a field picker splices `{{key}}` in at the cursor
 * (one commit, so one undo step). The picker stays empty so the same field can be picked twice. */
function TextBlockField({
  id,
  label,
  value,
  fields,
  pickerLabel,
  pickerPlaceholder,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  fields: Array<{ value: string; label: string }>;
  pickerLabel: string;
  pickerPlaceholder: string;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = React.useState(value);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => setText(value), [value]);
  const insert = (fieldKey: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const token = `{{${fieldKey}}}`;
    const next = text.slice(0, start) + token + text.slice(end);
    setText(next);
    onCommit(next);
    caretAfterPick.current = start + token.length;
  };
  // Radix returns focus to the picker's trigger when its list closes, after the pick. Taking
  // focus in a requestAnimationFrame raced that (whichever ran last won, and the order differs
  // between jsdom versions and browsers), so hand focus to the textarea from the close itself.
  const caretAfterPick = React.useRef<number | null>(null);
  const focusTextareaAfterPick = (event: Event) => {
    const caret = caretAfterPick.current;
    const el = ref.current;
    if (caret === null || !el) return; // closed without picking: keep Radix's default
    caretAfterPick.current = null;
    event.preventDefault();
    el.focus();
    el.setSelectionRange(caret, caret);
  };
  return (
    // Commit when focus leaves the textarea AND its picker. Moving from the textarea to the picker
    // must not commit, or picking a field would cost two undo steps (typed text, then the insert).
    <div
      className="flex flex-col gap-2"
      onBlur={(e) => {
        const to = e.relatedTarget;
        if (e.currentTarget.contains(to) || to?.closest('[role=listbox]')) return;
        if (text !== value) onCommit(text);
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <Textarea
          id={id}
          ref={ref}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <Choice
        id={`${id}-insert`}
        label={pickerLabel}
        placeholder={pickerPlaceholder}
        value=""
        options={fields}
        onChange={insert}
        onCloseAutoFocus={focusTextareaAfterPick}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- the panel */

export function PropertiesPanel({
  element,
  kind,
  extraFonts = [],
  onChange,
}: PropertiesPanelProps) {
  const { t } = useTranslation('printEditor');

  if (!element) {
    return (
      <section aria-label={t('properties.title')} className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('properties.title')}</h2>
        <p role="status" className="text-sm text-muted-foreground">
          {t('properties.empty')}
        </p>
      </section>
    );
  }

  const key = element.id;
  const catalog = FIELD_CATALOG[kind] ?? [];
  const fieldOptions = (type: 'text' | 'image') =>
    catalog
      .filter((f) => f.type === type)
      .map((f) => ({
        value: f.key,
        label: `${fieldLabel(f.key)} — ${f.sample}`,
      }));

  const fieldLabel = (fieldKey: string) =>
    slotLabel(t, fieldKey) ?? t(`fields.${fieldKey}`, { defaultValue: fieldKey });

  const families = [...new Set([...BUNDLED_PRINT_FONTS.map((f) => f.family), ...extraFonts])];

  return (
    <section aria-label={t('properties.title')} className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">{t('properties.title')}</h2>

      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-1 text-xs font-medium">{t('properties.position')}</legend>
        <NumberField
          id={`${key}-x`}
          label={t('properties.x')}
          value={element.x}
          min={0}
          max={600}
          onCommit={(v) => onChange({ x: v })}
        />
        <NumberField
          id={`${key}-y`}
          label={t('properties.y')}
          value={element.y}
          min={0}
          max={600}
          onCommit={(v) => onChange({ y: v })}
        />
        <NumberField
          id={`${key}-w`}
          label={t('properties.w')}
          value={element.w}
          min={1}
          max={600}
          onCommit={(v) => onChange({ w: v })}
        />
        <NumberField
          id={`${key}-h`}
          label={t('properties.h')}
          value={element.h}
          min={1}
          max={600}
          onCommit={(v) => onChange({ h: v })}
        />
      </fieldset>

      {element.type === 'TEXT' ? (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium">{t('properties.content')}</legend>
            <RadioGroup
              value={element.field !== undefined ? 'field' : 'static'}
              onValueChange={(v) =>
                onChange(
                  v === 'field'
                    ? { text: undefined, field: fieldOptions('text')[0]?.value }
                    : { field: undefined, text: 'Text' },
                )
              }
            >
              {(['static', 'field'] as const).map((v) => (
                <div key={v} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem id={`${key}-source-${v}`} value={v} />
                  <label htmlFor={`${key}-source-${v}`}>{t(`properties.source.${v}`)}</label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          {element.field !== undefined ? (
            <Choice
              id={`${key}-field`}
              label={t('properties.field')}
              value={element.field}
              options={fieldOptions('text')}
              onChange={(field) => onChange({ field })}
            />
          ) : (
            <TextBlockField
              id={`${key}-text`}
              label={t('properties.text')}
              value={element.text ?? ''}
              fields={fieldOptions('text')}
              pickerLabel={t('properties.insertField')}
              pickerPlaceholder={t('properties.insertFieldPlaceholder')}
              onCommit={(text) => onChange({ text })}
            />
          )}

          <Choice
            id={`${key}-font`}
            label={t('properties.font')}
            value={element.fontFamily}
            options={[...new Set([...families, element.fontFamily])].map((f) => ({
              value: f,
              label: f,
            }))}
            onChange={(fontFamily) => onChange({ fontFamily })}
          />

          <div className="grid grid-cols-2 gap-2">
            <NumberField
              id={`${key}-size`}
              label={t('properties.size')}
              value={element.sizePt}
              min={4}
              max={96}
              step={0.5}
              onCommit={(v) => onChange({ sizePt: v })}
            />
            <NumberField
              id={`${key}-minsize`}
              label={t('properties.minSize')}
              value={element.minSizePt}
              min={4}
              max={96}
              step={0.5}
              optional
              help={t('properties.minSizeHelp')}
              onCommit={(v) => onChange({ minSizePt: v })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Choice
              id={`${key}-weight`}
              label={t('properties.weight')}
              value={String(element.weight)}
              options={(['400', '500', '600', '700'] as const).map((w) => ({
                value: w,
                label: t(`properties.weights.${w}`),
              }))}
              onChange={(w) => onChange({ weight: Number(w) })}
            />
            <Choice
              id={`${key}-align`}
              label={t('properties.align')}
              value={element.align}
              options={(['left', 'center', 'right'] as const).map((a) => ({
                value: a,
                label: t(`properties.aligns.${a}`),
              }))}
              onChange={(align) => onChange({ align })}
            />
          </div>

          <ColourField
            id={`${key}-colour`}
            label={t('properties.colour')}
            value={element.color}
            onCommit={(color) => onChange({ color })}
          />

          <Choice
            id={`${key}-overflow`}
            label={t('properties.overflow')}
            value={element.overflow}
            options={Object.values(OverflowPolicy).map((o) => ({
              value: o,
              label: t(`properties.overflowOptions.${o}.label`),
            }))}
            help={t(`properties.overflowOptions.${element.overflow}.help`)}
            onChange={(overflow) => onChange({ overflow })}
          />
        </div>
      ) : null}

      {element.type === 'IMAGE' ? (
        <div className="flex flex-col gap-3">
          {element.field !== undefined ? (
            <Choice
              id={`${key}-imgfield`}
              label={t('properties.image.field')}
              value={element.field}
              options={fieldOptions('image')}
              onChange={(field) => onChange({ field })}
            />
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Choice
              id={`${key}-fit`}
              label={t('properties.image.fit')}
              value={element.fit}
              options={(['COVER', 'CONTAIN'] as const).map((f) => ({
                value: f,
                label: t(`properties.image.fits.${f}`),
              }))}
              onChange={(fit) => onChange({ fit })}
            />
            <Choice
              id={`${key}-aligny`}
              label={t('properties.image.alignY')}
              value={element.alignY}
              options={(['top', 'center'] as const).map((a) => ({
                value: a,
                label: t(`properties.image.alignYOptions.${a}`),
              }))}
              onChange={(alignY) => onChange({ alignY })}
            />
          </div>
        </div>
      ) : null}

      {element.type === 'QR' ? (
        <p className="text-sm text-muted-foreground">{t('properties.qrNote')}</p>
      ) : null}

      {element.type === 'SHAPE' ? (
        <div className="flex flex-col gap-3">
          <Choice
            id={`${key}-shape`}
            label={t('properties.shape.kind')}
            value={element.shape}
            options={(['RECT', 'LINE'] as const).map((k) => ({
              value: k,
              label: t(`properties.shape.kinds.${k}`),
            }))}
            onChange={(shape) => onChange({ shape })}
          />
          <div className="grid grid-cols-2 gap-2">
            <ColourField
              id={`${key}-stroke`}
              label={t('properties.shape.stroke')}
              value={element.stroke ?? '#000000'}
              onCommit={(stroke) => onChange({ stroke })}
            />
            <div className="flex flex-col gap-1">
              <ColourField
                id={`${key}-fill`}
                label={t('properties.shape.fill')}
                value={element.fill ?? '#ffffff'}
                onCommit={(fill) => onChange({ fill })}
              />
              <div className="flex items-center gap-2 text-xs">
                <Checkbox
                  id={`${key}-nofill`}
                  checked={element.fill === undefined}
                  onCheckedChange={(next) =>
                    onChange({ fill: next === true ? undefined : '#ffffff' })
                  }
                />
                <label htmlFor={`${key}-nofill`}>{t('properties.shape.noFill')}</label>
              </div>
            </div>
            <NumberField
              id={`${key}-strokew`}
              label={t('properties.shape.strokeWidth')}
              value={element.strokeWidthMm}
              min={0}
              max={5}
              onCommit={(v) => onChange({ strokeWidthMm: v })}
            />
            <NumberField
              id={`${key}-radius`}
              label={t('properties.shape.radius')}
              value={element.radiusMm}
              min={0}
              max={20}
              onCommit={(v) => onChange({ radiusMm: v })}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
