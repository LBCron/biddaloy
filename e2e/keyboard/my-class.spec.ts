import { ExamKind } from '@biddaloy/shared';

import { adminApiSession, apiSession, del, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';

import { tabToLocator } from './keyboard-utils';

const t = makeT('en');

/**
 * [47.4.4] "My class", KEYBOARD ONLY (no `page.mouse`, no `.click(`): the
 * command palette reaches the class teacher's screen, and the route puts
 * focus on the one thing a class teacher does each morning, the attendance
 * button.
 *
 * Palette action labels are plain `{ en, bn }` strings in
 * `client-admin/src/action-registry.ts` (not i18n keys), and `/my-class` is
 * matched on its English label/synonyms, so this spec pins the English locale.
 */

test.use({ ...loggedIn('teacher'), e2eLocale: 'en' });

const TAKE_ATTENDANCE = "Take my class's attendance";
const ENTER_NOTES = 'Enter remarks and conduct';

test('Ctrl+K, "my class", Enter lands on the section with focus on the attendance button', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
  await expect(input).toBeFocused();
  // The palette opens on the People tab; "my class" is a page, so switch to Page.
  await page.keyboard.press('Control+2');
  await page.keyboard.type('my class');
  await expect(page.getByRole('option', { name: /my class/i }).first()).toBeVisible();
  await page.keyboard.press('Enter');

  // Single seeded section: the picker redirects to the section page.
  await expect(page).toHaveURL(/\/my-class\/[0-9a-f-]+$/);
  const attendance = page.getByRole('link', { name: t('myClass.takeAttendance') });
  await expect(attendance).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/attendance\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});

test('the palette action "Take my class\'s attendance" opens the register directly', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
  await expect(input).toBeFocused();
  // Actions live on the third tab (same as `command-palette.spec.ts`).
  await page.keyboard.press('Control+3');
  await page.keyboard.type(TAKE_ATTENDANCE);
  await expect(page.getByRole('option', { name: TAKE_ATTENDANCE })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/attendance\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});

test('[70.5.5] the palette action "Enter remarks and conduct" opens the notes grid; a remark saves', async ({
  page,
  request,
}) => {
  // A fresh unpublished exam of the teacher's class: a published target is locked, and the
  // class's final (if another spec published one) would be the grid's default target.
  const teacher = await apiSession(request, 'teacher');
  const [section] = await get<{ section_id: string; class_id: string }[]>(
    request,
    teacher,
    '/my-class/sections',
  );
  if (!section) throw new Error('seed teacher has no homeroom section');
  const admin = await adminApiSession(request);
  const klass = await get<{ academic_year_id: string }>(
    request,
    admin,
    `/classes/${section.class_id}`,
  );
  const exam = await post<{ id: string }>(request, admin, '/exams', {
    name: `E2E Notes ${Date.now()}`,
    kind: ExamKind.TERM,
    academic_year_id: klass.academic_year_id,
    class_id: section.class_id,
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(
    page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
  ).toBeFocused();
  await page.keyboard.press('Control+3');
  await page.keyboard.type(ENTER_NOTES);
  await expect(page.getByRole('option', { name: ENTER_NOTES })).toBeVisible();
  await page.keyboard.press('Enter');
  // Single seeded section: the picker redirects straight to the grid.
  await expect(page).toHaveURL(new RegExp(`/my-class/${section.section_id}/notes`));
  await expect(
    page.getByRole('heading', { level: 1, name: new RegExp(t('myClass.notes.title')) }),
  ).toBeVisible();

  await page.goto(`/my-class/${section.section_id}/notes?for=${exam.id}`);
  const remark = page
    .getByRole('textbox', { name: new RegExp(`^${t('myClass.notes.remarkLabel')}`) })
    .first();
  await tabToLocator(page, remark);
  await page.keyboard.type('Attentive in class.');
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/report-card-notes'),
  );
  await tabToLocator(page, page.getByRole('button', { name: t('myClass.notes.save') }));
  await page.keyboard.press('Enter');
  expect((await saved).ok()).toBe(true);
  // The draft exam would otherwise sort first in the teacher's class for every later spec.
  await del(request, admin, `/exams/${exam.id}`);
});
