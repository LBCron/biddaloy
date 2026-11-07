/**
 * Pick a heading + body font pair. Each option shows the sample text in its own fonts, heading
 * and body on one row (D29). Font files come from the option's URLs.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export interface FontFaceSource {
  family: string;
  /** woff2 URL: a relative path or https. */
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

/** Family: letters, digits, space, dot, dash, underscore only. Empty result drops the option. */
const family = (s: string) => s.replace(/[^\w .-]/g, '').trim();

/**
 * URL: a same-origin relative path or https only, and nothing that can leave a CSS string or
 * `url()`. Anything else returns null and the whole option is dropped.
 */
function safeUrl(s: string): string | null {
  if (!/^(\/(?!\/)|https:\/\/)[\w\-./%:@~+]+$/.test(s)) return null;
  return s;
}

interface Clean {
  id: string;
  heading: { family: string; url: string };
  body: { family: string; url: string };
}

/** The one sanitiser: both the `@font-face` text and the inline `fontFamily` read its output. */
function clean(options: readonly FontPairOption[]): Clean[] {
  const out: Clean[] = [];
  for (const o of options) {
    const h = { family: family(o.heading.family), url: safeUrl(o.heading.url) };
    const b = { family: family(o.body.family), url: safeUrl(o.body.url) };
    if (h.family && b.family && h.url && b.url) {
      out.push({
        id: o.id,
        heading: { family: h.family, url: h.url },
        body: { family: b.family, url: b.url },
      });
    }
  }
  return out;
}

function faces(options: readonly Clean[]): string {
  const seen = new Set<string>();
  for (const o of options)
    for (const f of [o.heading, o.body])
      seen.add(
        `@font-face{font-family:"${f.family}";src:url("${f.url}") format("woff2");font-display:swap}`,
      );
  return [...seen].join('');
}

export function FontPairPicker({
  options: raw,
  value,
  onChange,
  lang,
  label,
  className,
}: FontPairPickerProps) {
  const options = clean(raw);
  const sample = (o: Clean) => (
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
