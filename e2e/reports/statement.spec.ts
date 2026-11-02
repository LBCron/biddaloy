import type { Page } from '@playwright/test';

import { adminApiSession, createStudentWithDues, get, parentApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { numberIn, runSuffix, sentenceStart } from './helpers';

/**
 * [8.15.40] The student statement, end to end on both screens. A student with a bill is linked to the
 * seeded guardian. The accountant opens the student's Fees tab, then Statement, and prints; the
 * guardian opens `/portal/statement`. Both must read the same "now owed" as the Fees tab does.
 *
 * Split into serial legs like `journeys/fines.spec.ts`: the portal leg needs the guardian's own
 * browser session, which cannot share a role with the accountant leg.
 *
 * Printing is never real: `window.print` is replaced by a counter, so no dialog opens and the spec
 * asserts that the button reached `window.print()` and marked the page for the statement-only
 * print stylesheet (`printing-statement` on `<html>`).
 */
test.describe.serial('statement: accountant (staff) -> guardian (portal)', () => {
  test.setTimeout(90_000);

  let studentId: string;
  let owed: number;

  /** Replaces `window.print` with a counter, for every page this test opens. */
  const stubPrint = async (page: Page) => {
    await page.addInitScript(() => {
      const counter = window as unknown as { __printCalls: number };
      counter.__printCalls = 0;
      window.print = () => {
        counter.__printCalls += 1;
      };
    });
  };
  const printCalls = (page: Page) =>
    page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls);

  const owedNow = sentenceStart(t('fees.statement.owedNow', { amount: '@@' }));

  test.describe('1. the accountant reads and prints the statement', () => {
    test.use(loggedIn('accountant'));

    test('Fees tab -> Statement shows what is owed, the same as the tab, and Print is wired', async ({
      page,
      request,
    }) => {
      const admin = await adminApiSession(request);
      // The seeded guardian's own id, so leg 2 (her browser) can see this same student.
      const parent = await parentApiSession(request);
      const guardian = await get<{ id: string }>(request, parent, '/guardians/mine');
      const billed = 1000 + (Date.now() % 900);
      const created = await createStudentWithDues(request, admin, `E2E Statement ${runSuffix()}`, {
        amount: billed,
        guardianId: guardian.id,
      });
      studentId = created.studentId;
      await stubPrint(page);

      await page.goto(`/students/${studentId}?tab=fees`);
      const summary = page.getByLabel(t('students.detail.fees.summaryLabel'));
      const outstanding = summary
        .getByText(t('students.detail.fees.outstanding'), { exact: true })
        .locator('xpath=following-sibling::dd');
      await expect(outstanding).toBeVisible();
      owed = numberIn(await outstanding.innerText());
      // At least the bill (a late fee, if the school charges one, can only add to it).
      expect(owed).toBeGreaterThanOrEqual(billed);

      await page.getByRole('tab', { name: t('fees.statement.tabLabel') }).click();
      const statement = page.getByRole('region', { name: t('fees.statement.title'), exact: true });
      const headline = statement.getByText(owedNow);
      await expect(headline).toBeVisible();
      // The statement's closing balance is the Fees tab's number.
      expect(numberIn(await headline.innerText())).toBe(owed);

      const print = statement.getByRole('button', { name: t('fees.statement.print'), exact: true });
      await expect(print).toBeEnabled();
      await print.click();
      await expect.poll(() => printCalls(page)).toBe(1);
      await expect(page.locator('html')).toHaveClass(/printing-statement/);
    });
  });

  test.describe('2. the guardian reads the same statement on the portal', () => {
    test.use(loggedIn('parent'));

    test('/portal/statement shows the same closing balance', async ({ page }) => {
      await stubPrint(page);
      // The guardian has several children: ask for this one.
      await page.goto(`/portal/statement?student=${studentId}`);
      await expect(
        page.getByRole('heading', { level: 1, name: t('nav.items.portalStatement'), exact: true }),
      ).toBeVisible();

      const headline = page.getByText(owedNow);
      await expect(headline).toBeVisible();
      expect(numberIn(await headline.innerText())).toBe(owed);

      // With every date shown, the bill is a line and the page ends on the closing balance.
      const closing = page.locator('p').filter({ hasText: t('fees.statement.closing') });
      await expect(closing).toBeVisible();
      expect(numberIn(await closing.innerText())).toBe(owed);

      const print = page.getByRole('button', { name: t('fees.statement.portal.download') });
      await print.click();
      await expect.poll(() => printCalls(page)).toBe(1);
    });
  });
});
