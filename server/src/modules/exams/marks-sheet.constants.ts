export type SheetLang = 'en' | 'bn';

/** Header text for the fixed columns, in both languages (D4: the parser accepts either). */
export const SHEET_HEADERS = {
  roll: { en: 'Roll', bn: 'রোল' },
  name: { en: 'Name', bn: 'নাম' },
  key: { en: 'Student key', bn: 'ছাত্র কী' },
  total: { en: 'Total', bn: 'মোট' },
} as const;

/** Cell codes, compared upper-cased (D2). */
export const ABSENT_CODES = ['A', 'AB', 'অ', 'অনু'] as const;
export const EXEMPT_CODES = ['E', 'EX', 'ছাড়'] as const;

export const MARKS_TAB = { en: 'Marks', bn: 'নম্বর' } as const;
export const HOWTO_TAB = { en: 'How to fill', bn: 'কীভাবে পূরণ করবেন' } as const;

export const LEGEND = {
  absent: { en: 'A = absent', bn: 'A = অনুপস্থিত' },
  exempt: { en: 'E = exempt', bn: 'E = অব্যাহতি' },
} as const;

const HOWTO = {
  en: [
    'Fill only the white cells.',
    'A blank cell means unchanged.',
    'A = absent, E = exempt.',
    'Do not touch the grey columns.',
    'Upload the same file back.',
  ],
  bn: [
    'শুধু সাদা ঘরগুলো পূরণ করুন।',
    'ঘর ফাঁকা থাকলে নম্বর অপরিবর্তিত থাকবে।',
    'A = অনুপস্থিত, E = অব্যাহতি।',
    'ধূসর কলামগুলোতে হাত দেবেন না।',
    'একই ফাইলটি আবার আপলোড করুন।',
  ],
} as const;

export function howToLines(lang: SheetLang): readonly string[] {
  return HOWTO[lang];
}
