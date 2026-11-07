/**
 * [76.4.04] The two register badges: "Scanned 07:55" (a card reader marked the row) and
 * "From sheet" (the row came from an uploaded sheet). Each is focusable and carries a tooltip.
 * Text comes in as props; the time goes through `formatTime`. Renders nothing when neither applies.
 * Brings its own `TooltipProvider`: the app shell has none, and Radix throws without one.
 * The time uses the nearest `RegionConfigProvider`, so the page must wrap one (tenant region).
 */
import { ScanLine, Table2 } from 'lucide-react';
import * as React from 'react';

import { useRegionConfig } from '../i18n';
import { formatTime } from '../utils/date';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

export interface AttendanceMarkBadgesProps {
  scanned_at?: string | null | undefined;
  source?: string | null | undefined;
  /** Gets the formatted time, e.g. the app's "Scanned {{time}}" string. */
  scannedLabel: (time: string) => string;
  scannedHint: string;
  fromSheetLabel: string;
  fromSheetHint: string;
}

function Pill({
  icon: Icon,
  label,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // Focusable on purpose: keyboard users reach the tooltip text.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-text-secondary focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Icon className="size-3" aria-hidden />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

export function AttendanceMarkBadges({
  scanned_at,
  source,
  scannedLabel,
  scannedHint,
  fromSheetLabel,
  fromSheetHint,
}: AttendanceMarkBadgesProps) {
  const config = useRegionConfig();
  const fromSheet = source === 'IMPORT';
  if (!scanned_at && !fromSheet) return null;
  return (
    <TooltipProvider>
      <span className="inline-flex flex-wrap items-center gap-1">
        {scanned_at ? (
          <Pill
            icon={ScanLine}
            label={scannedLabel(formatTime(scanned_at, config))}
            hint={scannedHint}
          />
        ) : null}
        {fromSheet ? <Pill icon={Table2} label={fromSheetLabel} hint={fromSheetHint} /> : null}
      </span>
    </TooltipProvider>
  );
}
