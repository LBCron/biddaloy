/**
 * [8.15.39] Colour rules written as sentences: "যদি [বকেয়া] [বেশি] [৫,০০০] হয় → লাল".
 *
 * ```
 *  রং দিয়ে চেনান
 *   যদি [ বাকি v ] [ বেশি v ] [ ৫,০০০ ] হয়   [ ▲ লাল v ]   (x)
 *   + আরেকটি নিয়ম যোগ করুন
 * ```
 *
 * It edits a definition's `format` (`ReportFormatRule[]` in `@biddaloy/shared`). The sentence is
 * the same one `FilterBuilder` writes (`ConditionEditor`), so it follows the same type rules. A
 * tone is never colour alone: each one has its own icon and a word, from the status tokens
 * `StatusBadge` uses (good = green and a tick, warn = yellow and a clock, bad = red and a
 * triangle, muted = grey and a dash).
 *
 * Props only. A rule's `field` is the field in its sentence, so `field` and `when.field` always agree.
 */
import type { ReportFilter, ReportFormatRule } from '@biddaloy/shared';
import { CircleCheck, CircleMinus, Clock, Plus, Trash2, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../primitives/lib/utils';
import { Button } from '../button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';

import type { DesignerField } from './field-picker';
import { ConditionEditor, type ConditionLabels, type EnumLabel } from './filter-builder';

export type FormatTone = ReportFormatRule['style']['tone'];

export const FORMAT_TONES: Record<
  FormatTone,
  { fg: string; bg: string; icon: React.ComponentType<{ className?: string }> }
> = {
  good: { fg: 'text-status-paid-fg', bg: 'bg-status-paid-bg', icon: CircleCheck },
  warn: { fg: 'text-status-due-fg', bg: 'bg-status-due-bg', icon: Clock },
  bad: { fg: 'text-status-overdue-fg', bg: 'bg-status-overdue-bg', icon: TriangleAlert },
  muted: { fg: 'text-text-secondary', bg: 'bg-muted', icon: CircleMinus },
};

export interface FormatRulesLabels extends ConditionLabels {
  title: string;
  add: string;
  remove: string;
  empty: string;
  if: string;
  then: string;
  tone: string;
  tones: Record<FormatTone, string>;
}

export interface FormatRulesEditorProps {
  rules: ReportFormatRule[];
  /** Fields and measures a rule may look at. */
  fields: DesignerField[];
  onChange: (rules: ReportFormatRule[]) => void;
  labels: FormatRulesLabels;
  enumLabel?: EnumLabel;
  className?: string;
}

export function FormatRulesEditor({
  rules,
  fields,
  onChange,
  labels,
  enumLabel,
  className,
}: FormatRulesEditorProps) {
  const baseId = React.useId();

  function put(index: number, rule: ReportFormatRule) {
    onChange(rules.map((r, i) => (i === index ? rule : r)));
  }

  function setWhen(index: number, when: ReportFilter) {
    put(index, { ...rules[index]!, field: when.field, when });
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <h3 id={`${baseId}-title`} className="text-h3 text-text-primary">
        {labels.title}
      </h3>
      {rules.length === 0 ? (
        <p className="text-body text-text-secondary">{labels.empty}</p>
      ) : (
        <ul aria-labelledby={`${baseId}-title`} className="flex flex-col gap-3">
          {rules.map((rule, index) => {
            const tone = FORMAT_TONES[rule.style.tone];
            return (
              <li
                key={`${index}-${rule.when.field}`}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-surface p-3"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
                  <ConditionEditor
                    condition={rule.when}
                    fields={fields}
                    onChange={(when) => setWhen(index, when)}
                    labels={labels}
                    {...(enumLabel ? { enumLabel } : {})}
                    lead={labels.if}
                    trail={labels.then}
                  />
                  <span aria-hidden="true" className="pt-1.5 text-text-secondary">
                    →
                  </span>
                  <Select
                    value={rule.style.tone}
                    onValueChange={(next) =>
                      put(index, { ...rule, style: { tone: next as FormatTone } })
                    }
                  >
                    <SelectTrigger
                      aria-label={labels.tone}
                      className={cn('w-36', tone.bg, tone.fg)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FORMAT_TONES) as FormatTone[]).map((key) => {
                        const ToneIcon = FORMAT_TONES[key].icon;
                        return (
                          <SelectItem key={key} value={key}>
                            <span className="inline-flex items-center gap-2">
                              <ToneIcon aria-hidden="true" className="size-4" />
                              {labels.tones[key]}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  iconOnly
                  aria-label={labels.remove}
                  onClick={() => onChange(rules.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange([
              ...rules,
              { field: '', when: { field: '', op: 'EQ' }, style: { tone: 'bad' } },
            ])
          }
        >
          <Plus aria-hidden="true" />
          {labels.add}
        </Button>
      </div>
    </div>
  );
}
