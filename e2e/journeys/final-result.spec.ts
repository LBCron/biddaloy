import {
  adminApiSession,
  createClassSection,
  currentAcademicYear,
  get,
  newClassSubject,
  patch,
  post,
  publishedTermExam,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [70.5.5] Final result, end to end (#3421).
 *
 * 1. The exam controller sets up, builds and publishes the final result of a class this spec
 *    creates (current year, two published TERM exams). Shares go 30 / 70 through the Setup
 *    tab, the usability test's task (ক). One final per class and year, so a fresh class keeps
 *    the spec rerunnable on the same database.
 * 2. The seeded guardian (`parent@biddaloy.test`, Class 6 / A roll 1, the only child a portal
 *    login can see) gets a final card on /portal/results. That class's final is shared state,
 *    so the spec reuses it when it exists and builds it only from an exam it publishes itself.
 *
 * Runs in the `bn` locale; every string comes from the app's catalog through `t()`.
 */

interface FinalListRow {
  class: { id: string };
  final_result_id: string | null;
  status: string;
}

test.describe.serial('final result: build and publish, then the guardian sees it', () => {
  test.describe('1. exam controller builds and publishes', () => {
    test.use(loggedIn('exam_controller'));

    test('Start, shares 30 / 70, Build, Publish', async ({ page, request }) => {
      test.setTimeout(120_000);
      const session = await adminApiSession(request);
      const year = await currentAcademicYear(request, session);
      const chain = await createClassSection(request, session, year);
      const student = await post<{ id: string }>(request, session, '/students', {
        full_name: `E2E Final ${Date.now()}`,
        class_section_id: chain.sectionId,
      });
      const subject = await newClassSubject(request, session, chain.classId, year.id);
      const scope = { ...chain, subjectId: subject.id };
      const stamp = Date.now();
      const halfYearly = `E2E Half Yearly ${stamp}`;
      const annual = `E2E Annual ${stamp}`;
      await publishedTermExam(request, session, scope, halfYearly, { [student.id]: '80.00' });
      await publishedTermExam(request, session, scope, annual, { [student.id]: '90.00' });

      await test.step('Start from the class list', async () => {
        await page.goto('/results/final');
        await expect(
          page.getByRole('heading', { level: 1, name: t('exams.finalResults.title') }),
        ).toBeVisible();
        const row = page.getByRole('row', { name: new RegExp(chain.className) });
        await row.getByRole('button', { name: t('exams.finalResults.list.start') }).click();
        await expect(page).toHaveURL(/\/results\/final\/[0-9a-f-]+/);
      });

      await test.step('shares 30 / 70 on the Setup tab', async () => {
        const share = (exam: string) =>
          page.getByRole('spinbutton', {
            name: `${exam} · ${t('exams.finalResults.setup.shareColumn')}`,
          });
        await share(halfYearly).fill('30');
        await share(annual).fill('70');
        const saved = page.waitForResponse(
          (r) => r.request().method() === 'PATCH' && /\/final-results\/[^/]+$/.test(r.url()),
        );
        await page.getByRole('button', { name: t('exams.finalResults.setup.save') }).click();
        expect((await saved).ok()).toBe(true);
      });

      await test.step('Build', async () => {
        await page.getByRole('button', { name: t('exams.finalResults.actions.build') }).click();
        const dialog = page.getByRole('dialog', {
          name: t('exams.finalResults.buildDialog.title'),
        });
        await dialog
          .getByRole('button', { name: t('exams.finalResults.buildDialog.confirm') })
          .click();
        await expect(
          page.getByRole('button', { name: t('exams.finalResults.actions.publish') }),
        ).toBeVisible();
      });

      await test.step('Publish', async () => {
        await page.getByRole('button', { name: t('exams.finalResults.actions.publish') }).click();
        const dialog = page.getByRole('dialog', {
          name: t('exams.finalResults.publishDialog.title'),
        });
        await dialog
          .getByRole('button', { name: t('exams.finalResults.publishDialog.confirm') })
          .click();
        await expect(
          page.getByText(t('exams.finalResults.status.PUBLISHED')).first(),
        ).toBeVisible();
      });

      // 30% of 80 + 70% of 90 = 87: the shares typed above are the ones the build used.
      const list = await get<FinalListRow[]>(
        request,
        session,
        `/final-results?academic_year_id=${year.id}`,
      );
      const final = list.find((r) => r.class.id === chain.classId);
      expect(final?.status).toBe('PUBLISHED');
      const rows = await get<{ data: { student: { id: string }; total_marks: number }[] }>(
        request,
        session,
        `/final-results/${final!.final_result_id}/rows`,
      );
      expect(rows.data.find((r) => r.student.id === student.id)?.total_marks).toBe(87);
    });
  });

  test.describe('2. guardian sees the final card', () => {
    test.use(loggedIn('parent'));

    test('portal Results shows the published final first', async ({ page, request }) => {
      test.setTimeout(120_000);
      const session = await adminApiSession(request);
      const classes = await get<{ data: { id: string; name: string; academic_year_id: string }[] }>(
        request,
        session,
        '/classes?limit=100',
      );
      let child: { id: string; classId: string; sectionId: string; yearId: string } | undefined;
      for (const klass of classes.data.filter((c) => c.name === 'Class 6')) {
        const sections = await get<{ id: string; section_name: string }[]>(
          request,
          session,
          `/classes/${klass.id}/sections`,
        );
        const section = sections.find((s) => s.section_name === 'A');
        if (!section) continue;
        const { data: students } = await get<{ data: { id: string; roll_number: number }[] }>(
          request,
          session,
          `/students?section_id=${section.id}&limit=100`,
        );
        const rollOne = students.find((s) => s.roll_number === 1);
        if (rollOne) {
          child = {
            id: rollOne.id,
            classId: klass.id,
            sectionId: section.id,
            yearId: klass.academic_year_id,
          };
          break;
        }
      }
      if (!child) throw new Error('Seeded Class 6 / A roll 1 not found: was `yarn seed` run?');

      const finals = await get<FinalListRow[]>(
        request,
        session,
        `/final-results?academic_year_id=${child.yearId}`,
      );
      const final = finals.find((r) => r.class.id === child.classId);
      // A built final only needs publishing; a draft (or none) is weighted to one exam this spec
      // publishes itself, so a Class 6 exam another spec reopened cannot make the build refuse.
      if (final?.status === 'PROCESSED') {
        await post(request, session, `/final-results/${final.final_result_id}/publish`, {});
      } else if (final?.status !== 'PUBLISHED') {
        // A subject Class 6 already has: a new one would count in every later Class 6 exam.
        const [subject] = await get<{ subject_id: string }[]>(
          request,
          session,
          `/classes/${child.classId}/subjects?academic_year_id=${child.yearId}`,
        );
        if (!subject) throw new Error('Seeded Class 6 has no subject');
        const exam = await publishedTermExam(
          request,
          session,
          { ...child, academicYearId: child.yearId, subjectId: subject.subject_id },
          `E2E Final Portal ${Date.now()}`,
          { [child.id]: '75.00' },
        );
        const id =
          final?.final_result_id ??
          (
            await post<{ id: string }>(request, session, '/final-results', {
              class_id: child.classId,
              academic_year_id: child.yearId,
            })
          ).id;
        await patch(request, session, `/final-results/${id}`, {
          weights: [{ exam_id: exam.id, share_percent: 100 }],
        });
        await post(request, session, `/final-results/${id}/build`, {});
        await post(request, session, `/final-results/${id}/publish`, {});
      }

      await page.goto(`/portal/results?student=${child.id}`);
      await expect(
        page.getByRole('heading', { name: t('portal.results.title'), exact: true }),
      ).toBeVisible();
      await expect(page.locator('#final-result-title')).toBeVisible();
    });
  });
});
