import { adminApiSession, createGuardian, createStudentWithDues } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [#2259] The Send message page only messages a guardian of this school.
 * Office staff pick a student, then a guardian; the address is shown read-only
 * and the server reads it from the guardian's record. A teacher has no
 * COMMUNICATION_SEND, so the nav has no entry and the URL shows the
 * no-access state.
 */

test.describe('office staff', () => {
  test.use(loggedIn('office_staff'));

  test('picks a guardian, sees the address read-only, and sends', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const stamp = Date.now();
    const studentName = `Send Student ${stamp}`;
    const guardianName = `Send Guardian ${stamp}`;
    const guardian = await createGuardian(request, session, guardianName, '01712345678');
    await createStudentWithDues(request, session, studentName, { guardianId: guardian.id });

    await page.goto('/communications/send');
    await expect(
      page.getByRole('heading', { level: 1, name: t('communications.send.title') }),
    ).toBeVisible();

    // No free address or name inputs any more.
    await expect(
      page.getByRole('textbox', { name: t('communications.send.recipientAddressLabel') }),
    ).toHaveCount(0);

    await page
      .getByRole('textbox', { name: t('communications.send.linkStudentTitle') })
      .fill(studentName);
    await page.getByRole('button', { name: new RegExp(studentName) }).click();
    await page.getByRole('radio', { name: new RegExp(guardianName) }).check();

    // The address is plain text under the picker.
    await expect(
      page.getByText(t('communications.send.recipientAddressLabel')).first(),
    ).toBeVisible();
    // [78 D37] The e2e school has no SMS gateway: SMS (the default channel)
    // shows the warning bar; Email hides it; the send is never blocked.
    await expect(page.getByText(t('communications.send.smsNotReady.NO_GATEWAY'))).toBeVisible();
    await page.getByRole('combobox', { name: t('communications.send.mediumLabel') }).click();
    await page.getByRole('option', { name: t('communications.mediums.EMAIL') }).click();
    await expect(page.getByText(t('communications.send.smsNotReady.NO_GATEWAY'))).toHaveCount(0);
    await page.getByRole('combobox', { name: t('communications.send.mediumLabel') }).click();
    await page.getByRole('option', { name: t('communications.mediums.SMS') }).click();
    await expect(page.getByText(t('communications.send.smsNotReady.NO_GATEWAY'))).toBeVisible();

    await page
      .getByRole('textbox', { name: t('communications.send.messageLabel') })
      .fill('School closed tomorrow.');

    await page.getByRole('button', { name: t('communications.send.submit'), exact: true }).click();
    await page.getByRole('button', { name: t('communications.send.confirmSend') }).click();

    // [2604] The e2e school has no SMS gateway, so the send is recorded and then fails;
    // the page says so and points at Settings instead of claiming "on its way".
    await expect(
      page.getByRole('heading', { name: t('communications.send.failedTitle') }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('link', { name: t('communications.send.settingsLink') }),
    ).toBeVisible();
  });
});

test.describe('teacher', () => {
  test.use(loggedIn('teacher'));

  test('has no Send message nav item and the URL shows no-access', async ({ page }) => {
    await page.goto('/communications/send');
    await expect(page.getByRole('heading', { name: t('common.accessDenied.title') })).toBeVisible();
    await expect(
      page.getByRole('link', { name: t('nav.items.sendMessage'), exact: true }),
    ).toHaveCount(0);
  });
});
