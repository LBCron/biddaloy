import {
  adminApiSession,
  createClassSection,
  createTeacherForSection,
  currentAcademicYear,
  post,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { selectByTypeahead, tabUntilFocused } from './keyboard-utils';

/**
 * [29.0] Teaching assignments bulk view, KEYBOARD ONLY for navigation, the
 * class filter, and unassign — no `page.mouse` and no `.click(` call in
 * this file.
 *
 * The "Assign teacher" flow itself is deliberately **not** driven here:
 * its `Combobox` teacher picker (`-assign-teacher-dialog.tsx`) has no
 * keyboard-only precedent anywhere in this suite yet (grep it — every
 * existing `Combobox` usage is exercised through `.click(` elsewhere), so
 * faking one here risks asserting behavior no other spec has proven. A
 * seeded assignment (via the API, same as `createTeacherForSection`'s own
 * seeding) plus this spec's own keyboard unassign covers the row action
 * that *is* new to this route. Driving the assign dialog itself by
 * keyboard is flagged as a follow-up once a `Combobox` keyboard pattern
 * exists to clone.
 */

test.use(loggedIn('admin'));

test('keyboard-only: filter by class, then unassign a teacher', async ({ page, request }) => {
  const session = await adminApiSession(request);
  // The class picker lists only the current academic year's classes (#2867).
  const chain = await createClassSection(
    request,
    session,
    await currentAcademicYear(request, session),
  );
  const teacher = await createTeacherForSection(request, session, 'Keyboard Teacher', chain);
  await post(request, session, `/classes/${chain.classId}/sections/${chain.sectionId}/teachers`, {
    teacher_id: teacher.teacherId,
  });

  await page.goto('/staff/teaching-assignments');
  await expect(
    page.getByRole('heading', { name: t('teacherAssignments.list.title') }),
  ).toBeVisible();

  await test.step('select the class by keyboard', async () => {
    // Cold `page.goto` leaves focus on `<body>` (no route-focus target on
    // first load) — the shell's nav sidebar + header sit between it and
    // this page's own filter bar, so budget for all of that, not just the
    // filter itself. Same body-reset preamble as `organisation-structure.spec.ts`.
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    // `exact`: the "By class" tab trigger also contains the class label and comes first in Tab order.
    await tabUntilFocused(page, t('teacherAssignments.list.classLabel'), 90, {
      tag: 'BUTTON',
      exact: true,
    });
    // `selectByTypeahead` opens the trigger itself (presses Enter), then
    // types and waits for the exact option before picking it — typing
    // right after the Enter that opens the listbox can lose keystrokes to
    // its open animation.
    await selectByTypeahead(page, chain.className);

    await expect(page.getByText('Keyboard Teacher')).toBeVisible();
  });

  await test.step('unassign by keyboard', async () => {
    // `DataTable` is an ARIA grid with one roving-tabindex cell across the
    // *whole* table (`data-table.tsx`'s `focusedCell` state) -- every
    // other cell has tabIndex=-1, so no number of plain Tab presses can
    // reach a specific row's action button. `.focus()` it directly
    // instead -- the same "establish a known point, then drive by
    // keyboard from there" shape `class-teachers.spec.ts`'s own
    // `combo.focus()` already uses for a Combobox with no other
    // reachability path.
    const unassignButton = page.getByRole('button', {
      name: t('teacherAssignments.list.unassign'),
    });
    // Retry the focus itself, not just the assertion after it: the class
    // filter's own section-teacher queries can still be settling
    // (re-rendering the row) for a moment after `selectByTypeahead`
    // returns, and a `.focus()` issued into that window lands on a node
    // React is about to replace, losing focus again immediately.
    await expect(async () => {
      await unassignButton.focus();
      await expect(unassignButton).toBeFocused();
    }).toPass({ timeout: 5000 });
    // Element-scoped `.press()`, not `page.keyboard.press()` -- guarantees
    // the key event targets this exact element regardless of any focus
    // timing race with the grid's own state updates.
    await unassignButton.press('Enter');

    await expect(page.getByRole('alertdialog')).toBeVisible();
    await tabUntilFocused(page, t('teacherAssignments.unassignDialog.confirm'), 10, {
      tag: 'BUTTON',
    });
    await page.keyboard.press('Enter');

    // Scoped to the table row, not `page` -- the confirm dialog's own
    // description text also contains the teacher's name while it closes.
    await expect(page.getByRole('cell', { name: 'Keyboard Teacher' })).toBeHidden();
  });
});
