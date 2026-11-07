import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../primitives/lib/utils';
import { Card } from '../card';

import { SIGNAL, type SignalLevel } from './signal';

/**
 * [169.1-02] Phone KPI tile (also the committee desktop KPI row). Trend is
 * icon + text, never colour alone. Presentational; strings arrive formatted.
 */
export interface StatTileProps {
  label: string;
  value: string;
  trend?: { direction: 'up' | 'down' | 'flat'; text: string; tone?: 'neutral' | 'good' | 'bad' };
  /** Caption without an icon, e.g. "guardians". */
  note?: string;
  /** Priority/health accent (#3594): coloured number + icon. Unset/`neutral` = as before. */
  signal?: SignalLevel;
  /** Translated level text for screen readers. */
  signalLabel?: string;
  /** Sparkline or Meter. With `asChild`: the single link element (its children fill this slot). */
  children?: React.ReactNode;
  /** Wrap a router Link, like Card's asChild. */
  asChild?: boolean;
  className?: string;
}

const ICON = { up: TrendingUpIcon, down: TrendingDownIcon, flat: MinusIcon } as const;
const TONE = {
  neutral: 'text-text-secondary',
  good: 'text-status-paid-fg',
  bad: 'text-status-overdue-fg',
} as const;

export function StatTile({
  label,
  value,
  trend,
  note,
  signal,
  signalLabel,
  children,
  asChild,
  className,
}: StatTileProps) {
  const sig = signal && signal !== 'neutral' ? SIGNAL[signal] : null;
  const Icon = trend ? ICON[trend.direction] : null;
  const tile = (extra: React.ReactNode) => (
    <>
      <span className="truncate text-label text-text-secondary">{label}</span>
      <span
        data-signal={sig ? signal : undefined}
        className={cn('flex items-center gap-2 text-h1 tabular-nums', sig?.text)}
      >
        {sig ? <sig.Icon aria-hidden="true" className="size-5 shrink-0" /> : null}
        {value}
        {sig && signalLabel ? <span className="sr-only">{signalLabel}</span> : null}
      </span>
      {trend && Icon ? (
        <span className={cn('flex items-center gap-1 text-caption', TONE[trend.tone ?? 'neutral'])}>
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          <span>{trend.text}</span>
        </span>
      ) : null}
      {note ? <span className="text-caption text-text-secondary">{note}</span> : null}
      {extra}
    </>
  );
  const cls = cn('flex min-w-0 flex-col p-3', className);
  // asChild: the single child is the link; its own children become the
  // sparkline/meter slot below the tile text.
  if (asChild && React.isValidElement<{ children?: React.ReactNode }>(children)) {
    return (
      <Card asChild className={cls}>
        {React.cloneElement(children, undefined, tile(children.props.children))}
      </Card>
    );
  }
  return <Card className={cls}>{tile(children)}</Card>;
}
