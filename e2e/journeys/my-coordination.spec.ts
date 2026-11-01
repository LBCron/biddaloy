import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [83.4.4] Usability tasks T2–T4 on the dev seed (D31): `teacher@biddaloy.test` is class
 * coordinator of Class 6 and Class 7. The page lists them with no further click; a section
 * row opens its register; "Notify teachers" with one teacher unticked sends the reminder.
 * Local e2e runs in `bn`, so every label goes through `t()`.
 */
test.describe('class coordinator: My coordination', () => {
  test.use(loggedIn('teacher'));

  test('opens from the nav, shows the classes, opens a register (T2, T3)', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: t('nav.items.myCoordination') }).click();
    await expect(page).toHaveURL(/\/my-coordination/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('coordination.title') }),
    ).toBeVisible();
    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    await expect(
      cards.first().getByRole('heading', { name: t('coordination.blocks.todayAttendance') }),
    ).toBeVisible();

    // Every section row is a link to that section's register for the day.
    await cards.first().getByRole('link', { name: /./ }).filter({ hasText: /./ }).nth(1).click();
    await expect(page).toHaveURL(/\/attendance\/[0-9a-f-]{36}\?date=\d{4}-\d{2}-\d{2}/);
  });

  test('notifies the teachers of a class with one unticked (T4)', async ({ page }) => {
    await page.goto('/my-coordination?then=notify');
    const dialog = page.getByRole('dialog', { name: t('coordination.notifyDialog.title') });
    await expect(dialog).toBeVisible();
    const boxes = dialog.getByRole('checkbox');
    const n = await boxes.count();
    if (n > 1) await boxes.last().click();
    await dialog
      .getByRole('textbox', { name: t('coordination.notifyDialog.messageLabel') })
      .fill('Please submit Term 1 marks by Thursday.');
    await dialog.getByRole('button', { name: t('coordination.notifyDialog.send') }).click();
    await expect(dialog).toBeHidden();
  });
});
