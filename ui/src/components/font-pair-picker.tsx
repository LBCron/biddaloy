/**
 * Pick a heading + body font pair. Each option shows the sample text in its own fonts, heading
 * and body on one row (D29). Font files come from the option's URLs.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export interface FontFaceSource {
  family: string;
  /** woff2 URL. */
  url: string;
}

export interface FontPairOption {
  id: string;
  heading: FontFaceSource;
  body: FontFaceSource;
}

export interface FontPairPickerProps {
  options: readonly FontPairOption[];
  value: string | undefined;
  onChange: (id: string) => void;
  lang: 'bn' | 'en';
  label: string;
  className?: string;
}

const SAMPLE = { bn: 'আমাদের বিদ্যালয়', en: 'Our school' } as const;

/** Family names and URLs come from the theme manifest; quote/paren chars are stripped anyway. */
const safe = (s: string) => s.replace(/["'()\\;{}]/g, '');

function faces(options: readonly FontPairOption[]): string {
  const seen = new Set<string>();
  for (const o of options)
    for (const f of [o.heading, o.body])
      seen.add(
        `@font-face{font-family:"${safe(f.family)}";src:url("${safe(f.url)}") format("woff2");font-display:swap}`,
      );
  return [...seen].join('');
}

export function FontPairPicker({
  options,
  value,
  onChange,
  lang,
  label,
  className,
}: FontPairPickerProps) {
  const sample = (o: FontPairOption) => (
    <span className="flex items-baseline gap-3">
      <span style={{ fontFamily: `"${o.heading.family}"` }} className="text-base font-bold">
        {SAMPLE[lang]}
      </span>
      <span style={{ fontFamily: `"${o.body.family}"` }} className="text-sm">
        {SAMPLE[lang]}
      </span>
    </span>
  );
  return (
    <div data-slot="font-pair-picker" className={className}>
      <style>{faces(options)}</style>
      <Select {...(value !== undefined ? { value } : {})} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {sample(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
