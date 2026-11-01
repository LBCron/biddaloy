import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';
import {
  openFromSidebar,
  selectByTypeahead,
  tabToLocator,
  tabUntilFocused,
} from './keyboard-utils';

/**
 * [#3304] Settings › Communication › SMS, KEYBOARD ONLY: reach Settings from the sidebar, open
 * the Communication category, pick OneCodeSoft from the company picker by typeahead, then Tab to
 * each of its fields (Sender name, API address, the API key's Add button), Send a test message
 * (after typing a number), Test connection and Save, with no focus trap. Nothing is pressed that
 * calls a company or saves, so no vendor stub is needed. No `.click(` in this file.
 */
const t = makeT('en');

test.use({ ...loggedIn('admin'), e2eLocale: 'en', actionTimeout: 15_000 });

test('sidebar to Settings, Communication, then every SMS control by Tab', async ({ page }) => {
  test.setTimeout(90_000);
  await openFromSidebar(page, t('nav.items.settings'));

  await tabUntilFocused(page, t('settings.categories.communication'), 60, { exact: false });
  await page.keyboard.press('Enter');
  const section = page.locator('#sms-section');
  await expect(section).toBeVisible();

  // DOM order: picker, the company's fields, the test-message block, then the footer buttons.
  await tabToLocator(page, section.getByRole('combobox', { name: t('settings.sms.provider') }));
  await selectByTypeahead(page, 'OneCodeSoft');
  await tabToLocator(page, section.getByLabel('Sender name'));
  await tabToLocator(page, section.getByLabel('API address'));
  // A secret field shows its Add button, not an input, until it is pressed.
  await tabToLocator(page, section.getByRole('button', { name: t('settings.secret.set') }));
  await tabToLocator(page, section.getByLabel(t('settings.sendTestMessage.phone')));
  await page.keyboard.type('01712345678');
  await tabToLocator(
    page,
    section.getByRole('button', { name: t('settings.sendTestMessage.label') }),
  );
  await tabToLocator(
    page,
    section.getByRole('button', { name: t('settings.testConnection.action') }),
  );
  await tabToLocator(page, section.getByRole('button', { name: t('settings.save.action') }));
});
