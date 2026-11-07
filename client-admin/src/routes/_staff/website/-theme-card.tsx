/**
 * [40.2.04] One theme to pick in wizard step 2: its name and its default colour strip.
 * A pressed button, not a radio, so a phone user taps the whole card.
 */
import { CheckIcon } from 'lucide-react';

export interface ThemeCardProps {
  name: string;
  /** The theme's first palette, as a decorative strip. */
  colors: readonly string[];
  selected: boolean;
  onSelect: () => void;
}

export function ThemeCard({ name, colors, selected, onSelect }: ThemeCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={[
        'flex min-h-11 w-full flex-col gap-2 rounded-lg border bg-surface p-3 text-start outline-none sm:w-52',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected ? 'border-primary bg-secondary' : 'border-border-subtle',
      ].join(' ')}
    >
      <span aria-hidden="true" className="flex h-10 overflow-hidden rounded">
        {colors.map((c, i) => (
          <span key={i} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </span>
      <span className="flex items-center justify-between gap-2 text-sm font-medium">
        {name}
        {selected && <CheckIcon aria-hidden="true" className="size-4" />}
      </span>
    </button>
  );
}
