import ExcelJS from 'exceljs';
import { ATTENDANCE_SHEET_STATUS_CODES } from '@biddaloy/shared';

export interface TemplateRow {
  date: string;
  className: string;
  sectionName: string;
  roll: number;
  name: string;
}

/** Sheet / header text per language (D35: the school's language). */
const TEXT = {
  bn: {
    sheet: 'হাজিরা',
    help: 'কীভাবে পূরণ করবেন',
    headers: ['তারিখ', 'শ্রেণি', 'শাখা', 'রোল', 'নাম', 'হাজিরা'],
    legend: [
      'শুধু "হাজিরা" কলাম পূরণ করুন। অন্য কলাম বদলাবেন না।',
      'উ = উপস্থিত (P)',
      'অ = অনুপস্থিত (A)',
      'দে = দেরিতে (L)',
      'ছু = ছুটি (LV)',
      'ফাঁকা রাখলে ওই শিক্ষার্থীর হাজিরা বদলাবে না।',
    ],
  },
  en: {
    sheet: 'Attendance',
    help: 'How to fill',
    headers: ['Date', 'Class', 'Section', 'Roll', 'Name', 'Status'],
    legend: [
      'Fill only the "Status" column. Do not change the other columns.',
      'P = Present',
      'A = Absent',
      'L = Late',
      'LV = Leave',
      "Leave a cell blank to keep that student's mark as it is.",
    ],
  },
} as const;

export async function buildAttendanceSheet(
  rows: TemplateRow[],
  lang: 'bn' | 'en',
): Promise<Buffer> {
  const t = TEXT[lang];
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(t.sheet);
  sheet.addRow([...t.headers]);
  sheet.getRow(1).font = { bold: true };
  const codes = Object.values(ATTENDANCE_SHEET_STATUS_CODES).map((c) => c[lang === 'bn' ? 1 : 0]);
  for (const r of rows) {
    // exceljs writes a JS string as a plain string cell, never a formula, so a student name
    // starting with "=" is safe here; no cell sanitiser exists in the codebase (csv export has none).
    const row = sheet.addRow([r.date, r.className, r.sectionName, r.roll, r.name, null]);
    const status = row.getCell(6);
    status.protection = { locked: false };
    status.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${codes.join(',')}"`],
    };
  }
  sheet.columns.forEach((c) => (c.width = 16));
  // ponytail: empty-password sheet lock stops accidental edits to the header and the
  // pre-filled columns, not a determined user; the server re-checks every row anyway.
  await sheet.protect('', { selectLockedCells: true, selectUnlockedCells: true });

  const help = wb.addWorksheet(t.help);
  for (const line of t.legend) help.addRow([line]);
  help.getColumn(1).width = 70;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
