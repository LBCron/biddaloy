import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [40.2.06] School website first-run: /website → wizard → suggested address →
 * second colour set → publish (logo skipped, it is optional) → live link.
 * The default theme (Basic) is already selected when the wizard opens.
 */
test.use(loggedIn('admin'));

test('admin sets up and publishes the school website with the wizard', async ({ page }) => {
  await page.goto('/website');

  await test.step('never-published site offers the wizard', async () => {
    await page.getByRole('button', { name: t('website.overview.off.action') }).click();
    await expect(page.getByText(t('website.wizard.title'))).toBeVisible();
  });

  await test.step('step 1: pick a suggested address', async () => {
    const suggestion = page
      .getByText(t('website.wizard.address.suggestions'))
      .locator('xpath=following-sibling::div')
      .getByRole('button')
      .first();
    const address = (await suggestion.innerText()).trim();
    await suggestion.click();
    await expect(page.getByLabel(t('website.wizard.address.label'))).toHaveValue(address);
    await expect(page.getByText(t('website.wizard.address.available'))).toBeVisible();
    await page.getByRole('button', { name: t('common.wizard.next') }).click();
  });

  await test.step('step 2: second palette', async () => {
    const second = page
      .getByRole('radiogroup', { name: t('website.wizard.design.colours') })
      .getByRole('radio')
      .nth(1);
    await second.click();
    await expect(second).toBeChecked();
    await page.getByRole('button', { name: t('common.wizard.next') }).click();
  });

  await test.step('step 3: skip logo, publish and switch on', async () => {
    await expect(page.getByText(t('website.wizard.logo.title'))).toBeVisible();
    await page.getByRole('button', { name: t('website.wizard.finish') }).click();
  });

  await test.step('overview shows the live site and its link', async () => {
    await expect(page.getByText(t('website.overview.status.live'))).toBeVisible();
    await expect(page.getByText(t('website.overview.liveLink'))).toBeVisible();
    await expect(page.getByRole('link', { name: /^https?:\/\// })).toBeVisible();
  });
});
