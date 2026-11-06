import ExcelJS from 'exceljs';
import {
  adminApiSession,
  createStudentsInSection,
  currentAcademicYear,
  markableDateIso,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [76.5.08] D15: the attendance sheet upload, KEYBOARD ONLY. Every step goes through
 * `page.keyboard` (plus API calls for setup); choosing the file is the one
 * non-pointer, non-key step the browser allows (`setInputFiles`).
 *
 * Palette label is typed in Bangla because the e2e locale is `bn`: it is the `bn`
 * label of `attendance.import` in `client-admin/src/action-registry.ts`.
 */
const IMPORT_LABEL = 'হাজিরা শীট আপলোড করুন';
const DATE = markableDateIso();

test.use(loggedIn('admin'));

test('palette to saved upload with the keyboard alone', async ({ page, request }) => {
  test.setTimeout(120_000);
  const admin = await adminApiSession(request);
  // Current year: the wizard lists current-year sections only.
  const chain = await createStudentsInSection(
    request,
    admin,
    'Kbd Sheet',
    2,
    await currentAcademicYear(request, admin),
  );

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
  await expect(input).toBeFocused();
  await page.keyboard.press('Control+3'); // Action tab
  await page.keyboard.type(IMPORT_LABEL);
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  // The wizard itself, not the Uploaded sheets list (`/attendance/imports`).
  await expect(page).toHaveURL(/\/attendance\/import(\?|$)/);

  // Step 1: tick the section, download the sheet.
  await tabUntilFocused(page, `${chain.className} – A`, 120, { tag: 'button' });
  await page.keyboard.press('Space');
  await tabUntilFocused(page, t('attendanceImport.download.button'), 60, { tag: 'button' });
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  await downloadPromise;

  // Step 2: choose the filled sheet, review it.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  ws.addRow(['তারিখ', 'শ্রেণি', 'শাখা', 'রোল', 'নাম', 'হাজিরা']);
  ws.addRow([DATE, chain.className, 'A', 1, '', 'P']);
  await page.getByLabel(t('attendanceImport.upload.chooseFile')).setInputFiles({
    name: 'kbd.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  await tabUntilFocused(page, t('attendanceImport.upload.reviewChanges'), 60, { tag: 'button' });
  await page.keyboard.press('Enter');

  // Step 3: save.
  await tabUntilFocused(page, t('attendanceImport.review.save', { count: 1 }), 80, {
    tag: 'button',
  });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/attendance\/imports\/[0-9a-f-]{36}$/);
});
