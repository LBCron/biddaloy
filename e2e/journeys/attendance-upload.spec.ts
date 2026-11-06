import { AttendanceStatus } from '@biddaloy/shared';
import ExcelJS from 'exceljs';
import {
  adminApiSession,
  createStudentsInSection,
  currentAcademicYear,
  get,
  isFridayAnywhere,
  markableDateIso,
  put,
  type ApiSession,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [76.5.08] Attendance sheet upload, end to end (Epic 76 D8, D12): download the
 * sheet for one section, upload a prepared file (one wrong roll, one overwrite),
 * read the banner and the error row, save, land on the detail page, filter the
 * errors, then upload a corrected file and see the first upload marked superseded.
 *
 * Each run makes its own class section, so nothing is shared between runs. The
 * sheet is built here (headers in the school's language, bn) rather than edited
 * from the download, which only asserts the file name.
 */
const DATE = markableDateIso();

interface RegisterView {
  students: { student_id: string; roll_number: number; status: AttendanceStatus | null }[];
}

async function sheet(rows: [number, string][], className: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  // Same headers the download uses for a bn school.
  ws.addRow(['তারিখ', 'শ্রেণি', 'শাখা', 'রোল', 'নাম', 'হাজিরা']);
  for (const [roll, status] of rows) ws.addRow([DATE, className, 'A', roll, '', status]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function mark(
  request: import('@playwright/test').APIRequestContext,
  admin: ApiSession,
  sectionId: string,
  entries: { student_id: string; status: AttendanceStatus }[],
) {
  await put(request, admin, `/attendance/sections/${sectionId}/register`, {
    date: DATE,
    base_version: 0,
    client_request_id: crypto.randomUUID(),
    entries,
  });
}

test.describe('attendance sheet upload', () => {
  test.use(loggedIn('admin'));

  test('download, upload with errors, save, filter, upload a corrected file', async ({
    page,
    request,
  }) => {
    // The wizard's date is the school's today; on a Friday that is a closed day.
    test.skip(isFridayAnywhere(), 'the school is closed on Friday');
    test.setTimeout(120_000);
    const admin = await adminApiSession(request);
    // Current year: the wizard lists, and the sheet serves, current-year sections only.
    const chain = await createStudentsInSection(
      request,
      admin,
      'Sheet',
      3,
      await currentAcademicYear(request, admin),
    );
    // Unique, so the history list row of this upload can be found among everyone's.
    const firstFile = `sheet-${chain.sectionId}.xlsx`;
    const register = await get<RegisterView>(
      request,
      admin,
      `/attendance/sections/${chain.sectionId}/register?date=${DATE}`,
    );
    const byRoll = new Map(register.students.map((s) => [s.roll_number, s.student_id]));
    // Roll 3 already has a mark, so the sheet overwrites it.
    await mark(request, admin, chain.sectionId, [
      { student_id: byRoll.get(3)!, status: AttendanceStatus.ABSENT },
    ]);

    await page.goto(`/attendance/import?sectionId=${chain.sectionId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      t('attendanceImport.pageTitle'),
    );

    // Step 1: the download carries the section and date in its file name.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: t('attendanceImport.download.button') }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(DATE);
    expect(download.suggestedFilename()).toContain(chain.className);

    // Step 2: roll 99 does not exist, roll 3 overwrites, roll 1 is new.
    await page.getByLabel(t('attendanceImport.upload.chooseFile')).setInputFiles({
      name: firstFile,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await sheet(
        [
          [1, 'P'],
          [3, 'P'],
          [99, 'P'],
        ],
        chain.className,
      ),
    });
    await page.getByRole('button', { name: t('attendanceImport.upload.reviewChanges') }).click();

    // Step 3: the overwrite banner and the error row, then skip the error and save.
    await expect(
      page.getByText(t('attendanceImport.review.overwriteBanner', { count: 1 })),
    ).toBeVisible();
    await expect(page.getByText(t('attendanceImport.outcome.ERROR')).first()).toBeVisible();
    await page.getByLabel(t('attendanceImport.review.skipErrors')).check();
    await page
      .getByRole('button', { name: t('attendanceImport.review.save', { count: 2 }) })
      .click();

    // Detail page: filter to the error row only.
    await expect(page).toHaveURL(/\/attendance\/imports\/[0-9a-f-]{36}$/);
    const firstImportUrl = page.url();
    await page.getByRole('button', { name: t('attendanceImport.detail.filterErrors') }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);

    // Open register leads to this section's register, which now holds roll 3 as present (D12).
    await page
      .getByRole('link', { name: t('attendanceImport.detail.openRegister') })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/attendance/${chain.sectionId}\\?date=${DATE}`));
    const after = await get<RegisterView>(
      request,
      admin,
      `/attendance/sections/${chain.sectionId}/register?date=${DATE}`,
    );
    expect(after.students.find((s) => s.roll_number === 3)?.status).toBe(AttendanceStatus.PRESENT);

    // Upload a corrected file from the detail page: the fixed row 99 becomes roll 2.
    await page.goto(firstImportUrl);
    await page.getByRole('link', { name: t('attendanceImport.detail.uploadCorrected') }).click();
    // The wizard starts at step 1; the upload step is one click away.
    await page.getByRole('button', { name: t('attendanceImport.upload.title') }).click();
    await page.getByLabel(t('attendanceImport.upload.chooseFile')).setInputFiles({
      name: 'sheet-fixed.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await sheet([[2, 'A']], chain.className),
    });
    await page.getByRole('button', { name: t('attendanceImport.upload.reviewChanges') }).click();
    await page
      .getByRole('button', { name: t('attendanceImport.review.save', { count: 1 }) })
      .click();
    await expect(page).toHaveURL(/\/attendance\/imports\/[0-9a-f-]{36}$/);

    // The first upload is now marked superseded in the list.
    await page.goto('/attendance/imports');
    const firstRow = page.getByRole('row').filter({ hasText: firstFile });
    await expect(firstRow.getByText(t('attendanceImport.history.superseded'))).toBeVisible();
  });
});
