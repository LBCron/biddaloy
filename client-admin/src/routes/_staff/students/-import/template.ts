import { downloadCsv } from '@biddaloy/ui/utils';

/**
 * The 13 required headers, verbatim from the server's parser
 * (`server/src/modules/students/bulk-upload.parser.ts`'s
 * `REQUIRED_HEADERS`) — the template is client-generated, no server
 * endpoint exists for it.
 */
export const TEMPLATE_HEADERS = [
  'student_name',
  'class',
  'section',
  'roll',
  'registration_number',
  'guardian1_name',
  'guardian1_phone',
  'guardian1_email',
  'guardian2_name',
  'guardian2_phone',
  'guardian2_email',
  'home_address',
  'preferred_communication',
  // [76.5.07] Optional; the server parser reads it when present (`OPTIONAL_HEADERS`).
  'card_no',
] as const;

export type TemplateHeader = (typeof TEMPLATE_HEADERS)[number];

/** Which columns the server requires per row, mirrored from `BulkUploadRowDto`. */
export const REQUIRED_COLUMNS: ReadonlySet<TemplateHeader> = new Set([
  'student_name',
  'class',
  'section',
  'guardian1_name',
  'guardian1_phone',
]);

/** One realistic example row — a Bangla name and a BD phone in the exact
 * format the server's `BD_PHONE_REGEX` accepts — so the person filling
 * the sheet copies a working shape rather than guessing. */
const TEMPLATE_EXAMPLE_ROW: Record<TemplateHeader, string> = {
  student_name: 'আরিফা খাতুন',
  class: 'Class 5',
  section: 'A',
  roll: '12',
  registration_number: '',
  guardian1_name: 'রহিম উদ্দিন',
  guardian1_phone: '01712345678',
  guardian1_email: 'rahim@example.com',
  guardian2_name: '',
  guardian2_phone: '',
  guardian2_email: '',
  home_address: 'ধানমন্ডি, ঢাকা',
  preferred_communication: 'SMS',
  card_no: '',
};

export function downloadTemplate(): void {
  downloadCsv('student-import-template.csv', [
    TEMPLATE_HEADERS,
    TEMPLATE_HEADERS.map((header) => TEMPLATE_EXAMPLE_ROW[header]),
  ]);
}
