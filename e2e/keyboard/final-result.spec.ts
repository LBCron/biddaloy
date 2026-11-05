import {
  adminApiSession,
  createClassSection,
  currentAcademicYear,
  newClassSubject,
  post,
  publishedTermExam,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { tabToLocator } from './keyboard-utils';

/**
 * [70.5.5] Final result, KEYBOARD ONLY (no `page.mouse`, no `.click(`): Ctrl+K "চূড়ান্ত ফলাফল"
 * Enter lands on the class list; Tab to the class's Start, Enter opens the new final's detail;
 * Tab to Build, Enter, Tab to the dialog's Build, Enter builds it (the screen contract's
 * keyboard path, D12). A fresh class with one published TERM exam keeps it rerunnable.
 */

test.use(loggedIn('admin'));

test('keyboard-only: palette to the list, Start, Build', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = await adminApiSession(request);
  const year = await currentAcademicYear(request, session);
  const chain = await createClassSection(request, session, year);
  const student = await post<{ id: string }>(request, session, '/students', {
    full_name: `E2E Final Key ${Date.now()}`,
    class_section_id: chain.sectionId,
  });
  const subject = await newClassSubject(request, session, chain.classId, year.id);
  await publishedTermExam(
    request,
    session,
    { ...chain, subjectId: subject.id },
    `E2E Final Key Exam ${Date.now()}`,
    { [student.id]: '70.00' },
  );

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('Ctrl+K "চূড়ান্ত ফলাফল" Enter', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+2');
    await page.keyboard.type(t('nav.items.finalResults'));
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/results\/final$/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('exams.finalResults.title') }),
    ).toBeVisible();
  });

  await test.step('Tab to Start, Enter', async () => {
    const start = page
      .getByRole('row', { name: new RegExp(chain.className) })
      .getByRole('button', { name: t('exams.finalResults.list.start') });
    await tabToLocator(page, start);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/results\/final\/[0-9a-f-]+/);
  });

  await test.step('Tab to Build, Enter, confirm with Enter', async () => {
    await tabToLocator(
      page,
      page.getByRole('button', { name: t('exams.finalResults.actions.build') }),
    );
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: t('exams.finalResults.buildDialog.title') });
    await expect(dialog).toBeVisible();
    await tabToLocator(
      page,
      dialog.getByRole('button', { name: t('exams.finalResults.buildDialog.confirm') }),
      10,
    );
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: t('exams.finalResults.actions.publish') }),
    ).toBeVisible();
  });
});
