import type { BilingualText, Lang } from './types';

/** English only when asked for and present; otherwise Bangla; otherwise nothing (D8). */
/** `pick` for an untyped `data[field]` value. */
export const field = (v: unknown, lang: Lang) => pick(v as BilingualText | undefined, lang);

export function pick(text: BilingualText | undefined | null, lang: Lang): string | undefined {
  return (lang === 'en' && text?.en ? text.en : text?.bn) || undefined;
}
