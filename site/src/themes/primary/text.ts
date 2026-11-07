import type { Lang } from '../../lib/types';

/** The few strings only this theme's header needs; everything else comes from the shared `t()`. */
const TEXT = {
  bn: { menu: 'মেনু', portal: 'পোর্টালে লগইন', main: 'প্রধান মেনু' },
  en: { menu: 'Menu', portal: 'Portal login', main: 'Main menu' },
} as const;

export const tx = (lang: Lang, key: keyof (typeof TEXT)['bn']) => TEXT[lang][key];

/** The parent portal's address, from the container's own settings; no value, no button (https only). */
export function portalUrl(value: string | undefined): string | undefined {
  return value?.startsWith('https://') ? value : undefined;
}
