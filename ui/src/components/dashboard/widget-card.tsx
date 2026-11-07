import { ChevronDownIcon, EllipsisVerticalIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../primitives/lib/utils';
import { Button } from '../button';
import { Card } from '../card';
import { HelpHint } from '../help-hint';
import { Menu, MenuContent, MenuTrigger } from '../menu';
import { Skeleton } from '../skeleton';

import { SIGNAL, type SignalLevel } from './signal';

/** [44.2.02] WidgetSlot sets this to `widget.<key>`, so no widget file passes a help id (E23). */
export const WidgetHelpContext = React.createContext<string | null>(null);

/**
 * [169.1-02] Frame of every dashboard widget: full (desktop) and compact
 * (phone, tap to expand), with loading / error / empty states (D15, D16).
 * Presentational — every string arrives translated and formatted. The title
 * stays visible in every state so one failing card never reflows its
 * neighbours. Priority: loading > error > empty > content.
 */
export interface WidgetCardProps {
  title: string;
  /** Priority/health accent (#3594). Unset or `neutral` renders exactly as before. */
  signal?: SignalLevel;
  /** Translated level text, read by screen readers beside the icon. Required with `signal`. */
  signalLabel?: string;
  /** Help id of the (?) beside the title; defaults to `WidgetHelpContext`. */
  helpId?: string;
  variant?: 'full' | 'compact';
  headingLevel?: 2 | 3;
  updatedLabel?: string;
  /** Already formatted, e.g. "91.4%". */
  value?: string;
  unit?: string;
  summary?: string;
  /** `MenuItem` elements; omitted = no ⋮ button. */
  menu?: React.ReactNode;
  /** aria-label of ⋮, required when `menu` is set. */
  menuLabel?: string;
  /** Link left / ChartTableToggle trigger right. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  error?: { message: string; retryLabel: string; onRetry: () => void };
  empty?: { reason: string; action?: React.ReactNode };
  /** Compact only (compact also ignores `menu`, `updatedLabel`, `unit`). Controlled when `expanded` is given. */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
  className?: string;
}

export function WidgetCard({
  title,
  signal,
  signalLabel,
  helpId,
  variant = 'full',
  headingLevel = 2,
  updatedLabel,
  value,
  unit,
  summary,
  menu,
  menuLabel,
  footer,
  children,
  loading = false,
  loadingLabel,
  error,
  empty,
  expanded,
  defaultExpanded,
  onExpandedChange,
  className,
}: WidgetCardProps) {
  const id = React.useId();
  const ctxHelpId = React.useContext(WidgetHelpContext);
  // Labelled with the card title: every widget shares one guide page, so its title would repeat (WCAG 2.4.6).
  const helpEl = <HelpHint size="sm" helpId={helpId ?? ctxHelpId} label={title} />;
  const [inner, setInner] = React.useState(defaultExpanded ?? false);
  const open = expanded ?? inner;
  const sig = signal && signal !== 'neutral' ? SIGNAL[signal] : null;
  const sigEl = sig ? (
    <span className={cn('inline-flex shrink-0 items-center', sig.text)}>
      <sig.Icon aria-hidden="true" className="size-4" />
      {signalLabel ? <span className="sr-only">{signalLabel}</span> : null}
    </span>
  ) : null;
  const Heading: 'h2' | 'h3' = headingLevel === 3 ? 'h3' : 'h2';

  const body = loading ? (
    <div aria-busy="true" className="flex min-h-40 flex-col gap-2">
      {loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="w-full flex-1 rounded-lg" />
    </div>
  ) : error ? (
    <div className="flex min-h-40 flex-col items-start gap-3">
      <p role="alert" className="text-destructive">
        {error.message}
      </p>
      <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" onClick={error.onRetry}>
        {error.retryLabel}
      </Button>
    </div>
  ) : empty ? (
    <div className="flex min-h-40 flex-col items-start gap-3">
      <p className="text-text-secondary">{empty.reason}</p>
      {empty.action}
    </div>
  ) : (
    children
  );

  const footerEl = footer ? (
    <div className="mt-auto flex items-center justify-between gap-2 pt-3">{footer}</div>
  ) : null;

  if (variant === 'compact') {
    const toggle = () => {
      const next = !open;
      if (expanded === undefined) setInner(next);
      onExpandedChange?.(next);
    };
    return (
      <Card asChild className={cn('flex flex-col', sig?.bar, className)}>
        <section aria-labelledby={id}>
          <div className="flex items-center">
            <Heading id={id} className="m-0 min-w-0 flex-1">
              <button
                type="button"
                aria-expanded={open}
                onClick={toggle}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg p-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  {sig ? (
                    <span className="flex items-center gap-1 text-label text-text-secondary">
                      {sigEl}
                      <span className="truncate">{title}</span>
                    </span>
                  ) : (
                    <span className="truncate text-label text-text-secondary">{title}</span>
                  )}
                  {value ? <span className="text-h2 tabular-nums">{value}</span> : null}
                  {summary ? (
                    <span className="text-caption text-text-secondary">{summary}</span>
                  ) : null}
                  {/* Collapsed: the body is hidden, so surface loading/error here (retry lives in the body). */}
                  {!open && loading && loadingLabel ? (
                    <span aria-busy="true" className="text-caption text-text-secondary">
                      {loadingLabel}
                    </span>
                  ) : null}
                  {!open && !loading && error ? (
                    <span className="text-caption text-destructive">{error.message}</span>
                  ) : null}
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={cn(
                    'size-5 shrink-0 motion-safe:transition-transform',
                    open && 'rotate-180',
                  )}
                />
              </button>
            </Heading>
            {helpEl}
          </div>
          {open ? (
            <div className="flex flex-col px-3 pb-3">
              {body}
              {footerEl}
            </div>
          ) : null}
        </section>
      </Card>
    );
  }

  return (
    <Card asChild padded className={cn('flex h-full flex-col', sig?.bar, className)}>
      <section aria-labelledby={id}>
        <div
          className={cn(
            'flex items-start justify-between gap-2',
            sig?.band && `-mx-2 rounded-md px-2 py-1 ${sig.band}`,
          )}
        >
          {/* Beside (not inside) the heading: the section's accessible name stays just the title. */}
          {sigEl}
          <Heading id={id} className="me-auto text-h3">
            {title}
          </Heading>
          {helpEl}
          {menu ? (
            <Menu>
              <MenuTrigger asChild>
                <Button
                  variant="ghost"
                  iconOnly
                  aria-label={menuLabel ?? title}
                  className="size-11 md:size-8"
                >
                  <EllipsisVerticalIcon aria-hidden="true" />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">{menu}</MenuContent>
            </Menu>
          ) : null}
        </div>
        {updatedLabel ? <p className="text-caption text-text-secondary">{updatedLabel}</p> : null}
        {value ? (
          <p className="flex items-baseline gap-2">
            <span className="text-hero tabular-nums">{value}</span>
            {unit ? <span className="text-h2 text-text-secondary">{unit}</span> : null}
          </p>
        ) : null}
        {summary ? <p className="text-text-secondary">{summary}</p> : null}
        <div className="mt-3 flex flex-1 flex-col">{body}</div>
        {footerEl}
      </section>
    </Card>
  );
}
