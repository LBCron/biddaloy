import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [83.3.4] Usability tasks T1 / T5 on the seed: the admin opens Teaching assignments ›
 * Coordinators, assigns a teacher to two classes, sees two new rows, then removes one.
 * Local e2e runs in `bn`, so every label goes through `t()`. Classes are the last two unticked options,
 * not picked by name; the run cleans up the row it leaves.
 */
test.describe('admin: coordinators', () => {
  test.use(loggedIn('admin'));

  test('assigns a coordinator to two classes and removes one (T1, T5)', async ({ page }) => {
    await page.goto('/staff/teaching-assignments?tab=coordinators');
    await expect(
      page.getByRole('tab', { name: t('teacherAssignments.tabs.coordinators'), selected: true }),
    ).toBeVisible();
    // The seed already has coordinator rows: count only once the list has loaded.
    await expect(
      page.getByRole('button', { name: t('teacherAssignments.coordinators.remove') }).first(),
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

    const teacher = dialog.getByRole('combobox', { name: t('teacherAssignments.fields.teacher') });
    await teacher.click();
    await teacher.fill('SEED-TEACHER-0001');
    // The list re-renders while the dialog's other pickers load, so skip the "stable" wait.
    await page.getByRole('option', { name: /SEED-TEACHER-0001/ }).click({ force: true });
    const classes = dialog.getByRole('combobox', {
      name: t('teacherAssignments.fields.coordinatorClasses'),
    });
    for (let pick = 0; pick < 2; pick += 1) {
      await classes.click();
      // The last option not yet ticked: two different classes, away from the ones the seed assigns.
      await page.getByRole('option', { selected: false }).last().click({ force: true });
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
