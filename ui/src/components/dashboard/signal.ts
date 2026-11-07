import { CircleCheckIcon, ClockIcon, MinusIcon, TriangleAlertIcon } from 'lucide-react';

/**
 * [#3594] Dashboard signal level (epic #3592, D3/D13). Colour comes from the
 * `signal` token family (tailwind.preset.ts); the icon mirrors `signal.<key>.icon`
 * so colour is never the only cue (D8). Class strings are literal so Tailwind sees them.
 */
export type SignalLevel = 'critical' | 'warn' | 'ok' | 'neutral';

export const SIGNAL: Record<
  SignalLevel,
  { Icon: typeof MinusIcon; text: string; bar: string; band: string }
> = {
  critical: {
    Icon: TriangleAlertIcon,
    text: 'text-signal-critical-fg',
    bar: 'border-s-[3px] border-s-signal-critical-fg',
    band: 'bg-signal-critical-bg',
  },
  warn: {
    Icon: ClockIcon,
    text: 'text-signal-warn-fg',
    bar: 'border-s-[3px] border-s-signal-warn-fg',
    band: '',
  },
  ok: {
    Icon: CircleCheckIcon,
    text: 'text-signal-ok-fg',
    bar: 'border-s-[3px] border-s-signal-ok-fg',
    band: '',
  },
  neutral: { Icon: MinusIcon, text: 'text-signal-neutral-fg', bar: '', band: '' },
};
