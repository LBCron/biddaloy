/**
 * [169] The top banner of every staff dashboard: "N things need you today,
 * most urgent: X". The one place on the page with a filled button (the
 * caller passes it as `action`). Pure presentational; strings arrive
 * translated. Desktop shows the other items as chips; phone hides them
 * behind one disclosure (same list, never rendered twice).
 */
import { ChevronDownIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from '../../primitives/lib/utils';
import { Skeleton } from '../skeleton';

import { SIGNAL, type SignalLevel } from './signal';

export interface BriefingLineProps {
  /** "Good morning! 4 things need your attention today" */
  headline: string;
  /** "Most urgent: attendance not taken in 3 sections." */
  mostUrgent?: string;
  /** Level of the most urgent item (#3594, D12): icon + colour, same scale as widgets. */
  signal?: SignalLevel;
  /** Translated level text for screen readers. */
  signalLabel?: string;
  /** ONE primary Button (asChild Link) — the page's only filled button. */
  action?: React.ReactNode;
  /** `BriefingChip` elements for the other items. */
  items?: React.ReactNode;
  /** Desktop label before the chips, e.g. "Also:". */
  itemsLabel?: string;
  /** Phone disclosure label, e.g. "3 more things". Required with `items`. */
  moreLabel?: string;
  /** Decorative icon (aria-hidden). */
  icon?: React.ReactNode;
  /** Small trailing note, e.g. "Updated 9:00". */
  caption?: string;
  loading?: boolean;
  loadingLabel?: string;
}

export function BriefingChip({
  icon,
  children,
  asChild = false,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : 'span';
  return (
    <li>
      <Comp className="inline-flex h-11 items-center gap-2 rounded-full bg-surface px-3 text-label text-foreground focus-visible:ring-2 focus-visible:ring-ring md:h-8">
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        <Slot.Slottable>{children}</Slot.Slottable>
      </Comp>
    </li>
  );
}

export function BriefingLine({
  headline,
  mostUrgent,
  signal,
  signalLabel,
  action,
  items,
  itemsLabel,
  moreLabel,
  icon,
  caption,
  loading = false,
  loadingLabel,
}: BriefingLineProps) {
  const uid = React.useId();
  const [open, setOpen] = React.useState(false);
  const sig = signal && signal !== 'neutral' ? SIGNAL[signal] : null;

  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite">
        {loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  const headingId = `${uid}-h`;
  const listId = `${uid}-items`;

  return (
    <section aria-labelledby={headingId} className="rounded-lg bg-secondary p-4 md:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {sig ? (
            <span
              data-signal={signal}
              className={cn(
                'inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface',
                sig.text,
              )}
            >
              <sig.Icon aria-hidden="true" className="size-5" />
              {signalLabel ? <span className="sr-only">{signalLabel}</span> : null}
            </span>
          ) : icon ? (
            <span
              aria-hidden="true"
              className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-surface md:inline-flex"
            >
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 id={headingId} className="text-h2">
              {headline}
            </h2>
            {mostUrgent ? <p className="text-body-lg">{mostUrgent}</p> : null}
            {caption ? <p className="text-label text-muted-foreground">{caption}</p> : null}
          </div>
        </div>
        {action ? (
          <div className="w-full shrink-0 lg:w-auto [&>*]:h-11 [&>*]:w-full lg:[&>*]:w-auto">
            {action}
          </div>
        ) : null}
      </div>
      {items ? (
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          {itemsLabel ? (
            <span className="hidden text-label text-muted-foreground md:inline">{itemsLabel}</span>
          ) : null}
          {moreLabel ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((o) => !o)}
              className="inline-flex h-11 items-center justify-between gap-2 rounded-md px-1 text-label focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              {moreLabel}
              <ChevronDownIcon aria-hidden="true" className={cn('size-4', open && 'rotate-180')} />
            </button>
          ) : null}
          <ul
            id={listId}
            className={cn('flex-wrap gap-2', open || !moreLabel ? 'flex' : 'hidden md:flex')}
          >
            {items}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
