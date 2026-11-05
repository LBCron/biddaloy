import type { APIRequestContext, Page } from '@playwright/test';

import { adminApiSession, createClassSection, createGuardian, post, type ApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { undersizedTargets } from '../responsive/assert';
import { expectNoAxeViolations } from './assert';

/**
 * [Epic 53 audit, #3390] The notice screens `notices.a11y.spec.ts` does not reach: the SMS
 * approval page, the "who has read it" tab, an open confirm dialog, and the public page
 * `/n/<token>` (live and dead). Axe, phone width (390 px, no sideways scroll), and the keyboard
 * path through the Decline dialog. This is an automated check, not a screen-reader run.
 */

const PHONE = { width: 390, height: 844 };

async function publishedNotice(
  request: APIRequestContext,
  admin: ApiSession,
  opts: { isPublic?: boolean; requestSms?: boolean },
) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const chain = await createClassSection(request, admin);
  const g = await createGuardian(request, admin, `A11yG ${suffix}`, `015${suffix.slice(-8)}`);
  const s = await post<{ id: string }>(request, admin, '/students', {
    full_name: `A11y student ${suffix}`,
    class_section_id: chain.sectionId,
    guardian_ids: [g.id],
  });
  const title = `A11y notice ${suffix}`;
  const n = await post<{ id: string }>(request, admin, '/notices', {
    title,
    body: `Body of ${title}`,
    isPublic: opts.isPublic ?? false,
  });
  await post(request, admin, `/notices/${n.id}/recipients`, {
    items: [{ kind: 'GUARDIAN', guardianId: g.id, studentId: s.id }],
  });
  await post(request, admin, `/notices/${n.id}/publish`, { requestSms: opts.requestSms ?? false });
  return { id: n.id, title };
}

/** Scan an open confirm only after its fade-in ends (a mid-fade scan misreads contrast). */
async function expectOpenDialogAxeClean(page: Page) {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await expectNoAxeViolations(page, '[role="alertdialog"]');
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('notice SMS page, report and dialogs', () => {
  test.use(loggedIn('admin'));
  test.setTimeout(120_000);

  test('SMS approval page: axe clean, fits 390 px, Decline dialog works by keyboard', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const { id } = await publishedNotice(request, admin, { requestSms: true });

    await page.goto(`/communications/notices/${id}?sms=1`);
    const box = page.getByRole('checkbox', { name: /A11yG/ });
    await expect(box).toBeVisible();
    await expectNoAxeViolations(page);

    // Keyboard only: focus Decline, open the dialog, focus is inside it, Escape closes it.
    const decline = page.getByRole('button', { name: t('notices.manage.sms.decline') });
    await decline.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(t('notices.manage.sms.declineTitle'));
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await expectOpenDialogAxeClean(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.setViewportSize(PHONE);
    await expect(box).toBeVisible();
    await expectNoSidewaysScroll(page);
    // P6: every control on a phone is at least 44 px.
    expect(await undersizedTargets(page, 44)).toEqual([]);
  });

  test('report tab and the "New link" confirm are axe clean', async ({ page, request }) => {
    const admin = await adminApiSession(request);
    const { id } = await publishedNotice(request, admin, { isPublic: true });

    await page.goto(`/communications/notices/${id}?tab=report`);
    await expect(page.getByLabel(t('notices.manage.report.filter'))).toBeVisible();
    await expectNoAxeViolations(page);

    await page.goto(`/communications/notices/${id}`);
    await page.getByRole('button', { name: t('notices.manage.link.renew') }).click();
    await expectOpenDialogAxeClean(page);
  });
});

test.describe('public notice page', () => {
  test.setTimeout(120_000);

  test('live and dead link: axe clean, one h1, fits 390 px, dead page never shows the token', async ({
    browser,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const { id, title } = await publishedNotice(request, admin, { isPublic: true });
    const { token } = await post<{ token: string }>(
      request,
      admin,
      `/notices/${id}/public-link`,
      {},
    );

    const anon = await browser.newContext({ viewport: PHONE });
    try {
      const reader = await anon.newPage();
      await reader.goto(`/n/${token}`);
      await expect(reader.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(reader.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expectNoAxeViolations(reader);
      await expectNoSidewaysScroll(reader);
      expect(await undersizedTargets(reader, 44)).toEqual([]);

      await reader.goto(`/n/not-a-real-token-${Date.now()}`);
      await expect(
        reader.getByRole('heading', { level: 1, name: t('notices.public.notFoundTitle') }),
      ).toBeVisible();
      await expectNoAxeViolations(reader);
      await expectNoSidewaysScroll(reader);
      expect(await reader.content()).not.toContain('not-a-real-token');
    } finally {
      await anon.close();
    }
  });
});
