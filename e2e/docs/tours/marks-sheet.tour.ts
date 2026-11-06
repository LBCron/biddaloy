/**
 * [81.4.1] "Fill marks in Excel" shots, one per numbered step of the guide section
 * (`docs/user-guide/{bn,en}/exams-results/marks-entry.md#task-excel`). Demo school, admin card.
 *
 * GUIDE_MARKS_SHEET_PATH is an empty marks list (`/marks/<exam>/<section>/<subject>`, one manual
 * component, not submitted). The tour saves marks into it, so each language run needs its own
 * list. The uploaded file is the sheet the app just downloaded, with three cells changed the way
 * a teacher would: roll 1 changed (45 → 54), roll 2 new, roll 3 above full marks (an error row).
 * Step 7 points at Submit without pressing it: the window it opens would lock the list.
 */
import { readFileSync } from 'node:fs';

import { test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';

import { imgDir } from '../helpers/capture';
import { asRole, go, re, snap, step, tr } from '../helpers/nav';

const dir = imgDir('exams-results');
const f = (name: string) => `${dir}/${name}.png`;

async function settle(page: Page, ms = 1200) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
}

/** The downloaded sheet with `cells` (row index from 0 → value) written into its marks column. */
async function fillSheet(xlsx: Buffer, cells: Record<number, number>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as never);
  const ws = wb.worksheets[0];
  let col = 0;
  ws.getRow(1).eachCell((cell, c) => {
    if (!col && /\/\s*\d/.test(String(cell.value))) col = c;
  });
  if (!col) throw new Error('marks column not found in the sheet');
  for (const [i, value] of Object.entries(cells)) ws.getCell(Number(i) + 2, col).value = value;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('marks sheet: fill marks in Excel', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(600_000);
  const gridPath = process.env.GUIDE_MARKS_SHEET_PATH ?? '';
  test.skip(
    !gridPath,
    'set GUIDE_MARKS_SHEET_PATH to an empty, not submitted /marks/<exam>/<section>/<subject>',
  );
  const page = await asRole(browser, info, 'admin');
  const main = page.getByRole('main');
  const cells = main.locator('tbody input');
  const saved = main.getByTestId('save-state-line');
  const allSaved = () => saved.getByText(re(tr('exams', 'saveState.saved')));
  const download = () => main.getByRole('button', { name: tr('exams', 'marksSheet.download') });
  const upload = () => main.getByRole('button', { name: tr('exams', 'marksSheet.upload') });
  const dialog = page.getByRole('dialog');
  let sheet: Buffer | undefined;

  await step('marks-sheet-01-download', async () => {
    await go(page, gridPath);
    await settle(page);
    // An earlier mark, so the review has a changed one to show (45 → 54).
    await cells.nth(0).fill('45');
    await cells.nth(0).press('Tab');
    await allSaved().waitFor({ timeout: 15_000 });
    await settle(page, 800);
    await snap(page, f('marks-sheet-01-download'), [{ target: download() }]);
    const [file] = await Promise.all([page.waitForEvent('download'), download().click()]);
    sheet = await fillSheet(readFileSync(await file.path()), { 0: 54, 1: 72, 2: 120 });
  });

  await step('marks-sheet-02-fill', async () => {
    await upload().click();
    await settle(page);
    await snap(page, f('marks-sheet-02-fill'), [
      { target: dialog.getByTestId('sheet-steps').locator('li').nth(1) },
    ]);
  });

  await step('marks-sheet-03-upload', async () => {
    await snap(page, f('marks-sheet-03-upload'), [
      { target: dialog.getByTestId('sheet-steps').locator('li').nth(2) },
      { target: dialog.getByRole('region', { name: tr('marksImport', 'steps.upload') }) },
    ]);
  });

  await step('marks-sheet-04-review', async () => {
    if (!sheet) throw new Error('no sheet downloaded');
    await dialog.getByLabel(tr('bulkImport', 'chooseFile')).setInputFiles({
      name: 'marks.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: sheet,
    });
    const review = dialog.getByTestId('sheet-review');
    await review.waitFor({ timeout: 30_000 });
    await settle(page, 800);
    await snap(page, f('marks-sheet-04-review'), [
      { target: review.getByRole('status').first() },
      { target: review.locator('tbody tr').first() },
      { target: dialog.getByText(tr('marksImport', 'errors.ABOVE_FULL_MARKS')).first() },
    ]);
  });

  await step('marks-sheet-05-saved', async () => {
    const save = dialog.getByRole('button', { name: re(tr('marksImport', 'summary.saveCount')) });
    await save.click();
    const done = dialog.getByText(re(tr('marksImport', 'summary.saved'))).first();
    await done.waitFor({ timeout: 30_000 });
    await settle(page, 600);
    await snap(page, f('marks-sheet-05-saved'), [{ target: done }]);
  });

  await step('marks-sheet-06-fix', async () => {
    await dialog
      .getByRole('button', { name: tr('common', 'actions.close'), exact: true })
      .last()
      .click();
    await settle(page);
    await cells.nth(2).fill('88');
    await cells.nth(2).press('Tab');
    await allSaved().waitFor({ timeout: 15_000 });
    await settle(page, 1500);
    await snap(page, f('marks-sheet-06-fix'), [{ target: cells.nth(2) }, { target: saved }]);
  });

  await step('marks-sheet-07-submit', async () => {
    await snap(page, f('marks-sheet-07-submit'), [
      {
        target: main.getByRole('button', {
          name: tr('exams', 'submitDialog.confirm'),
          exact: true,
        }),
      },
    ]);
  });
});
