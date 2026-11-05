import { adminApiSession } from '../api';
import { filledMarksSheet, marksImportScene } from '../fixtures/marks-import';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [81.3.5] Keyboard-only journey: marks grid -> palette "Upload marks sheet" -> import page ->
 * file input -> Save -> Esc back to the grid. No `page.mouse` and no `.click(`.
 * (`setInputFiles` fills the file input directly; the OS file picker is not keyboard-testable.)
 */

test.use(loggedIn('admin'));

test('keyboard-only: palette to the import page, choose a file, Save, Esc back', async ({
  page,
  request,
}) => {
  test.slow();
  const session = await adminApiSession(request);
  const scene = await marksImportScene(request, session, 2);
  const file = await filledMarksSheet(request, session, scene, {
    [scene.students[0].full_name]: 77,
    [scene.students[1].full_name]: 66,
  });

  await page.goto(scene.gridPath);
  await expect(page.getByRole('heading', { name: t('exams.marksGrid.caption') })).toBeVisible();

  await test.step('Ctrl+K, Action tab, run "Upload marks sheet"', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+3');
    // The action's label lives in `action-registry.ts`, not a catalog; Bangla is the e2e default.
    await page.keyboard.type('নম্বরের শীট আপলোড');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/import$/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('marksImport.title') }),
    ).toBeVisible();
  });

  await test.step('choose the file; the review appears', async () => {
    await page.getByLabel(t('bulkImport.chooseFile')).setInputFiles(file);
    await expect(page.getByTestId('sheet-review')).toBeVisible();
  });

  await test.step('Save with the keyboard', async () => {
    const save = page.getByRole('button', {
      name: t('marksImport.summary.saveCount', { n: 2 }),
      exact: true,
    });
    await save.focus();
    await expect(save).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(t('marksImport.summary.saved', { count: 2 }))).toBeVisible();
  });

  await test.step('Esc returns to the grid', async () => {
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`${scene.subjectId}$`));
  });
});
