/**
 * [76.4.04] The card-number field with a "Scan card" button, shared by the student form, the
 * staff tab and any other place that links a card. A keyboard-wedge reader types the number and
 * usually sends Enter; that Enter is swallowed so it never submits the host form (D10).
 *
 * All text comes in as props — the host reads it from its own i18n namespace.
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { Button } from './button';
import { Input } from './input';
import { Label } from './label';

/** Letters, digits and hyphen only. */
const INVALID_CHARS = /[^A-Za-z0-9-]/g;
export const CARD_NO_MAX_LENGTH = 64;

export interface ScanCardFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  scanLabel: string;
  /** Shown (and announced) after "Scan card" is pressed, e.g. "Tap the card on the reader". */
  scanHint: string;
  error?: string | undefined;
  /** Guide help id; renders the (?) beside the label. */
  helpId?: string | undefined;
  autoFocus?: boolean | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  className?: string | undefined;
  /** The host form's field id (error summary links and focus target here); generated if absent. */
  id?: string | undefined;
  /** The host form's ref (React Hook Form focuses the field after a failed submit). */
  inputRef?: React.Ref<HTMLInputElement> | undefined;
  /** The host form's blur handler (touched state). */
  onBlur?: (() => void) | undefined;
}

export function ScanCardField({
  value,
  onChange,
  label,
  scanLabel,
  scanHint,
  error,
  helpId,
  autoFocus,
  disabled,
  name,
  className,
  id: idProp,
  inputRef: hostRef,
  onBlur,
}: ScanCardFieldProps) {
  const generatedId = React.useId();
  const id = idProp ?? generatedId;
  const errorId = `${id}-error`;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const setInputRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof hostRef === 'function') hostRef(node);
      else if (hostRef) hostRef.current = node;
    },
    [hostRef],
  );
  const [scanning, setScanning] = React.useState(false);

  return (
    <div className={cn('grid w-full min-w-0 gap-1.5', className)}>
      <Label htmlFor={id} helpId={helpId}>
        {label}
      </Label>
      <div className="flex gap-2">
        <Input
          ref={setInputRef}
          id={id}
          name={name}
          value={value}
          maxLength={CARD_NO_MAX_LENGTH}
          // The host asks for it (`?focus=card` deep link).
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          disabled={disabled}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value.replace(INVALID_CHARS, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setScanning(false);
            }
          }}
          onBlur={() => {
            setScanning(false);
            onBlur?.();
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            inputRef.current?.focus();
            setScanning(true);
          }}
        >
          {scanLabel}
        </Button>
      </div>
      <p role="status" className="text-sm text-text-secondary empty:hidden">
        {scanning ? scanHint : null}
      </p>
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
