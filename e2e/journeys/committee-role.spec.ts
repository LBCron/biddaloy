import { adminApiSession, apiSession, createAcr, currentAcademicYearId, post } from '../api';
import { acrBody } from '../fixtures/evaluations';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';

/**
 * [24.4.3] COMMITTEE journey (#1255, D9, D16, D20, D27): a School Management
 * Committee member can read the dashboard and ACRs/evaluations, and nothing else.
 * No student personal data is reachable from the UI or the API.
 *
 * Logs in as `committee@biddaloy.test` (seeded by #1368) via `loggedIn()`.
 * The ACR is created as ADMIN in its own
 * request context so it never replaces the browser's refresh cookie.
 */

test.use(loggedIn('committee'));

test('opens the dashboard and reads an ACR without being able to change it', async ({
  page,
  playwright,
  baseURL,
}) => {
  const suffix = crypto.randomUUID();
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  let acrId: string;
  let subjectId: string;
  try {
    const admin = await adminApiSession(ctx);
    const subject = await post<{ user: { id: string } }>(ctx, admin, '/users', {
      full_name: `Committee ACR Subject ${suffix}`,
      email: `committee-subject-${suffix}@e2e.example.com`,
      password: `E2e-Subject-${suffix}`,
      role: 'TEACHER',
      tenantId: admin.tenantId,
    });
    subjectId = subject.user.id;
    acrId = (
      await createAcr(ctx, admin, acrBody(subjectId, await currentAcademicYearId(ctx, admin)))
    ).id;
  } finally {
    await ctx.dispose();
  }

  await page.goto('/dashboard');
  await expect(page.getByRole('navigation', { name: t('nav.navLabel') })).toBeVisible();

  const shell = new AppShellPage(page);
  await shell.navigateTo('nav.items.evaluations');
  await expect(page).toHaveURL(/\/staff\/evaluations/);
  await expect(page.getByRole('heading', { name: t('evaluations.title') })).toBeVisible();
  // The Surveys tab has no "new survey" button for a read-only role (an ADMIN sees it).
  await page.getByRole('tab', { name: t('evaluations.tabs.surveys') }).click();
  await expect(
    page.getByRole('tab', { name: t('evaluations.tabs.surveys'), selected: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: t('evaluations.surveys.new') })).toHaveCount(0);

  // Open the ACR itself (by URL: the register can be long) and check it is read-only.
  await page.goto(`/staff/${subjectId}/acr/${acrId}`);
  await expect(
    page
      .getByRole('dialog')
      .getByRole('heading', {
        level: 1,
        name: t('evaluations.acr.pageTitle', { name: '' }).trim(),
      }),
  ).toBeVisible();
  // The ACR is INCOMPLETE, so step 1 is editable for ACR_WRITE (ADMIN) and disabled
  // only because COMMITTEE lacks it (`readOnly = completed || !canWrite`, acr-form.tsx).
  await expect(
    // The DatePicker's name is "<label>, <shown value>" (WCAG 2.5.3), so match the label part.
    page.getByLabel(t('evaluations.acr.step1.periodFrom')),
  ).toBeDisabled();
});

test('cannot reach students, fees, exams, settings or the collections report', async ({ page }) => {
  const shell = new AppShellPage(page);
  await page.goto('/dashboard');

  await test.step('nav has Evaluations and nothing money, student or exam related', async () => {
    await shell.expectNavItem('nav.items.dashboard', true);
    await shell.expectNavItem('nav.items.evaluations', true);
    for (const key of [
      'nav.items.students',
      'nav.items.guardians',
      'nav.items.fees',
      'nav.items.payments',
      'nav.items.invoices',
      'nav.items.seatPlans',
      'nav.items.settings',
      // D16: the collections CSV lists student names, so the report is not granted.
      'nav.items.collectionsReport',
    ]) {
      await shell.expectNavItem(key, false);
    }
    // "Exams" is a tenant-vocabulary label, so check the link target instead.
    await expect(
      page.getByRole('navigation', { name: t('nav.navLabel') }).locator('a[href="/exams"]'),
    ).toHaveCount(0);
  });

  await test.step('Ctrl+K has no People tab (D20)', async () => {
    await page.keyboard.press('Control+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: t('nav.commandPalette.tabs.page') })).toBeVisible();
    await expect(page.getByRole('tab', { name: t('nav.commandPalette.tabs.people') })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
  });

  await test.step('the API refuses student data and reports (D9, D16)', async () => {
    const committee = await apiSession(page.request, 'COMMITTEE');
    const headers = {
      Authorization: `Bearer ${committee.token}`,
      'X-Tenant-ID': committee.tenantId,
    };
    for (const path of [
      '/api/v1/students',
      '/api/v1/search?q=a',
      '/api/v1/reports/collections',
      '/api/v1/reports/collections.csv',
    ]) {
      expect((await page.request.get(path, { headers })).status(), path).toBe(403);
    }
  });

  await test.step('direct visits are refused', async () => {
    for (const route of ['/students', '/settings']) {
      await page.goto(route);
      await expect(
        page.getByRole('heading', { name: t('common.accessDenied.title') }),
      ).toBeVisible();
    }
  });
});
