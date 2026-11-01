import type { Locator, Page } from '@playwright/test';

import {
  adminApiSession,
  createClassSection,
  createTeacher,
  createTeacherForSection,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [29.0/#1025] Class detail's Teachers tab, KEYBOARD ONLY: tab into the
 * per-section "Assign" button, pick a teacher through the shared
 * `AssignTeacherDialog` combobox (same type/ArrowDown/Enter shape
 * `command-palette.spec.ts` already exercises for a combobox), submit,
 * and see the new row without a reload.
 */

test.use(loggedIn('admin'));

test('keyboard-only: assign a teacher from the class detail Teachers tab', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const { classId, className } = await createClassSection(request, session);
  // `Date.now()` alone collided across parallel workers running a
  // sibling spec's own teacher creation at the same millisecond,
  // producing two identically-named teachers and a strict-mode option
  // match violation — the same entropy `crypto.randomUUID()` already
  // gives `e2e/api.ts`'s own suffixes.
  const teacherName = `E2E Teacher ${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  // `createTeacher`, not `createTeacherForSection` — this spec's own
  // empty-state assertion below needs a teacher with zero assignments to
  // start; `createTeacherForSection` always creates a class-teacher row.
  await createTeacher(request, session, teacherName);

  await page.goto(`/classes/${classId}?tab=teachers`);
  await expect(page.getByRole('heading', { name: className })).toBeVisible();
  await expect(page.getByText(t('classes.detail.teachers.emptySectionMessage'))).toBeVisible();

  await test.step('tab to Assign, keyboard only', async () => {
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    // Skip link first, like every other keyboard spec. Tabbing from the top of the document
    // walks the whole sidebar before reaching main, so the press count grows with every nav
    // item ever added (it needed exactly 60 until [39.0] added one link, then failed).
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: t('nav.skipToContent') })).toBeFocused();
    await page.keyboard.press('Enter');
    await tabUntilFocused(page, t('classes.detail.teachers.assign'), 60, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
  });

  const dialog = page.getByRole('dialog', { name: t('classes.assignTeacherForm.title') });
  await expect(dialog).toBeVisible();

  await test.step('pick a teacher and submit, keyboard only', async () => {
    const combo = dialog.getByRole('combobox', {
      name: t('classes.assignTeacherForm.teacherLabel'),
    });
    await combo.focus();
    await page.keyboard.type(teacherName);
    // Radix `Combobox` portals its listbox to the document body, not as a
    // DOM descendant of the dialog — scope to `page`, matching every other
    // Combobox-driving spec in this suite (`command-palette.spec.ts`,
    // `homework.spec.ts`).
    await expect(page.getByRole('option', { name: new RegExp(teacherName) })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await tabUntilFocused(page, t('classes.assignTeacherForm.save'), 20, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
  });

  await expect(dialog).toBeHidden();
  await expect(page.getByText(new RegExp(teacherName))).toBeVisible();
});

/** [47.4.4] Shared by the two role tests below: reach the section's "Assign"
 * button by keyboard (same walk as the first test) and open the dialog. */
async function openAssignDialogByKeyboard(
  page: Page,
  classId: string,
  className: string,
  existingTeacher: string,
) {
  await page.goto(`/classes/${classId}?tab=teachers`);
  await expect(page.getByRole('heading', { name: className })).toBeVisible();
  // Wait for the tab to render its rows: tabbing earlier walks past a button
  // that is not in the DOM yet.
  await expect(page.getByText(new RegExp(existingTeacher))).toBeVisible();
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: t('nav.skipToContent') })).toBeFocused();
  await page.keyboard.press('Enter');
  await tabUntilFocused(page, t('classes.detail.teachers.assign'), 60, { tag: 'BUTTON' });
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: t('classes.assignTeacherForm.title') });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Picks `teacherName` in the dialog's combobox by typing. */
async function pickTeacherByKeyboard(page: Page, dialog: Locator, teacherName: string) {
  await dialog.getByRole('combobox', { name: t('classes.assignTeacherForm.teacherLabel') }).focus();
  await page.keyboard.type(teacherName);
  await expect(page.getByRole('option', { name: new RegExp(teacherName) })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

/** Radix radios ignore Enter, so submit by focusing the real submit button. */
async function submitByKeyboard(page: Page) {
  await tabUntilFocused(page, t('classes.assignTeacherForm.save'), 20, { tag: 'BUTTON' });
  await page.keyboard.press('Enter');
}

test('keyboard-only: assign an assistant class teacher, the class teacher stays', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const { classId, className, sectionId } = await createClassSection(request, session);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const classTeacherName = `E2E Homeroom ${suffix}`;
  const assistantName = `E2E Assistant ${suffix}`;
  await createTeacherForSection(request, session, classTeacherName, { classId, sectionId });
  await createTeacher(request, session, assistantName);

  const dialog = await openAssignDialogByKeyboard(page, classId, className, classTeacherName);
  await pickTeacherByKeyboard(page, dialog, assistantName);
  // Tab into the radio group (focus lands on the checked CLASS_TEACHER
  // radio, after the legend's (?) button, which tabUntilFocused skips),
  // ArrowDown moves focus to the ASSISTANT radio and Space selects it.
  const assistantRadio = dialog.getByRole('radio', {
    name: t('classes.assignmentType.ASSISTANT_CLASS_TEACHER'),
  });
  await tabUntilFocused(page, t('classes.assignmentType.CLASS_TEACHER'), 6, { tag: 'BUTTON' });
  await page.keyboard.press('ArrowDown');
  await expect(assistantRadio).toBeFocused();
  await page.keyboard.press('Space');
  await expect(assistantRadio).toBeChecked();
  await submitByKeyboard(page);

  await expect(dialog).toBeHidden();
  await expect(page.getByText(new RegExp(assistantName))).toBeVisible();
  // An assistant is added alongside, not instead of, the class teacher.
  await expect(page.getByText(new RegExp(classTeacherName))).toBeVisible();
});

test('keyboard-only: assigning a new class teacher announces the replace warning', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const { classId, className, sectionId } = await createClassSection(request, session);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const oldName = `E2E Old Homeroom ${suffix}`;
  const newName = `E2E New Homeroom ${suffix}`;
  await createTeacherForSection(request, session, oldName, { classId, sectionId });
  await createTeacher(request, session, newName);

  const dialog = await openAssignDialogByKeyboard(page, classId, className, oldName);
  await pickTeacherByKeyboard(page, dialog, newName);

  // CLASS_TEACHER is the default type, so picking a different teacher is
  // enough. The warning sits in a polite live region so a screen reader
  // reads it out when it appears.
  const warning = t('classes.assignDialog.replaceWarning', { name: oldName });
  await expect(dialog.locator('[aria-live="polite"]').filter({ hasText: warning })).toBeVisible();

  await submitByKeyboard(page);
  await expect(dialog).toBeHidden();
  await expect(page.getByText(new RegExp(newName))).toBeVisible();
});
