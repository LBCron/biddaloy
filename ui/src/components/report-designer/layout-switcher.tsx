/**
 * [8.15.39] Four big picture buttons for how a report looks, with the suggested one chosen for the
 * person and a one-line reason ("দুটি ভাগ বেছেছেন, তাই সারি-কলামের ছক দেখানো হচ্ছে").
 *
 * ```
 *  কেমন দেখাবে
 *  ( ≡ তালিকা )  ( ▤ দলভিত্তিক )  ( ▦ ছক ✓ প্রস্তাবিত )  ( ↗ চার্ট )
 *  দুটি ভাগ বেছেছেন, তাই সারি-কলামের ছক দেখানো হচ্ছে
 * ```
 *
 * A manual choice is always allowed. When it differs from the suggestion the reason gives way to
 * "আপনি নিজে বেছে নিয়েছেন" and a button that goes back to the suggestion. The four buttons are
 * native radio buttons, so arrow keys, Tab and Space work without any script.
 *
 * Props only. `suggestion` comes from `suggestLayout()`; the screen keeps `value` equal to it until
 * the person chooses another.
 */
import type { ReportLayoutType } from '@biddaloy/shared';
import { Check, ChartLine, Grid3x3, List, Rows3, Sparkles, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../primitives/lib/utils';
import { Button } from '../button';

import type { LayoutReason, LayoutSuggestion } from './suggest-layout';

export interface LayoutSwitcherLabels {
  title: string;
  suggested: string;
  manual: string;
  backToSuggestion: string;
  options: Record<ReportLayoutType, string>;
  hints: Record<ReportLayoutType, string>;
  reasons: Record<LayoutReason, string>;
}

export const LAYOUT_CHOICES: readonly { type: ReportLayoutType; icon: LucideIcon }[] = [
  { type: 'TABLE', icon: List },
  { type: 'GROUPED', icon: Rows3 },
  { type: 'CROSSTAB', icon: Grid3x3 },
  { type: 'CHART', icon: ChartLine },
];

export interface LayoutSwitcherProps {
  value: ReportLayoutType;
  onChange: (layout: ReportLayoutType) => void;
  suggestion: LayoutSuggestion;
  labels: LayoutSwitcherLabels;
  className?: string;
}

export function LayoutSwitcher({
  value,
  onChange,
  suggestion,
  labels,
  className,
}: LayoutSwitcherProps) {
  const name = React.useId();
  const following = value === suggestion.layout;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-h3 text-text-primary">{labels.title}</legend>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {LAYOUT_CHOICES.map(({ type, icon: Icon }) => {
            const chosen = value === type;
            return (
              <label
                key={type}
                className={cn(
                  'relative flex min-h-24 cursor-pointer flex-col items-center gap-1 rounded-lg border p-3 text-center has-focus-visible:ring-2 has-focus-visible:ring-ring',
                  chosen
                    ? 'border-primary bg-secondary text-secondary-foreground'
                    : 'border-border bg-surface text-text-primary hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={type}
                  checked={chosen}
                  onChange={() => onChange(type)}
                  className="peer sr-only"
                />
                <Icon aria-hidden="true" className="size-8" />
                <span className="text-label font-medium">{labels.options[type]}</span>
                <span className="text-caption text-text-secondary">{labels.hints[type]}</span>
                {suggestion.layout === type && (
                  <span className="inline-flex items-center gap-1 text-caption font-medium text-primary">
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    {labels.suggested}
                  </span>
                )}
                {chosen && (
                  <Check aria-hidden="true" className="absolute end-2 top-2 size-4 text-primary" />
                )}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div
        role="status"
        className="flex flex-wrap items-center gap-2 text-body text-text-secondary"
      >
        {following ? (
          <p>{labels.reasons[suggestion.reason]}</p>
        ) : (
          <>
            <p>{labels.manual}</p>
            <Button type="button" variant="ghost" onClick={() => onChange(suggestion.layout)}>
              {labels.backToSuggestion}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
