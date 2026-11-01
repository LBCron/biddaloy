import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [83.3.4] Usability tasks T1 / T5 on the seed: the admin opens Teaching assignments ›
 * Coordinators, assigns a teacher to two classes, sees two new rows, then removes one.
 * Local e2e runs in `bn`, so every label goes through `t()`. Classes are picked by position,
 * not by name; the run cleans up the row it leaves.
 */
test.describe('admin: coordinators', () => {
  test.use(loggedIn('admin'));

  test('assigns a coordinator to two classes and removes one (T1, T5)', async ({ page }) => {
    await page.goto('/staff/teaching-assignments?tab=coordinators');
    await expect(
      page.getByRole('tab', { name: t('teacherAssignments.tabs.coordinators'), selected: true }),
    ).toBeVisible();
    const rowsBefore = await page.getByRole('row').count();

    await page
      .getByRole('button', { name: t('teacherAssignments.coordinators.assign') })
      .first()
      .click();
    const dialog = page.getByRole('dialog', {
      name: t('teacherAssignments.assignCoordinatorDialog.title'),
    });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('combobox', { name: t('teacherAssignments.fields.teacher') }).click();
    await page.getByRole('option').last().click();
    const classes = dialog.getByRole('combobox', {
      name: t('teacherAssignments.fields.coordinatorClasses'),
    });
    for (const index of [-1, -2]) {
      await classes.click();
      await page.getByRole('option').nth(index).click();
    }
    await dialog
      .getByRole('button', { name: t('teacherAssignments.assignCoordinatorDialog.save') })
      .click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.getByRole('row').count()).toBe(rowsBefore + 2);

    // T5: remove the first new row; the list loses one row.
    await page
      .getByRole('button', { name: t('teacherAssignments.coordinators.remove') })
      .last()
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('teacherAssignments.removeCoordinatorDialog.confirm') })
      .click();
    await expect.poll(() => page.getByRole('row').count()).toBe(rowsBefore + 1);

    // Leave the seed as found.
    await page
      .getByRole('button', { name: t('teacherAssignments.coordinators.remove') })
      .last()
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('teacherAssignments.removeCoordinatorDialog.confirm') })
      .click();
    await expect.poll(() => page.getByRole('row').count()).toBe(rowsBefore);
  });
});
