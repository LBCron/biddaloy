export type SheetLang = 'en' | 'bn';

/** Hidden header cell `sheet:<exam_id>:<section_id>:<subject_id>`: the only thing that ties a sheet to its grid. */
export const SHEET_ID_PREFIX = 'sheet:';

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

/** One canonical form for cell codes: trimmed, NFD (so Bangla ড় typed as U+09DC and as
 * U+09A1 U+09BC collapse to the same string), upper-cased. Apply to BOTH sides of a compare. */
export function canon(s: string): string {
  return s.trim().normalize('NFD').toUpperCase();
}

/** Cells starting with one of these are read as formulas by spreadsheet apps (CSV injection). */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** Tenant text written into a cell: a leading `'` defuses a formula trigger (the visible quote is
 * Excel's own text convention). The parser strips it from component headers with `unneutralise`. */
export function neutralise(text: string): string {
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

export function unneutralise(text: string): string {
  return text.startsWith("'") && FORMULA_TRIGGER.test(text.slice(1)) ? text.slice(1) : text;
}
