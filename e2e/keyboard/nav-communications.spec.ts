import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { expectReachableInMain, openFromSidebar, tabUntilFocused } from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.
// Nothing here sends a message.

test.describe('Communications (admin)', () => {
  test.use(loggedIn('admin'));

  test('send message', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.sendMessage'));
    await expectReachableInMain(page);
  });

  // [97.4.03] Opening the log reads only; nothing is sent.
  test('message log', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.messageLog'));
    await expectReachableInMain(page);
  });

  // [67.6.02] Send an alert opens as a full-page dialog, so focus lands inside it (on its close
  // button), not on the h1 `openFromSidebar` waits for. Opening the page sends nothing.
  test('send an alert', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await tabUntilFocused(page, t('nav.items.sendAlert'), 150, { tag: 'a', exact: true });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { level: 1, name: t('nav.items.sendAlert'), exact: true }),
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);
  });
});

test.describe('Communications (accountant)', () => {
  test.use(loggedIn('accountant'));

  test('fee reminders', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.feeReminders'));
    await expectReachableInMain(page);
  });

  test('reminder history', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.reminderHistory'));
    await expectReachableInMain(page);
  });
});
