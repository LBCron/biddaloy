import { adminApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages';

import {
  catalogueEntry,
  countPattern,
  createClassWithStudents,
  drillLink,
  readTotals,
  reportAnswersIn,
  rowTotal,
  runSuffix,
} from './helpers';

/**
 * [8.15.34] The ready reports every school gets, end to end: the admin opens the student count from
 * the sidebar, lands on the BANBEIS report through the redirect, reads the class by gender totals,
 * and follows a class's count to the student list with that class chosen, and back.
 *
 * Runs in the default project on the dev seed: the first look at the catalogue puts the ready
 * reports into the school (`ReportDefinitionsService.ensureSystemReports`), so no demo database is
 * needed. It adds two classes of its own in the current academic year (two students and one), so the
 * numbers it checks are its own and the "মোট" row is checked against whatever else the school holds.
 */
test.describe('system reports', () => {
  test.use({ ...loggedIn('admin'), viewport: { width: 1440, height: 900 } });
  test.setTimeout(90_000);

  test('student count -> BANBEIS report -> totals -> a count opens the student list', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const suffix = runSuffix();
    const banbeis = await catalogueEntry(request, session, 'student-count-banbeis');
    const studentList = await catalogueEntry(request, session, 'student-list');
    const own = await createClassWithStudents(request, session, `E2E Count ${suffix}`, [
      'MALE',
      'FEMALE',
    ]);
    const other = await createClassWithStudents(request, session, `E2E Other ${suffix}`, [
      'FEMALE',
    ]);

    const result = page.getByRole('region', { name: t('reports.runner.resultLabel') });
    const banbeisTitle = page.getByRole('heading', { level: 1, name: banbeis.name_bn });

    await test.step('the sidebar item lands on the report, not on a page of its own', async () => {
      await page.goto('/dashboard');
      await new AppShellPage(page).navigateTo('nav.items.studentCount');
      // The old address only forwards (D23): the report's own address replaces it.
      await expect(page).toHaveURL(new RegExp(`/reports/${banbeis.id}(\\?|$)`));
      await expect(banbeisTitle).toBeVisible();
    });

    await test.step('a saved link to the old address still forwards', async () => {
      await page.goto('/reports/student-count');
      await expect(page).toHaveURL(new RegExp(`/reports/${banbeis.id}(\\?|$)`));
      await expect(banbeisTitle).toBeVisible();
    });

    await test.step('class by gender with totals that add up', async () => {
      const table = result.getByRole('table');
      await expect(table).toBeVisible();
      await expect(
        table.getByRole('columnheader', { name: t('reportView.total'), exact: true }),
      ).toBeVisible();

      await expect(rowTotal(result, own.chain.className)).toHaveText(countPattern(2));
      await expect(rowTotal(result, other.chain.className)).toHaveText(countPattern(1));

      // The "মোট" row is the sum of every class above it, whatever else the school holds.
      const rows = await readTotals(table);
      const grand = rows.find((row) => row.heading === t('reportView.total'));
      expect(grand, 'a "মোট" row').toBeDefined();
      const classes = rows.filter((row) => row !== grand);
      expect(classes.length).toBeGreaterThanOrEqual(2);
      expect(classes.reduce((sum, row) => sum + row.total, 0)).toBe(grand!.total);
    });

    await test.step("a class's count opens the student list with that class chosen", async () => {
      await drillLink(result, own.chain.className).first().click();

      await expect(page).toHaveURL(new RegExp(`/reports/${studentList.id}\\?`));
      expect(reportAnswersIn(page.url())).toMatchObject({ class: own.chain.className });
      expect(new URL(page.url()).searchParams.get('from')).toContain(`/reports/${banbeis.id}`);
      await expect(
        page.getByRole('heading', { level: 1, name: studentList.name_bn }),
      ).toBeVisible();

      // Filters applied: this class's students are listed, the other class's student is not.
      for (const student of own.students) {
        await expect(result.getByText(student.name, { exact: true })).toBeVisible();
      }
      await expect(result.getByText(other.students[0]!.name, { exact: true })).toHaveCount(0);
    });

    await test.step('ফিরে যান returns to the count', async () => {
      await page.getByRole('link', { name: t('reportDesigner.back') }).click();
      await expect(page).toHaveURL(new RegExp(`/reports/${banbeis.id}(\\?|$)`));
      await expect(banbeisTitle).toBeVisible();
    });
  });
});
