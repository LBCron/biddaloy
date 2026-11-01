import type { ReportDefinitionJson } from '@biddaloy/shared';

import {
  adminApiSession,
  createTeacherForSection,
  get,
  loginAsFreshUser,
  patch,
  post,
} from '../api';
import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ListShellPage } from '../pages';

import {
  archiveReport,
  countPattern,
  createClassWithStudents,
  drillLink,
  rowTotal,
  runSuffix,
} from './helpers';

/**
 * [8.15.43] The whole designer path, end to end. The admin starts from the question "কতজন …, …
 * অনুযায়ী?", sees the result build in the preview, saves it for teachers and switches it on. A
 * teacher finds it in the hub, runs it (the engine narrows it to her own sections), and follows a
 * class's count to her students.
 *
 * Why the drill is added through the API: the designer has no editor for links yet (a saved report
 * only keeps the links it already had), so a report made from a question has none. The spec adds
 * the rule to the saved draft and switches that version on, the same JSON a system report carries
 * (`student-count-banbeis`). It points at the student list (`/students`), which a teacher may open;
 * the ready "Student list" report is not shown to teachers, so a link to it would not appear.
 *
 * The teacher is a fresh account assigned to this spec's own class, not the shared seeded teacher,
 * whose sections other specs rely on. Her answer is therefore exactly this class: three students.
 */
test.describe('report designer', () => {
  test.use(loggedIn('admin'));
  test.setTimeout(150_000);

  test('admin designs, previews and publishes; a teacher runs it and follows a count', async ({
    page,
    request,
    browser,
    playwright,
  }) => {
    const session = await adminApiSession(request);
    const suffix = runSuffix();
    const name = `E2E Designer ${suffix}`;
    const own = await createClassWithStudents(request, session, `E2E Designer ${suffix}`, [
      'MALE',
      'FEMALE',
      'MALE',
    ]);
    const teacher = await createTeacherForSection(
      request,
      session,
      `E2E Designer Teacher ${suffix}`,
      own.chain,
    );
    let reportId: string | undefined;

    try {
      await test.step('admin: pick a question, the preview builds the answer', async () => {
        await page.goto('/reports/new');
        const question = page.getByRole('group', {
          name: t('reportDesigner.starters.howMany.title'),
          exact: true,
        });
        await question.getByRole('button', { name: t('reportDesigner.start.question.go') }).click();

        // The question's own defaults: students, by class and gender.
        const preview = page.getByRole('region', {
          name: t('reportDesigner.preview.title'),
          exact: true,
        });
        await expect(preview.getByRole('table')).toBeVisible();
        await expect(
          preview.getByRole('columnheader', { name: t('reportView.total'), exact: true }),
        ).toBeVisible();
      });

      await test.step('admin: save for teachers and switch it on for everyone', async () => {
        await page
          .getByRole('button', { name: t('reportDesigner.save.button'), exact: true })
          .click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(t('reportDesigner.save.nameLabel')).fill(name);
        await dialog.getByRole('checkbox', { name: t('staff.roles.TEACHER'), exact: true }).check();
        await dialog.getByRole('button', { name: t('reportDesigner.save.publish') }).click();

        await expect(page.getByText(t('reportDesigner.save.published'))).toBeVisible();
        // The address now names the saved report.
        await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}\/edit$/);
        reportId = /\/reports\/([0-9a-f-]{36})\/edit/.exec(page.url())![1]!;
      });

      await test.step('api: add a link from a class count to the student list, switch that on', async () => {
        const saved = await get<{ draft: ReportDefinitionJson }>(
          request,
          session,
          `/reports/definitions/${reportId}`,
        );
        await patch(request, session, `/reports/definitions/${reportId}`, {
          definition: {
            ...saved.draft,
            drill: [
              { field: 'class', target: { route: '/students' }, pass: { class_id: 'class' } },
            ],
          },
        });
        await post(request, session, `/reports/definitions/${reportId}/publish`, {});
      });

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
        const teacherPage = await teacherContext.newPage();
        const result = teacherPage.getByRole('region', { name: t('reports.runner.resultLabel') });

        await test.step('teacher: finds it in the hub and runs it', async () => {
          await teacherPage.goto('/reports');
          await expect(
            teacherPage.getByRole('heading', { level: 1, name: t('reports.hub.title') }),
          ).toBeVisible();
          // A teacher may run reports but not design them: no "new report" button.
          await expect(
            teacherPage.getByRole('link', { name: t('reportDesigner.title.new') }),
          ).toHaveCount(0);
          await teacherPage.getByRole('link', { name, exact: true }).click();

          await expect(teacherPage).toHaveURL(new RegExp(`/reports/${reportId}`));
          await expect(teacherPage.getByRole('heading', { level: 1, name })).toBeVisible();
          // Only her class is in the answer, so its "মোট" is her three students.
          await expect(rowTotal(result, own.chain.className)).toHaveText(countPattern(3));
        });

        await test.step("teacher: a class's count opens her students, and ফিরে যান returns", async () => {
          await drillLink(result, own.chain.className).first().click();

          await expect(teacherPage).toHaveURL(/\/students\?/);
          const students = new URL(teacherPage.url());
          expect(students.searchParams.get('class_id')).toBe(own.chain.classId);
          expect(students.searchParams.get('from')).toContain(`/reports/${reportId}`);
          const list = new ListShellPage(teacherPage, { titleKey: 'students.list.title' });
          await list.expectLoaded();
          await list.expectResultCount(own.students.length);

          await teacherPage.getByRole('link', { name: t('reportDesigner.back') }).click();
          await expect(teacherPage).toHaveURL(new RegExp(`/reports/${reportId}`));
        });
      } finally {
        await teacherContext.close();
        await teacherApi.dispose();
      }
    } finally {
      if (reportId !== undefined) await archiveReport(request, session, reportId);
    }
  });
});
