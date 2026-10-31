import { adminApiSession, type ApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { expectNoHorizontalScroll } from '../pages';

import {
  archiveReport,
  classByGenderDefinition,
  countPattern,
  createClassWithStudents,
  createPublishedReport,
  numberIn,
  reportAnswersIn,
  rowTotal,
  runSuffix,
} from './helpers';

/**
 * [8.15.31] Hub and runner, end to end. A report the admin made through the API is found in the
 * hub, opens and shows its answer at once (D22), is run again with a prompt, adds up, and opens
 * its print view. At 390 px the hub and the runner stay inside the screen.
 *
 * The report counts one class this spec creates, by gender, with totals. It filters on that class
 * as a literal, so the numbers are this spec's own however busy the shared test school is.
 * The one question, "লিঙ্গ", is optional: unanswered it filters nothing.
 */
const GENDER_LABEL = 'লিঙ্গ';
const GIRLS = 'ছাত্রী';

test.describe('reports hub and runner', () => {
  test.use(loggedIn('admin'));
  test.setTimeout(120_000);

  let session: ApiSession;
  let reportId: string | undefined;

  test.afterEach(async ({ request }) => {
    if (reportId !== undefined) await archiveReport(request, session, reportId);
  });

  test('hub -> run with a prompt -> totals -> print; hub and runner fit a phone', async ({
    page,
    context,
    request,
  }) => {
    session = await adminApiSession(request);
    const suffix = runSuffix();
    const name = `E2E Runner ${suffix}`;
    const { chain, students } = await createClassWithStudents(
      request,
      session,
      `E2E Runner ${suffix}`,
      ['MALE', 'FEMALE', 'MALE'],
    );
    const everyone = students.length;
    const girls = students.filter((student) => student.gender === 'FEMALE').length;
    const report = await createPublishedReport(request, session, {
      name,
      definition: classByGenderDefinition(name, chain.className),
    });
    reportId = report.id;

    const result = page.getByRole('region', { name: t('reports.runner.resultLabel') });
    const total = () => rowTotal(result, chain.className);

    await test.step('the hub lists the report; opening it shows the answer at once', async () => {
      await page.goto('/reports');
      await expect(
        page.getByRole('heading', { level: 1, name: t('reports.hub.title') }),
      ).toBeVisible();
      await page.getByLabel(t('reports.hub.searchLabel')).fill(name);
      await page.getByRole('link', { name, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`/reports/${report.id}`));
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      // No form to fill first: the run starts by itself and the class's own "মোট" is the head count.
      await expect(total()).toBeVisible();
      expect(numberIn(await total().innerText())).toBe(everyone);
      await expect(
        result.getByRole('columnheader', { name: t('reportView.total'), exact: true }),
      ).toBeVisible();
    });

    await test.step('changing the prompt and pressing "রিপোর্ট দেখান" runs it again', async () => {
      await page.getByRole('button', { name: t('reports.prompts.change'), exact: true }).click();
      await page.getByRole('combobox', { name: GENDER_LABEL }).click();
      await page.getByRole('option', { name: GIRLS, exact: true }).click();
      await page.getByRole('button', { name: t('reports.prompts.run'), exact: true }).click();

      // The answer is kept in the address, so a link reopens the same view.
      await expect.poll(() => reportAnswersIn(page.url())).toEqual({ gender: 'FEMALE' });
      await expect(total()).toHaveText(countPattern(girls));
    });

    await test.step('Print opens the A4 print view of what is on screen', async () => {
      // The print page offers its own Print button: stub it so no real dialog opens, and count calls.
      await context.addInitScript(() => {
        const counter = window as unknown as { __printCalls: number };
        counter.__printCalls = 0;
        window.print = () => {
          counter.__printCalls += 1;
        };
      });
      const printButton = page.getByRole('button', {
        name: t('reports.runner.print'),
        exact: true,
      });
      await expect(printButton).toBeEnabled();
      const [popup] = await Promise.all([context.waitForEvent('page'), printButton.click()]);

      await expect(popup).toHaveURL(/\/print\/document\?/);
      const printUrl = new URL(popup.url());
      expect(printUrl.searchParams.get('doc')).toBe('report');
      expect(printUrl.searchParams.get('definitionId')).toBe(report.id);
      expect(JSON.parse(printUrl.searchParams.get('params') ?? '{}')).toEqual({ gender: 'FEMALE' });
      await expect(popup.getByRole('heading', { level: 1, name })).toBeVisible();
      await expect(popup.getByText(chain.className).first()).toBeVisible();

      const sheetPrint = popup.getByRole('button', { name: t('examDocuments.page.print') });
      await expect(sheetPrint).toBeEnabled();
      await sheetPrint.click();
      await expect
        .poll(() =>
          popup.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
        )
        .toBe(1);
      await popup.close();
    });

    await test.step('at 390 px the hub and the runner have no horizontal scroll', async () => {
      await page.setViewportSize({ width: 390, height: 844 });

      await page.goto('/reports');
      await expect(
        page.getByRole('heading', { level: 1, name: t('reports.hub.title') }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page);

      await page.goto(`/reports/${report.id}`);
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      // The table of counts turns into a list on a phone; wait for it so the width is measured with data.
      await expect(result.getByText(chain.className).first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
});
