/**
 * Pick a colour set: a radio group where each option is a strip of the palette's colours and
 * its name. The strip is decorative; the name labels the option (D28). Radix gives arrow-key
 * movement and `aria-checked`.
 */
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';

import { cn } from '../primitives/lib/utils';

export interface PaletteOption {
  id: string;
  name: { bn: string; en: string };
  /** The palette's 5 colours, any CSS colour. */
  colors: readonly string[];
}

export interface PaletteSwatchesProps {
  palettes: readonly PaletteOption[];
  value: string | undefined;
  onChange: (id: string) => void;
  lang: 'bn' | 'en';
  label: string;
  className?: string;
}

export function PaletteSwatches({
  palettes,
  value,
  onChange,
  lang,
  label,
  className,
}: PaletteSwatchesProps) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value ?? null}
      onValueChange={onChange}
      data-slot="palette-swatches"
      className={cn('flex flex-wrap gap-3', className)}
    >
      {palettes.map((p) => (
        <RadioGroupPrimitive.Item
          key={p.id}
          value={p.id}
          className={cn(
            'flex min-h-11 w-40 flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3 text-start outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'data-[state=checked]:border-primary data-[state=checked]:bg-secondary',
          )}
        >
          <span aria-hidden="true" className="flex h-6 overflow-hidden rounded">
            {p.colors.map((c, i) => (
              <span key={i} className="flex-1" style={{ backgroundColor: c }} />
            ))}
          </span>
          <span className="text-sm font-medium">{p.name[lang]}</span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
