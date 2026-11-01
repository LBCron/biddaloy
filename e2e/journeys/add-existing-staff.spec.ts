import { activateInvite, E2E_PASSWORD, loginAsFreshUser, post } from '../api';
import { shells } from '../config';
import { newSchool } from '../fixtures/new-school';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { SchoolPickerPage } from '../pages/school-picker';

/**
 * [68.2.02] "Add staff" for someone who already has an account sends a join
 * request instead of failing. Two schools of the spec's own: a teacher with a
 * verified email in school A, and school B's admin typing that email into
 * Staff > Add. The person becomes staff of B only after accepting.
 */
test.describe('add existing staff', () => {
  test.setTimeout(120_000);

  test('admin of B sends a join request; the teacher accepts and can open B', async ({
    browser,
    playwright,
    request,
  }) => {
    const schoolA = await newSchool(browser, playwright);
    const schoolB = await newSchool(browser, playwright);
    const email = `existing-${crypto.randomUUID()}@e2e.example.com`;
    const created = await post<{ invitation: { debug?: { token: string } } }>(
      schoolA.api,
      schoolA.session,
      '/users',
      { full_name: 'Existing Teacher', email, role: 'TEACHER' },
    );
    const token = created.invitation.debug?.token;
    if (!token) throw new Error('no invitation.debug.token — is ACCOUNT_ACCESS_ECHO_SECRETS=true?');
    await activateInvite(request, token, E2E_PASSWORD);

    const api = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    const context = await browser.newContext({
      storageState: await loginAsFreshUser(api, shells.app.baseURL, email, E2E_PASSWORD),
    });
    try {
      await test.step('B admin: Add staff with that email offers a join request', async () => {
        const { page } = schoolB;
        await page.goto('/staff?new=1');
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(t('staff.addUser.nameLabel')).fill('Existing Teacher');
        await dialog.getByLabel(t('staff.addUser.emailLabel')).fill(email);
        await dialog.getByRole('combobox', { name: t('staff.addUser.roleLabel') }).click();
        await page.getByRole('option', { name: t('staff.roles.ACCOUNTANT') }).click();
        await dialog.getByRole('button', { name: t('staff.addUser.save') }).click();
        await expect(dialog.getByText(t('staff.addUser.accountExists'))).toBeVisible();
        // The address is never echoed back.
        await expect(dialog.getByText(email)).toHaveCount(0);
        await dialog.getByRole('button', { name: t('staff.addUser.sendJoinRequest') }).click();
        await expect(page.getByText(t('staff.addUser.joinRequestSent'))).toBeVisible();
        await expect(dialog).toHaveCount(0);
      });

      await test.step('the teacher accepts from the dashboard card and switches to B', async () => {
        const page = await context.newPage();
        await page.goto('/dashboard');
        const card = page.getByRole('region', { name: t('nav.schoolInvites.title') });
        await expect(card.getByText(schoolB.schoolName)).toBeVisible();
        await card.getByRole('button', { name: t('nav.schoolInvites.accept') }).click();
        await expect(card).toHaveCount(0);
        await page.goto('/select-school');
        const picker = new SchoolPickerPage(page);
        await picker.expectLoaded();
        await picker.choose(schoolB.schoolName);
        await expect(page).toHaveURL(/\/dashboard/);
      });
    } finally {
      await context.close();
      await api.dispose();
      for (const s of [schoolA, schoolB]) {
        await s.context.close();
        await s.api.dispose();
      }
    }
  });
});
