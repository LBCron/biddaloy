import type { Page } from '@playwright/test';

import { adminApiSession, get, submitMarkSheet } from '../api';
import {
  filledMarksSheet,
  marksImportScene,
  type MarksImportScene,
} from '../fixtures/marks-import';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import type { UploadFile } from '../pages/staff-import-page';

/**
 * [81.3.5] Marks import: the five usability tasks T1-T5 (Epic 81) as Playwright journeys on
 * the built screens. The filled sheet is the real GET sheet edited with exceljs.
 *
 * Persona note: T1-T3 log in as ADMIN, not a TEACHER. No API can create the subject-scoped
 * `teacher_class_sections` row a teacher needs to write marks (see `marks-entry.spec.ts`);
 * the import page and its routes behave the same for either role.
 */

const rowName = (scene: MarksImportScene, i: number) => scene.students[i].full_name;

/** Drops the file on the import page and waits for the review. */
async function uploadSheet(page: Page, file: UploadFile) {
  await page.getByLabel(t('bulkImport.chooseFile')).setInputFiles(file);
  await expect(page.getByTestId('sheet-review')).toBeVisible();
}

const saveButton = (page: Page, n: number) =>
  page.getByRole('button', { name: t('marksImport.summary.saveCount', { n }), exact: true });

async function cellValues(
  request: Parameters<typeof get>[0],
  session: Awaited<ReturnType<typeof adminApiSession>>,
  scene: MarksImportScene,
) {
  const grid = await get<{
    state: string;
    cells: { student_id: string; value: string | null; status: string }[];
  }>(
    request,
    session,
    `/exams/${scene.examId}/marks?section_id=${scene.sectionId}&subject_id=${scene.subjectId}`,
  );
  return grid;
}

test.describe('admin', () => {
  test.use(loggedIn('admin'));

  test('T1: download, fill 5 marks and one A, upload, review counts, save, grid shows them', async ({
    page,
    request,
  }) => {
    test.slow();
    const session = await adminApiSession(request);
    const scene = await marksImportScene(request, session);
    const file = await filledMarksSheet(request, session, scene, {
      [rowName(scene, 0)]: 78,
      [rowName(scene, 1)]: 65,
      [rowName(scene, 2)]: 90,
      [rowName(scene, 3)]: 41,
      [rowName(scene, 4)]: 100,
      [rowName(scene, 5)]: 'A',
    });

    await page.goto(scene.gridPath);
    await expect(page.getByRole('heading', { name: t('exams.marksGrid.caption') })).toBeVisible();

    await test.step('the grid links to the import page; Download gives an xlsx', async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: t('exams.marksSheet.download') }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
      await page.getByRole('button', { name: t('exams.marksSheet.upload') }).click();
      await expect(page).toHaveURL(/\/import$/);
      await expect(
        page.getByRole('heading', { level: 1, name: t('marksImport.title') }),
      ).toBeVisible();
    });

    await test.step('Save is off before a file is chosen', async () => {
      await expect(
        page.getByRole('button', { name: t('marksImport.summary.save'), exact: true }),
      ).toBeDisabled();
    });

    await test.step('upload shows the counts: 6 new, 1 absent, no errors', async () => {
      await uploadSheet(page, file);
      const review = page.getByTestId('sheet-review');
      await expect(review.getByText(t('marksImport.summary.new', { count: 6 }))).toBeVisible();
      await expect(review.getByText(t('marksImport.summary.absent', { count: 1 }))).toBeVisible();
      await expect(review.getByText(t('marksImport.summary.errors', { count: 0 }))).toHaveCount(0);
    });

    await test.step('Save writes them and says how many', async () => {
      await saveButton(page, 6).click();
      await expect(page.getByText(t('marksImport.summary.saved', { count: 6 }))).toBeVisible();
    });

    await test.step('closing lands on the grid, which shows the marks', async () => {
      await page
        .getByRole('button', { name: t('common.actions.close'), exact: true })
        .last()
        .click();
      await expect(page).toHaveURL(new RegExp(`${scene.subjectId}$`));
      await expect(
        page.getByLabel(
          t('exams.marksGrid.cellLabel', { name: rowName(scene, 0), component: 'Written' }),
        ),
      ).toHaveValue(/^(78|৭৮)(\.(00|০০))?$/); // the grid prints Bangla digits in bn
      await expect(
        page.getByLabel(
          t('exams.marksGrid.cellLabel', { name: rowName(scene, 5), component: 'Written' }),
        ),
      ).toHaveValue(t('exams.marksGrid.absentShort'));
    });

    await test.step('the server has the marks, and the audit log names the uploader', async () => {
      const grid = await cellValues(request, session, scene);
      const byStudent = new Map(grid.cells.map((c) => [c.student_id, c]));
      expect(byStudent.get(scene.students[0].id)?.value).toBe('78.00');
      expect(byStudent.get(scene.students[5].id)?.status).toBe('ABSENT');
      const logs = await get<{
        data: {
          new_values: { source?: string } | null;
          performed_by_name: string | null;
        }[];
      }>(request, session, `/audit-logs?entity_type=Mark&entity_id=${scene.examId}&limit=100`); // Mark audit rows carry the exam id
      const sheetRow = logs.data.find((l) => l.new_values?.source === 'SHEET');
      expect(sheetRow?.performed_by_name).toBeTruthy();
    });
  });

  test('T2: a value above full marks is an error row; Save still saves the rest', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const scene = await marksImportScene(request, session, 3);
    const file = await filledMarksSheet(request, session, scene, {
      [rowName(scene, 0)]: 150,
      [rowName(scene, 1)]: 70,
      [rowName(scene, 2)]: 55,
    });

    await page.goto(`${scene.gridPath}/import`);
    await uploadSheet(page, file);

    await expect(page.getByText(t('marksImport.errors.ABOVE_FULL_MARKS')).first()).toBeVisible();
    // D7: a bad row does not block the good ones.
    await expect(saveButton(page, 2)).toBeEnabled();
    await saveButton(page, 2).click();
    await expect(page.getByText(t('marksImport.summary.saved', { count: 2 }))).toBeVisible();

    const grid = await cellValues(request, session, scene);
    const saved = grid.cells.filter((c) => c.value !== null);
    expect(saved).toHaveLength(2);
    // The failed row was not written (the grid has no cell for it, or an empty one).
    expect(grid.cells.find((c) => c.student_id === scene.students[0].id)?.value ?? null).toBeNull();
  });

  test('T3: re-uploading a corrected sheet shows what changed as old → new', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const scene = await marksImportScene(request, session, 3);
    const first = await filledMarksSheet(request, session, scene, {
      [rowName(scene, 0)]: 40,
      [rowName(scene, 1)]: 50,
      [rowName(scene, 2)]: 60,
    });

    await page.goto(`${scene.gridPath}/import`);
    await uploadSheet(page, first);
    await saveButton(page, 3).click();
    await expect(page.getByText(t('marksImport.summary.saved', { count: 3 }))).toBeVisible();

    // A fresh sheet now carries the saved marks; fix two of them.
    const corrected = await filledMarksSheet(request, session, scene, {
      [rowName(scene, 0)]: 45,
      [rowName(scene, 1)]: 58,
    });
    await page.goto(`${scene.gridPath}/import`);
    await uploadSheet(page, corrected);
    const review = page.getByTestId('sheet-review');
    await expect(review.getByText(t('marksImport.summary.changed', { count: 2 }))).toBeVisible();
    await expect(review.getByText(t('marksImport.summary.unchanged', { count: 1 }))).toBeVisible();
    // "Written: 40.00 → 45": the table row carries both the old and the new mark.
    await expect(review.getByText(/Written: 40(\.00)? → 45/)).toBeVisible();
    await expect(saveButton(page, 2)).toBeEnabled();
  });

  test('T4: an admin opens Upload from the marks list page', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const scene = await marksImportScene(request, session, 2);
    await openUploadFromList(page, scene);
    await expect(page).toHaveURL(new RegExp(`${scene.subjectId}/import$`));
  });

  test('a submitted list hides Upload on the grid and the page says so with Back to grid', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const scene = await marksImportScene(request, session, 2);
    // Build the file while the list is still a draft, then submit it.
    const file = await filledMarksSheet(request, session, scene, {
      [rowName(scene, 0)]: 70,
      [rowName(scene, 1)]: 71,
    });
    await submitMarkSheet(request, session, scene.examId, {
      section_id: scene.sectionId,
      subject_id: scene.subjectId,
    });

    await page.goto(scene.gridPath);
    await expect(page.getByRole('heading', { name: t('exams.marksGrid.caption') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('exams.marksSheet.upload') })).toHaveCount(0);

    // Straight to the URL: the server answers 409, the page shows its own sentence.
    await page.goto(`${scene.gridPath}/import`);
    await page.getByLabel(t('bulkImport.chooseFile')).setInputFiles(file);
    // Also announced in a screen-reader live region, hence the role.
    await expect(
      page.getByRole('alert').filter({ hasText: t('marksImport.errors.submitted') }),
    ).toBeVisible();
    await page.getByRole('button', { name: t('marksImport.backToGrid') }).click();
    await expect(page).toHaveURL(new RegExp(`${scene.subjectId}$`));
  });
});

test.describe('exam controller', () => {
  test.use(loggedIn('exam_controller'));

  test('T5: the exam controller opens Upload from the marks list page and saves (D5b)', async ({
    page,
    playwright,
    baseURL,
  }) => {
    // The scene is built as ADMIN in its own context so the browser's session is untouched.
    const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
    try {
      const session = await adminApiSession(ctx);
      const scene = await marksImportScene(ctx, session, 2);
      const file = await filledMarksSheet(ctx, session, scene, {
        [rowName(scene, 0)]: 82,
        [rowName(scene, 1)]: 'A',
      });
      await openUploadFromList(page, scene);
      await uploadSheet(page, file);
      await saveButton(page, 2).click();
      await expect(page.getByText(t('marksImport.summary.saved', { count: 2 }))).toBeVisible();
    } finally {
      await ctx.dispose();
    }
  });
});

/** `/marks` list: pick the scene's exam, then use the row's Upload action. */
async function openUploadFromList(page: Page, scene: MarksImportScene) {
  await page.goto('/marks');
  await page.getByLabel(t('exams.marksList.examLabel')).click();
  await page.getByRole('option', { name: new RegExp(scene.examName) }).click();
  await page.getByRole('link', { name: t('exams.marksSheet.upload') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('marksImport.title') })).toBeVisible();
}
