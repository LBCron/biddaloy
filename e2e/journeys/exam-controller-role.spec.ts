import { ExamComponentKind, ExamComponentSource } from '@biddaloy/shared';
import type { PlaywrightWorkerArgs } from '@playwright/test';

import { adminApiSession, apiSession, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';

/**
 * [24.4.2] EXAM_CONTROLLER journey (#1369, D13, D16): the built-in exam controller
 * runs exams, seat plans and results, enters marks as backup for an absent teacher (81 D5b), and
 * has no access to fees or settings.
 *
 * Logs in as `exam@biddaloy.test` (seeded by #1368) via `loggedIn()`. The API sets the scene as ADMIN in its own
 * request context (so it never replaces the browser's refresh cookie); the UI
 * drives the flow under test. Uses the seeded "Class 6" like `seat-plans.spec.ts`
 * and `result-publish.spec.ts` do.
 */

test.use(loggedIn('exam_controller'));

async function adminScene(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
) {
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  return { ctx, session: await adminApiSession(ctx) };
}

test('runs an exam: create, seat plan, backup mark entry, publish result', async ({
  page,
  playwright,
  baseURL,
}) => {
  // [#3133] 19-28 s on a normal runner against the 30 s default; slow() triples it.
  test.slow();
  const suffix = Date.now().toString(36).toUpperCase();
  const examName = `E2E Controller Exam ${suffix}`;
  const planName = `E2E Controller Plan ${suffix}`;
  const roomName = `E2E Controller Room ${suffix}`;
  const { ctx, session } = await adminScene(playwright, baseURL);

  // --- scene: seeded Class 6, its first section and first student ---------------
  let academicYearName: string;
  let sectionId: string;
  let studentId: string;
  let scheduleDate: Date;
  try {
    const { data: classes } = await get<{
      data: { id: string; name: string; academic_year_id: string }[];
    }>(ctx, session, '/classes?limit=100');
    const klass = classes.find((c) => c.name === 'Class 6');
    if (!klass) throw new Error('Seeded Class 6 not found — has `yarn seed` run?');
    const sections = await get<{ id: string }[]>(ctx, session, `/classes/${klass.id}/sections`);
    if (!sections[0]) throw new Error('Seeded Class 6 has no section — has `yarn seed` run?');
    sectionId = sections[0].id;
    const { data: students } = await get<{ data: { id: string }[] }>(
      ctx,
      session,
      `/students?section_id=${sectionId}&limit=1`,
    );
    if (!students[0]) throw new Error(`Section ${sectionId} of Class 6 has no student`);
    studentId = students[0].id;
    const year = await get<{ name: string; start_date: string }>(
      ctx,
      session,
      `/academic-years/${klass.academic_year_id}`,
    );
    academicYearName = year.name;
    scheduleDate = new Date(year.start_date);
    scheduleDate.setUTCDate(scheduleDate.getUTCDate() + 10);
  } catch (error) {
    await ctx.dispose();
    throw error;
  }

  // --- 1. create the exam from the UI -------------------------------------------
  await page.goto('/exams');
  await page.getByRole('button', { name: t('exams.list.addExam') }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(t('exams.examForm.nameLabel'), { exact: true }).fill(examName);
  await dialog.getByRole('combobox', { name: t('exams.examForm.academicYearLabel') }).click();
  await page.getByRole('option', { name: academicYearName, exact: true }).first().click();
  await dialog.getByRole('combobox', { name: t('exams.examForm.classLabel') }).click();
  await page.getByRole('option', { name: 'Class 6', exact: true }).first().click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/exams') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: t('exams.examForm.save') }).click();
  const response = await created;
  expect(response.ok(), await response.text()).toBe(true);
  const exam = (await response.json()) as { id: string };
  await expect(dialog).toBeHidden();

  // --- scene part 2 (needs the exam id): subject, schedule, room, one saved (unsubmitted) mark
  let subjectId: string;
  let subjectName: string;
  try {
    const subject = await post<{ id: string; name_bn: string }>(ctx, session, '/subjects', {
      code: `E2EXC-${suffix}`,
      name_en: `E2E Controller Subject ${suffix}`,
      name_bn: `ই২ই নিয়ন্ত্রক ${suffix}`,
    });
    subjectId = subject.id;
    // bn screens label the seat-plan picker with `name_bn`.
    subjectName = subject.name_bn;
    await post(ctx, session, `/exams/${exam.id}/schedule`, {
      subject_id: subjectId,
      date: scheduleDate.toISOString().slice(0, 10),
      starts_at: '09:00',
      ends_at: '11:00',
    });
    await post(ctx, session, '/routines/rooms', { room_no: roomName, capacity: 10 });
    const component = await post<{ id: string }>(ctx, session, `/exams/${exam.id}/components`, {
      subject_id: subjectId,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      source: ExamComponentSource.MANUAL,
      full_marks: '100.00',
      pass_marks: '33.00',
      sequence: 1,
    });
    const marks = await ctx.patch(`/api/v1/exams/${exam.id}/marks`, {
      headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
      data: {
        section_id: sectionId,
        subject_id: subjectId,
        cells: [
          { student_id: studentId, component_id: component.id, value: '88.00', status: 'PRESENT' },
        ],
      },
    });
    expect(marks.ok()).toBe(true);
  } finally {
    await ctx.dispose();
  }

  // --- 2. seat plan -------------------------------------------------------------
  await page.goto('/exams/seat-plans');
  await page.getByRole('button', { name: t('seatPlans.list.generateButton') }).click();
  await page.getByLabel(t('seatPlans.generate.nameLabel')).fill(planName);
  await page.getByRole('combobox', { name: t('seatPlans.generate.examLabel') }).click();
  await page.getByRole('option', { name: examName }).click();
  await page.getByTestId('schedule-picker').getByRole('checkbox', { name: subjectName }).check();
  await page.getByTestId('room-picker').getByRole('checkbox', { name: roomName }).check();
  await page.getByRole('button', { name: t('seatPlans.generate.submit') }).click();
  // Generating lands straight on the new plan.
  await expect(page.getByRole('heading', { name: planName })).toBeVisible();

  // --- 3. marks grid is editable for the controller (81 D5b): enabled cells, and the API accepts a DRAFT write
  await page.goto(`/marks/${exam.id}/${sectionId}/${subjectId}`);
  await expect(page.getByRole('heading', { name: t('exams.marksGrid.caption') })).toBeVisible();
  await expect(page.getByRole('textbox', { name: / — Written$/ }).first()).toBeEnabled();
  const controller = await apiSession(page.request, 'EXAM_CONTROLLER');
  const write = await page.request.patch(`/api/v1/exams/${exam.id}/marks`, {
    headers: { Authorization: `Bearer ${controller.token}`, 'X-Tenant-ID': controller.tenantId },
    data: { section_id: sectionId, subject_id: subjectId, cells: [] },
  });
  expect(write.status()).toBe(200);

  // --- 4. process and publish the result ----------------------------------------
  await page.goto(`/exams/${exam.id}`);
  await expect(page.getByRole('heading', { name: examName })).toBeVisible();
  // Process / publish / reopen are header actions on the exam detail.
  await page.getByRole('button', { name: t('exams.resultsPanel.process') }).click();
  // The grid is deliberately unsubmitted (step 3) and the second section has none, so the
  // dialog offers only the audited "process anyway" override. That button renders only once
  // the progress query reports outstanding grids, so this click also waits for that load.
  await page
    .getByRole('button', { name: t('exams.processDialog.processAnyway'), exact: true })
    .click();
  await page.getByRole('button', { name: t('exams.resultsPanel.publish') }).click();
  await page.getByRole('button', { name: t('exams.publishDialog.confirm') }).click();
  await page.getByRole('button', { name: t('common.actions.moreActions') }).click();
  await expect(page.getByRole('menuitem', { name: t('exams.resultsPanel.reopen') })).toBeVisible();

  // --- 5. published: the parts panel is read-only with the "reopen first" line ----
  await page.goto(`/exams/${exam.id}?tab=setup`);
  await expect(page.getByText(t('exams.componentsPanel.lockedPublished'))).toBeVisible();
  await expect(page.locator('#component-full-marks')).toHaveCount(0);
});

test('prints documents but cannot manage print templates', async ({ page }) => {
  // Admit cards do not exist yet (Epic 48), so the printable document today is the ID card:
  // the preview opens for this role (DOCUMENT_PRINT) ...
  // With no ids the preview opens its "who to print" picker; wait for it, then check no denial.
  await page.goto('/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT');
  await expect(page.getByRole('heading', { name: t('printPreview.picker.title') })).toBeVisible();
  await expect(page.getByRole('heading', { name: t('common.accessDenied.title') })).toHaveCount(0);
  // ... but template editing (PRINT_TEMPLATE_MANAGE) is refused.
  await page.goto('/print-templates');
  await expect(page.getByRole('heading', { name: t('common.accessDenied.title') })).toBeVisible();
});

test('cannot reach fees or settings', async ({ page }) => {
  const shell = new AppShellPage(page);
  await page.goto('/dashboard');
  await shell.expectNavItem('nav.items.seatPlans', true);
  for (const key of [
    'nav.items.fees',
    'nav.items.payments',
    'nav.items.feeStructures',
    'nav.items.recordPayment',
    'nav.items.settings',
  ]) {
    await shell.expectNavItem(key, false);
  }
  for (const route of ['/settings', '/fees']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: t('common.accessDenied.title') })).toBeVisible();
  }
});
