/**
 * A list of labelled radio rows, each with a title and an optional caption
 * line (e.g. a template list). Legend names the group; `legendHidden` keeps
 * it for screen readers only. Labels are props — no `useTranslation`.
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { HelpHint, useHelp } from './help-hint';
import { RadioGroup, RadioGroupItem } from './radio';

export interface RadioRowOption {
  value: string;
  title: string;
  caption?: string;
  disabled?: boolean;
}

export interface RadioRowsProps {
  value: string;
  onValueChange: (next: string) => void;
  options: RadioRowOption[];
  legend: string;
  legendHidden?: boolean;
  /**
   * A (?) beside the legend, outside it, so the group's name stays the legend alone.
   * Ignored with `legendHidden`: a (?) with no visible label beside it means nothing.
   */
  helpId?: string | undefined;
  className?: string;
}

export function RadioRows({
  value,
  onValueChange,
  options,
  legend,
  legendHidden = false,
  helpId,
  className,
}: RadioRowsProps) {
  const { resolve } = useHelp();
  const hasHint = !legendHidden && resolve(helpId) !== null;
  const baseId = React.useId();
  const legendId = `${baseId}-legend`;
  // The legend stays the fieldset's first child, so it names the fieldset natively (floated or
  // not). No aria-labelledby on the fieldset: that would make it and the radiogroup both match
  // a label query for the legend. With a (?), the legend's line box matches the icon's height
  // (44px on phones) so the text and the icon share one centre line.
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend
        id={legendId}
        className={cn(
          'mb-2 text-label',
          legendHidden && 'sr-only',
          hasHint && 'float-start me-1 flex min-h-11 items-center md:min-h-6',
        )}
      >
        {legend}
      </legend>
      {hasHint && <HelpHint helpId={helpId} label={legend} className="float-start" />}
      <RadioGroup
        value={value}
        onValueChange={onValueChange}
        aria-labelledby={legendId}
        className={hasHint ? 'clear-both' : undefined}
      >
        {options.map((option, i) => {
          const id = `${baseId}-${i}`;
          const selected = value === option.value;
          // Only the title is the <label> (the radio's name); the caption is its
          // description alone. The label's ::after covers the row so the whole
          // row still selects on click.
          return (
            <div
              key={option.value}
              className={cn(
                'relative flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3',
                selected ? 'border-primary bg-secondary' : 'border-border-functional bg-surface',
                option.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <RadioGroupItem
                id={id}
                value={option.value}
                disabled={option.disabled ?? false}
                {...(option.caption ? { 'aria-describedby': `${id}-caption` } : {})}
                className="mt-0.5"
              />
              <span className="flex min-w-0 flex-col">
                <label
                  htmlFor={id}
                  className={cn(
                    'font-medium after:absolute after:inset-0',
                    option.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                    selected && 'font-semibold text-secondary-foreground',
                  )}
                >
                  {option.title}
                </label>
                {option.caption && (
                  <span id={`${id}-caption`} className="text-caption text-text-secondary">
                    {option.caption}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
