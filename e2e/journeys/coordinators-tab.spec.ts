import { adminApiSession, del, get } from '../api';
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

  test('assigns a coordinator to two classes and removes one (T1, T5)', async ({
    page,
    request,
  }) => {
    // Only this spec writes coordinators. Rows it adds are removed in `finally`, so a failed
    // attempt cannot leave one behind for the retry to trip over ("already assigned", #3588).
    const session = await adminApiSession(request);
    type Row = { id: string };
    const listRows = () => get<Row[]>(request, session, '/coordinators');
    const seeded = new Set((await listRows()).map((r) => r.id));
    try {
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

      const teacher = dialog.getByRole('combobox', {
        name: t('teacherAssignments.fields.teacher'),
      });
      await teacher.click();
      await teacher.fill('SEED-TEACHER-0001');
      // The list re-renders while the dialog's other pickers load, so skip the "stable" wait.
      await page.getByRole('option', { name: /SEED-TEACHER-0001/ }).click({ force: true });
      const classes = dialog.getByRole('combobox', {
        name: t('teacherAssignments.fields.coordinatorClasses'),
      });
      const chips = dialog
        .getByRole('list', { name: t('common.multiCombobox.selected'), exact: true })
        .getByRole('listitem');
      for (let pick = 0; pick < 2; pick += 1) {
        // The list re-renders while other specs add classes, so a forced click can land on a
        // stale option and be lost (#3588). Retry the pick until its chip is there.
        await expect(async () => {
          if ((await chips.count()) > pick) return;
          await classes.press('ArrowDown'); // opens the list whether or not it is already open
          // The last option not yet ticked: two different classes, away from the ones the seed assigns.
          await page.getByRole('option', { selected: false }).last().click({ force: true });
          await expect(chips).toHaveCount(pick + 1, { timeout: 1_000 });
        }).toPass();
      }
      // A multi-select keeps its list open after each pick so more can follow; the open
      // list sits over the dialog footer, so close it before reaching for Save. Escape is
      // handled by the picker itself (closes the list only), not by the dialog.
      await classes.press('Escape');
      await expect(
        page.getByRole('listbox', { name: t('teacherAssignments.fields.coordinatorClasses') }),
      ).toBeHidden();
      await expect(dialog).toBeVisible();
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
    } finally {
      for (const row of await listRows()) {
        if (!seeded.has(row.id)) await del(request, session, `/coordinators/${row.id}`);
      }
    }
  });
});
