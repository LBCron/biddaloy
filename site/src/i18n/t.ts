import bn from './bn.json';
import en from './en.json';
import type { Lang } from '../lib/types';

const DICT = { bn, en } as const;

/** Chrome strings only (nav, errors); school content never lives in these files. Missing en -> bn. */
export function t(lang: Lang, key: string): string {
  const look = (d: unknown) =>
    key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], d);
  const v = look(DICT[lang]) ?? look(DICT.bn);
  return typeof v === 'string' ? v : key;
}
