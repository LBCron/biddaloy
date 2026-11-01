import type { APIRequestContext, Page } from '@playwright/test';

import {
  adminApiSession,
  createClassSection,
  createGuardian,
  createTeacher,
  currentAcademicYear,
  get,
  loginAsFreshUser,
  post,
} from '../api';
import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { LoginPage } from '../pages/login-page';

/**
 * [53.4 / #3382] Epic 53 close journey: the post-and-read path, end to end.
 *
 * Own data, so no other spec can change it: two fresh sections in the current year, a guardian
 * with a portal account in each (batch invite + first sign-in with a code), and a fresh teacher
 * of section A. Case 1: the admin writes a notice with a PDF, adds the whole of section A's
 * guardians on one tab and the teacher by name (one ticked row) on another, publishes; section
 * A's guardian sees it on the Overview and opens it, section B's guardian does not, and the
 * report shows one seen. Case 2: the teacher posts to their own section.
 *
 * The public link (`/n/:token`) has no client page yet (D19), so nothing here uses it.
 */

interface InviteBatchStatus {
  queued: number;
}

// A tiny valid PDF: it has to pass the upload signature check (Rule 6).
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

const bnDigit = (n: number) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)] ?? d);

/** Picks the option named `name` in the combobox named `label`. */
async function pick(page: Page, label: string, name: string) {
  const box = page.getByRole('combobox', { name: label });
  await box.click();
  await box.fill(name);
  await page.getByRole('option', { name }).click({ force: true });
}

/** Writes title and text, goes to the audience step. `file` is attached when given. */
async function writeNotice(page: Page, title: string, file?: { name: string; buffer: Buffer }) {
  await page.goto('/communications/notices/new');
  await page.getByLabel(t('noticeCompose.fields.title')).fill(title);
  await page.getByLabel(t('noticeCompose.fields.body')).fill(`Body of ${title}`);
  if (file) {
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: file.name, mimeType: 'application/pdf', buffer: file.buffer });
    await expect(page.getByText(file.name)).toBeVisible();
  }
  await page.getByRole('button', { name: t('noticeCompose.actions.next') }).click();
  await expect(page.getByText(t('noticeCompose.audience.intro'))).toBeVisible();
}

/** "Add all matching" on the Guardians tab for the class named `className`. */
async function addGuardiansOf(page: Page, className: string, count: number) {
  await page.getByRole('tab', { name: t('noticeCompose.audience.tabs.guardians') }).click();
  await pick(page, t('noticeCompose.audience.filters.class'), className);
  const added = page.waitForResponse(
    (r) => r.url().includes('/recipients/matching') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: t('common.audienceBuilder.addAll', { count }) }).click();
  expect((await added).ok()).toBe(true);
}

/** Next to the review step, Publish, confirm; waits for the publish answer. */
async function publish(page: Page) {
  await page.getByRole('button', { name: t('noticeCompose.actions.next') }).click();
  await page.getByRole('button', { name: t('noticeCompose.actions.publish') }).click();
  const published = page.waitForResponse(
    (r) => /\/notices\/[0-9a-f-]{36}\/publish$/.test(r.url()) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: t('noticeCompose.actions.confirmPublish') }).click();
  expect((await published).ok()).toBe(true);
  await expect(page).toHaveURL(/\/communications\/notices\/[0-9a-f-]{36}$/);
}

async function signInGuardian(page: Page, phone: string) {
  const login = new LoginPage(page);
  await login.goto();
  await page.getByRole('link', { name: t('auth.login.firstTime') }).click();
  await login.requestAndEnterOtp(phone);
  await page.getByRole('button', { name: t('auth.setPassword.skip') }).click();
  await expect(page).toHaveURL(/\/portal/);
}

async function drain(request: APIRequestContext, batchId: string) {
  const admin = await adminApiSession(request);
  await expect
    .poll(
      async () =>
        (await get<InviteBatchStatus>(request, admin, `/users/invitations/batch/${batchId}`))
          .queued,
      { timeout: 30_000, intervals: [500, 1000] },
    )
    .toBe(0);
}

test.describe('notices: post and read', () => {
  test.use(loggedIn('admin'));

  test('admin posts to a section and a teacher; guardian reads it; other section does not', async ({
    page,
    browser,
    playwright,
    request,
  }) => {
    test.setTimeout(240_000);
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const admin = await adminApiSession(request);
    const year = await currentAcademicYear(request, admin);

    // --- setup: two sections, a guardian with an account in each, a teacher of section A ------
    const chainA = await createClassSection(request, admin, year);
    const chainB = await createClassSection(request, admin, year);
    const phoneA = `019${suffix.slice(-8)}`;
    const phoneB = `018${suffix.slice(-8)}`;
    const guardianA = await createGuardian(request, admin, `Notice Guardian A ${suffix}`, phoneA);
    const guardianB = await createGuardian(request, admin, `Notice Guardian B ${suffix}`, phoneB);
    for (const [chain, guardian, tag] of [
      [chainA, guardianA, 'A'],
      [chainB, guardianB, 'B'],
    ] as const) {
      await post(request, admin, '/students', {
        full_name: `Notice Child ${tag} ${suffix}`,
        class_section_id: chain.sectionId,
        guardian_ids: [guardian.id],
      });
    }
    const batch = await post<{ batch_id: string }>(request, admin, '/users/invitations/batch', {
      guardian_ids: [guardianA.id, guardianB.id],
    });
    await drain(request, batch.batch_id);
    const teacherName = `Notice Teacher ${suffix}`;
    const teacher = await createTeacher(request, admin, teacherName, chainA);

    const guardianAContext = await browser.newContext();
    const guardianBContext = await browser.newContext();
    const teacherApi = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    const teacherContext = await browser.newContext({
      storageState: await loginAsFreshUser(
        teacherApi,
        shells.app.baseURL,
        teacher.email,
        teacher.password,
      ),
    });
    try {
      const title = `Notice ${suffix}`;

      await test.step('1. admin writes, picks section A guardians and the teacher, publishes', async () => {
        await writeNotice(page, title, { name: `circular-${suffix}.pdf`, buffer: PDF });
        // One tab: everyone the filter matches.
        await addGuardiansOf(page, chainA.className, 1);
        // Another tab: a few rows - the one teacher, ticked by hand.
        await page.getByRole('tab', { name: t('noticeCompose.audience.tabs.named') }).click();
        await page
          .getByLabel(t('noticeCompose.audience.filters.name'), { exact: true })
          .fill(teacherName);
        const row = page.getByRole('row', { name: new RegExp(teacherName) });
        await row.getByRole('checkbox').check();
        const added = page.waitForResponse(
          (r) => /\/recipients$/.test(r.url()) && r.request().method() === 'POST',
        );
        await page.getByRole('button', { name: t('common.audienceBuilder.addSelected') }).click();
        expect((await added).ok()).toBe(true);
        await publish(page);
      });

      await test.step('2. section A guardian sees it on the Overview and opens it', async () => {
        const guardianPage = await guardianAContext.newPage();
        await signInGuardian(guardianPage, phoneA);
        await guardianPage.goto('/portal');
        // The card names the notice; "All notices" leads to the list where it opens.
        const card = guardianPage.getByRole('region', { name: t('portalNotices.card.title') });
        await expect(card.getByText(title)).toBeVisible();
        await card.getByRole('link', { name: t('portalNotices.card.link') }).click();
        await guardianPage.getByRole('button', { name: title }).click();
        const dialog = guardianPage.getByRole('dialog');
        await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
        await expect(dialog.getByText(`Body of ${title}`)).toBeVisible();
        await expect(
          dialog.getByRole('button', {
            name: t('portalNotices.detail.openFile', { name: `circular-${suffix}.pdf` }),
          }),
        ).toBeVisible();
      });

      await test.step('3. section B guardian does not see it', async () => {
        const guardianPage = await guardianBContext.newPage();
        await signInGuardian(guardianPage, phoneB);
        await guardianPage.goto('/portal/notices');
        await expect(
          guardianPage.getByRole('heading', { level: 1, name: t('portalNotices.title') }),
        ).toBeVisible();
        await expect(guardianPage.getByText(t('portalNotices.list.emptyCurrent'))).toBeVisible();
        await expect(guardianPage.getByText(title)).toHaveCount(0);
      });

      await test.step("4. the admin's report shows one guardian seen", async () => {
        // The report is read after the guardian opened it, so a reload is enough.
        await page.reload();
        await page.getByRole('tab', { name: t('notices.manage.tabReport') }).click();
        const seen = page
          .locator('dl')
          .locator('div', { has: page.getByText(t('notices.manage.report.seen'), { exact: true }) })
          .last();
        await expect(seen).toContainText(bnDigit(1));
        const total = page
          .locator('dl')
          .locator('div', {
            has: page.getByText(t('notices.manage.report.total'), { exact: true }),
          })
          .last();
        await expect(total).toContainText(bnDigit(2));
      });

      await test.step('5. a teacher posts to their own section', async () => {
        const teacherPage = await teacherContext.newPage();
        const teacherTitle = `Teacher notice ${suffix}`;
        await writeNotice(teacherPage, teacherTitle);
        await addGuardiansOf(teacherPage, chainA.className, 1);
        await publish(teacherPage);
        // Section A's guardian now has it too.
        const guardianPage = guardianAContext.pages()[0]!;
        await guardianPage.goto('/portal/notices');
        await expect(guardianPage.getByText(teacherTitle)).toBeVisible();
      });
    } finally {
      await guardianAContext.close();
      await guardianBContext.close();
      await teacherContext.close();
      await teacherApi.dispose();
    }
  });
});
