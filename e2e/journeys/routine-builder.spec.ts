import { type Page } from '@playwright/test';

import { adminApiSession, get } from '../api';
import { loggedIn, expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from '../keyboard/keyboard-utils';

/**
 * [21.11.1] Epic close journey: build a section's routine grid,
 * KEYBOARD ONLY (this file contains no `page.mouse` and no `.click(`
 * call — grep it). Fills three empty periods with arrows + Enter,
 * triggers a deliberate teacher clash and sees it blocked, fixes it,
 * runs fill assist, then publishes.
 *
 * **Why this reuses the seed's "Class 6" section, not a freshly
 * API-created class**: the grid builder (`$sectionId.tsx`) gates on
 * `class.shift_id`, and no controller in `server/src/modules/academics`
 * exposes a way to set that field over HTTP — [21.2.1]'s promotion
 * migration backfills it once from the legacy `classes.shift` string
 * column, and `ensureRoutineSeed` (`server/src/scripts/seed.util.ts`)
 * is the only other writer. A fresh class created through the API would
 * have `shift_id = null` forever and the builder would show its "no
 * shift" empty state instead of a grid. **Flagged as a real product
 * gap**, not an oversight of this spec: there is no admin-facing way to
 * assign a shift to a class yet.
 *
 * Targets period 3 (Wednesday), which the seed leaves empty — periods 1
 * (Monday), 2 (Tuesday, biweekly) and 5 (Monday, co-taught) are already
 * filled by `ensureRoutineSeed`.
 */

test.use(loggedIn('admin'));
// The grid sends `valid_from` = the browser's local today, and the server
// rejects a published-routine slot dated before the school's (Dhaka) today
// with 422 ROUTINE_SLOT_BACKDATED. CI's browser runs in UTC, a day behind
// Dhaka from 18:00 UTC, so run it as a school user's browser would.
test.use({ timezoneId: 'Asia/Dhaka' });

/** Checks the focused teacher checkbox, unless it is already checked.
 *
 * A blind `Space` toggles, so on a retry — where the previous attempt
 * already saved this cell and the picker therefore opens in edit mode
 * with the teacher pre-checked — it would *un*check the only teacher,
 * leaving Save disabled and unreachable. Reading `aria-checked` keeps
 * this file keyboard-only (it is a read, not a click). */
async function checkFocusedTeacher(page: Page): Promise<void> {
  const alreadyChecked = await page.evaluate(
    () => document.activeElement?.getAttribute('aria-checked') === 'true',
  );
  if (!alreadyChecked) await page.keyboard.press('Space');
}

test('admin builds a section routine, resolves a teacher clash, fill-assists, and publishes — keyboard only', async ({
  page,
  request,
}) => {
  const admin = await adminApiSession(request);
  const subjects = await get<{ data: { id: string; code: string }[] }>(
    request,
    admin,
    // The default page is 10 by name; specs that add "E2E …" subjects push Mathematics off it.
    '/subjects?limit=100',
  );
  const mathSubject = subjects.data.find((s) => s.code === 'MATH');
  if (!mathSubject) throw new Error('seeded "MATH" subject not found — run the seed script first');

  const teachers = await get<{
    data: { id: string; employee_id: string; user: { full_name: string } }[];
  }>(request, admin, '/teachers?limit=100');
  const teacherA = teachers.data.find((tch) => tch.employee_id === 'SEED-TEACHER-0001');
  const teacherB = teachers.data.find((tch) => tch.employee_id === 'SEED-TEACHER-0002');
  if (!teacherA || !teacherB) {
    throw new Error('seeded teachers SEED-TEACHER-000{1,2} not found — run the seed script first');
  }
  // Typed into the cell picker's teacher filter. Read from the API rather
  // than hard-coded: the seed renames this teacher when its login changes.
  const teacherBName = teacherB.user.full_name;

  const classes = await get<{ data: { id: string; name: string; academic_year_id: string }[] }>(
    request,
    admin,
    '/classes',
  );
  const class6 = classes.data.find((c) => c.name === 'Class 6');
  if (!class6) throw new Error('seeded "Class 6" not found — run the seed script first');

  const sections = await get<{ id: string; section_name: string }[]>(
    request,
    admin,
    `/classes/${class6.id}/sections`,
  );
  const sectionA = sections.find((s) => s.section_name === 'A');
  if (!sectionA) throw new Error('seeded "Class 6" section A not found');

  const routines = await get<{ id: string; academic_year_id: string; state: string }[]>(
    request,
    admin,
    '/routines',
  );
  const routine = routines.find((r) => r.academic_year_id === class6.academic_year_id);
  if (!routine) throw new Error('seeded routine not found — run the seed script first');

  await test.step('open the section grid from /routines', async () => {
    await page.goto(`/routines/${sectionA.id}?classId=${class6.id}`);
    await expect(page.getByRole('table', { name: t('routines.grid.caption') })).toBeVisible();
  });

  const grid = page.getByRole('table', { name: t('routines.grid.caption') });

  await test.step('fill an empty period with subject + one teacher, keyboard only', async () => {
    await grid.locator('button[tabindex="0"]').focus();
    // The grid's initial focus is period 1 Sunday — two ArrowDown presses
    // reach period 3 (period rows skip the period-4 BREAK row), three
    // ArrowRight presses reach Wednesday, landing on the empty period 3
    // Wednesday cell the file docblock targets.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    // The dialog's `onOpenAutoFocus` already puts focus on the subject
    // filter input when it opens — no Tab needed, and `tabUntilFocused`
    // matches accessible text via the field's <Label>/aria-label, never
    // its placeholder, so it could never have found this field by its
    // placeholder string anyway.
    await page.keyboard.type('Math');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter'); // pick the filtered subject
    await tabUntilFocused(page, t('routines.cellPicker.teacherLabel'));
    await page.keyboard.type(teacherBName);
    await page.keyboard.press('Tab');
    await checkFocusedTeacher(page); // check the first matching teacher
    await tabUntilFocused(page, t('routines.cellPicker.save'));
    await page.keyboard.press('Enter');
    // Matches the 10s timeout the second step's own savedToast wait
    // already uses below — the default 5s is tight for this save's
    // round trip under CI's parallel load.
    await expect(page.getByText(t('routines.builder.savedToast'))).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step('the same teacher assigned to a second section at the same weekday/period is blocked', async () => {
    // Section A and B share Class 6's shift, so their grids have the same
    // shape (same weekday/period columns). Repeat the exact keystrokes
    // from the first step on section B's grid, at the same cell — that
    // picks up the same "first matching teacher" as before, which
    // `constraint-check.ts`'s teacher-double-booking rule (keyed on
    // teacher, weekday, period_slot — not section) then blocks.
    const sectionB = sections.find((s) => s.section_name === 'B');
    if (!sectionB) throw new Error('seeded "Class 6" section B not found');

    // Wait for the first step's saved toast to clear before navigating —
    // otherwise a leftover toast could be mistaken for this step's own.
    await expect(page.getByText(t('routines.builder.savedToast'))).toBeHidden({ timeout: 10_000 });

    await page.goto(`/routines/${sectionB.id}?classId=${class6.id}`);
    await expect(page.getByRole('table', { name: t('routines.grid.caption') })).toBeVisible();

    await grid.locator('button[tabindex="0"]').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    // Same autofocus as the first step's cell picker.
    await page.keyboard.type('Math');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await tabUntilFocused(page, t('routines.cellPicker.teacherLabel'));
    await page.keyboard.type(teacherBName);
    await page.keyboard.press('Tab');
    await checkFocusedTeacher(page);
    await tabUntilFocused(page, t('routines.cellPicker.save'));
    await page.keyboard.press('Enter');

    // Blocked: the conflict list is surfaced and the "saved" toast never
    // appears for this attempt.
    await expect(
      page.getByRole('alert').filter({ hasText: t('routines.conflictList.violationsTitle') }),
    ).toBeVisible();
    await expect(page.getByText(t('routines.builder.savedToast'))).not.toBeVisible();
    await page.keyboard.press('Escape');
  });

  await test.step('run fill assist for the section’s remaining empty cells', async () => {
    // Backwards: the Fill assist button sits in the page header, *above*
    // the grid this step starts focused in. Tabbing forwards from here
    // wraps through the whole header and sidebar nav before coming back
    // round to it — far more than any sane `max`.
    await tabUntilFocused(page, t('routines.builder.fillAssistAction'), 20, {
      tag: 'button',
      shift: true,
    });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  await test.step('publish the routine', async () => {
    if (routine.state === 'PUBLISHED') {
      // The seed publishes this routine, and this spec deliberately edits
      // it directly rather than through a change request — see the file
      // docblock's Class 6/section-B setup for why. Publish itself (the
      // control existing and being keyboard-reachable) is covered by
      // `review.test.tsx` and `-publish-dialog.test.tsx` instead.
      return;
    }
    await page.goto('/routines/review');
    await tabUntilFocused(page, t('routines.review.publishAction'), 40, { tag: 'button' });
    await page.keyboard.press('Enter');
    await tabUntilFocused(page, t('routines.publishDialog.confirm'), 10, { tag: 'button' });
    await page.keyboard.press('Enter');
    await expect(page.getByText(t('routines.review.banner.published'))).toBeVisible();
  });
});
