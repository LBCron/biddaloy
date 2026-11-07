import type { Page } from '@playwright/test';
import { expect, request } from '@playwright/test';

import {
  adminApiSession,
  apiSession,
  createGuardian,
  createStudentWithDues,
  findSeedSectionA,
  get,
  rawRequest,
} from '../api';
import { makeT, type Locale } from '../i18n';
import { DetailShellPage } from '../pages/detail-shell';
import { ListShellPage } from '../pages/list-shell';
import { ensureDecidableApplications } from '../responsive/routes';

// Duplicated from `server/src/scripts/seed.study-plans.ts` (seed-contract.ts is outside this lane).
const SEED_TEMPLATE_NAME = 'বোর্ডের বইয়ের ক্রমে';

/**
 * [8.5.5] One opener per named overlay in `e2e/route-manifest.json` —
 * puts the page into that dialog/drawer state so the axe scan runs with
 * the overlay OPEN (composition bugs like focus traps and duplicate
 * landmarks only exist then). Built on the #127 page objects.
 */

async function expectDialogOpen(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog'));
  await expect(dialog).toBeVisible();
  // `role="dialog"` resolves to `DialogContent` (`ui/src/primitives/
  // dialog.tsx`), which itself carries the open transition
  // (`fade-in-0 zoom-in-95`, 240ms — contract §7). `toBeVisible()` passes
  // as soon as the element mounts, while that transition is still
  // animating its own opacity — an axe scan that lands mid-fade blends
  // every descendant's rendered colour with whatever is behind the
  // dialog, producing a different (and often wrongly failing)
  // color-contrast reading each run. Wait for the dialog's own
  // animations to finish before scanning.
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
}

async function selectFirstDuesRow(page: Page, locale: Locale): Promise<void> {
  const dues = new ListShellPage(page, { titleKey: 'fees.dues.title' }, locale);
  await dues.expectLoaded();
  await dues.dataRows().first().getByRole('checkbox').check();
}

export const overlayOpeners: Record<string, (page: Page, locale: Locale) => Promise<void>> = {
  '/fees/dues::send-reminder': async (page, locale) => {
    await selectFirstDuesRow(page, locale);
    await page.getByRole('button', { name: makeT(locale)('fees.dues.sendReminder') }).click();
    await expectDialogOpen(page);
  },
  '/students::send-reminder': async (page, locale) => {
    const list = new ListShellPage(page, { titleKey: 'students.list.title' }, locale);
    await list.expectLoaded();
    await list.dataRows().first().getByRole('checkbox').check();
    await page.getByRole('button', { name: makeT(locale)('students.list.sendReminder') }).click();
    await expectDialogOpen(page);
  },
  // Only the create state is declared for this route. `edit-structure` and
  // `delete-structure` both need an existing row, which the a11y suite
  // doesn't seed for `/fee-structures` — and the edit dialog is the same
  // `StructureFormDialog` component this opens, so the form's composition
  // is covered either way. The delete confirm is the gap; seeding a
  // structure here would close it.
  '/fee-structures::create-structure': async (page, locale) => {
    const list = new ListShellPage(page, { titleKey: 'feeStructures.list.title' }, locale);
    await list.expectLoaded();
    await page
      .getByRole('button', { name: makeT(locale)('feeStructures.list.addStructure') })
      .click();
    await expectDialogOpen(page);
  },
  '/students/$studentId::send-reminder': async (page, locale) => {
    await new DetailShellPage(page, locale).clickAction('students.detail.actions.sendReminder');
    await expectDialogOpen(page);
  },
  // [8.11.9] Send Message's confirm dialog — the page's review step. Since [#2259] the
  // recipient is a student + guardian picked from the school's own records, so the opener
  // creates a pair through the API first ([#3086]: the old free name field is gone).
  '/communications/send::confirm-send': async (page, locale) => {
    const t = makeT(locale);
    const apiCtx = await request.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const session = await adminApiSession(apiCtx);
      const stamp = Date.now();
      const studentName = `A11y Send Student ${stamp}`;
      const guardianName = `A11y Send Guardian ${stamp}`;
      const guardian = await createGuardian(apiCtx, session, guardianName, '01712345678');
      await createStudentWithDues(apiCtx, session, studentName, { guardianId: guardian.id });
      await page
        .getByRole('textbox', { name: t('communications.send.linkStudentTitle') })
        .fill(studentName);
      await page.getByRole('button', { name: new RegExp(studentName) }).click();
      await page.getByRole('radio', { name: new RegExp(guardianName) }).check();
    } finally {
      await apiCtx.dispose();
    }
    // textbox, not getByLabel: the Send (?) is named "Help: Send a message" and also matches (Epic 44).
    await page
      .getByRole('textbox', { name: t('communications.send.messageLabel') })
      .fill('School closed tomorrow.');
    // [#3086] The page's (?) can also match the Send name; the real submit has no help id.
    await page
      .getByRole('button', { name: t('communications.send.submit') })
      .and(page.locator(':not([data-help-id])'))
      .click();
    await expectDialogOpen(page);
  },
  // [84 follow-up] The student Guardians tab and lock menu are in `arrival.a11y.spec.ts`.
  '/my-class/$sectionId::add-yourself': async (page, locale) => {
    await page.getByRole('button', { name: makeT(locale)('myClass.arrival.addYourself') }).click();
    await expectDialogOpen(page);
  },
  '/students/$studentId::delete-student': async (page, locale) => {
    await new DetailShellPage(page, locale).clickAction('students.detail.actions.delete');
    await expectDialogOpen(page);
  },
  // [13.7.1] The trial details dialog (opened by `?trial=1` since [67.2.04]). The seeded admin's school is not
  // in a trial, so the onboarding status is patched on the way in to look like
  // one (4 of 10 students, a support link so the contact button is scanned too).
  '/dashboard::trial-details': async (page) => {
    await page.route('**/api/v1/onboarding/status', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as object;
      await route.fulfill({
        response,
        json: {
          ...body,
          trial: {
            ends_at: new Date(Date.now() + 23 * 86_400_000).toISOString(),
            days_left: 23,
            seats: { used: 4, limit: 10 },
          },
          support_url: 'https://example.com/help',
        },
      });
    });
    await page.goto('/dashboard?trial=1');
    await expectDialogOpen(page);
  },
  // [8.10.7.2.99] Customise mode is a state of the page (`?customize=1`), not a dialog: wait for
  // its panel heading so the scan runs with the preview and the widget list on screen.
  '/dashboard::customise': async (page, locale) => {
    await page.goto('/dashboard?customize=1');
    await expect(
      page.getByRole('heading', { name: makeT(locale)('dashboard.customise.panelTitle') }),
    ).toBeVisible();
  },
  // [8.10.7.6.05] The same mode as a phone bottom sheet: below `md` the panel is a sheet, so the
  // scan must run at phone width. Keep this overlay LAST in the manifest list (it resizes the page).
  '/dashboard::customise-phone': async (page, locale) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard?customize=1');
    await expect(
      page.getByRole('heading', { name: makeT(locale)('dashboard.customise.panelTitle') }),
    ).toBeVisible();
  },
  // `$schoolId` resolves to a seeded school (`responsive/routes.ts`); its Seats card holds "Grant seats".
  '/schools/$schoolId::grant-seats': async (page, locale) => {
    await page
      .getByRole('button', { name: makeT(locale)('platform.subscriptions.panel.grantSeats') })
      .click();
    await expectDialogOpen(page);
  },
  '/security::leave-school': async (page, locale) => {
    await page.getByRole('button', { name: makeT(locale)('signInMethods.leave.title') }).click();
    await expectDialogOpen(page);
  },
  // Needs a former member: `routes.a11y.spec.ts` leaves one behind first.
  '/staff::restore-member': async (page, locale) => {
    await page.goto('/staff?membership=former');
    const list = new ListShellPage(page, { titleKey: 'staff.list.title' }, locale);
    await list.expectLoaded();
    await list.clickRowAction('', 'staff.former.bringBack');
    await expectDialogOpen(page);
  },
  // [48.4.03] Epic 48's screens are tab or overlay states of existing routes, which a route-only
  // scan never opens. The `-tab` ones are not dialogs: the spec scans the page `main` for them.
  '/exams/$examId::print-tab': async (page, locale) => {
    await page.goto(`${new URL(page.url()).pathname}?tab=print`);
    await expect(
      page.getByRole('heading', { name: makeT(locale)('examDocuments.phase.before') }),
    ).toBeVisible();
  },
  '/students/$studentId::issue-certificate': async (page, locale) => {
    await page.goto(`${new URL(page.url()).pathname}?tab=documents&issue=pick`);
    await expectDialogOpen(page);
    await expect(
      page
        .getByRole('dialog')
        .getByRole('heading', { name: makeT(locale)('certificates.kind.label') }),
    ).toBeVisible();
  },
  '/reports/printables::register-tab': async (page, locale) => {
    await page.goto('/reports/printables?tab=register');
    await expect(
      page.getByRole('tab', { name: makeT(locale)('printHistory.tabs.register'), selected: true }),
    ).toBeVisible();
  },
  '/reports/printables::to-print-tab': async (page, locale) => {
    await page.goto('/reports/printables?tab=to-print');
    await expect(
      page.getByRole('tab', { name: makeT(locale)('printHistory.tabs.toPrint'), selected: true }),
    ).toBeVisible();
  },
  // [66.4.99] Epic 66 screens. The syllabus page keeps its states in `?tab=` / `?new=`, so those
  // openers navigate rather than click; the dialogs open from a button or a row's actions.
  '/academics/syllabus::plans-tab': async (page, locale) => {
    await page.goto('/academics/syllabus?tab=plans');
    await expect(
      page.getByRole('button', { name: makeT(locale)('studyPlans.list.newPlan') }).first(),
    ).toBeVisible();
  },
  '/academics/syllabus::library-tab': async (page, locale) => {
    await page.goto('/academics/syllabus?tab=library');
    await expect(
      page.getByRole('button', { name: makeT(locale)('studyPlans.library.add') }).first(),
    ).toBeVisible();
  },
  '/academics/syllabus::template-lessons': async (page, locale) => {
    const t = makeT(locale);
    await page.goto('/academics/syllabus?tab=library');
    // The seed's template (bn name, locale-independent): other runs' templates share the list.
    await page.getByPlaceholder(t('studyPlans.library.searchPlaceholder')).fill(SEED_TEMPLATE_NAME);
    await page
      .getByRole('button', {
        name: t('studyPlans.library.actions.view', { name: SEED_TEMPLATE_NAME }),
      })
      .click();
    await expectDialogOpen(page);
  },
  '/academics/syllabus::create-plan': async (page, locale) => {
    await page.goto('/academics/syllabus?tab=plans&new=1');
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: makeT(locale)('studyPlans.create.next') }),
    ).toBeVisible();
    await expectDialogOpen(page);
  },
  '/academics/study-plans/$planId::lesson-form': async (page, locale) => {
    await page
      .getByRole('button', { name: makeT(locale)('studyPlans.detail.addLesson') })
      .first()
      .click();
    await expectDialogOpen(page);
  },
  '/academics/study-plans/$planId::exam-markers': async (page, locale) => {
    const t = makeT(locale);
    await page
      .getByRole('button', { name: t('common.actions.moreActions') })
      .first()
      .click();
    await page.getByRole('menuitem', { name: t('studyPlans.actions.examMarker') }).click();
    await expectDialogOpen(page);
  },
  '/academics/study-plans/$planId::extra-class': async (page, locale) => {
    // A header action (not in the More menu).
    await page
      .getByRole('button', { name: makeT(locale)('studyPlans.actions.extraClass') })
      .first()
      .click();
    await expectDialogOpen(page);
  },
  // The seed teacher has a weekly Monday period (`seed.study-plans.ts`), but the seeded math plan sits in a term
  // that is over, so today's agenda says "no plan". Give the same section x subject a whole-year plan once, then
  // open the latest Monday on or before today (school time) and pick "not taught": that only opens the reason
  // dialog, it records nothing.
  '/routines/my::not-taught': async (page, locale) => {
    const t = makeT(locale);
    // Its own request context: logging in through the page's would swap the teacher's cookies for the admin's.
    const api = await request.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const admin = await adminApiSession(api);
      const seed = await findSeedSectionA(api, admin);
      const { data: plans } = await get<{
        data: { subject: { id: string; code: string }; term: { id: string } | null }[];
      }>(api, admin, `/study-plans?section_id=${seed.sectionId}&limit=100`);
      const math = plans.find((p) => p.subject.code === 'MATH');
      if (!math) throw new Error('no seeded MATH study plan on Class 6 A: run the seed script');
      if (!plans.some((p) => p.subject.id === math.subject.id && p.term === null)) {
        // The seed wrote its plan straight to the table; the API only accepts a subject the class offers.
        await rawRequest(api, admin, 'POST', `/classes/${seed.classId}/subjects`, {
          subject_id: math.subject.id,
          academic_year_id: seed.academicYearId,
        });
        const created = await rawRequest(api, admin, 'POST', '/study-plans', {
          section_id: seed.sectionId,
          subject_id: math.subject.id,
          academic_term_id: null,
          lessons: [1, 2, 3].map((n) => ({ title: `A11y lesson ${n}`, periods: 1 })),
        });
        // A parallel variant may win the race (409): fine. Anything else is a real failure.
        if (created.status >= 400 && created.status !== 409) {
          throw new Error(
            `could not create the whole-year plan: ${created.status} ${JSON.stringify(created.body)}`,
          );
        }
      }
    } finally {
      await api.dispose();
    }
    const monday = await page.evaluate(() => {
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' });
      const d = new Date(`${fmt.format(new Date())}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    });
    await page.goto(`/routines/my?date=${monday}`);
    await page
      .getByRole('main')
      .getByRole('radio', { name: t('routines.marking.status.notTaught') })
      .first()
      .click();
    await expectDialogOpen(page);
  },
  // [52.5.8] The admin's inbox: two rows selected, then the bulk bar's Approve button.
  '/applications::bulk-approve-confirm': async (page, locale) => {
    const t = makeT(locale);
    // The bar needs two selected rows: top the admin's inbox up if it is running low.
    await ensureDecidableApplications(page.request, await adminApiSession(page.request), 2);
    await page.goto('/applications?view=inbox');
    const rows = page.getByRole('row').filter({ has: page.getByRole('checkbox') });
    await expect(rows.nth(1)).toBeVisible();
    await rows.nth(0).getByRole('checkbox').check();
    await rows.nth(1).getByRole('checkbox').check();
    await page.getByRole('button', { name: t('applicationsList.bulk.approve') }).click();
    await expectDialogOpen(page);
  },
  // The detail route resolves to an application the admin can decide (`responsive/routes.ts`).
  '/applications/$applicationId::approve': async (page, locale) => {
    await page
      .getByRole('button', { name: makeT(locale)('applicationsDetail.actions.approve') })
      .click();
    await expectDialogOpen(page);
  },
  '/applications/$applicationId::reject': async (page, locale) => {
    await page
      .getByRole('button', { name: makeT(locale)('applicationsDetail.actions.reject') })
      .click();
    await expectDialogOpen(page);
  },
  '/applications/$applicationId::consider': async (page, locale) => {
    const t = makeT(locale);
    // "Consider" is a tertiary action, so it lives in the header's More menu.
    await page.getByRole('button', { name: t('common.actions.moreActions') }).click();
    await page.getByRole('menuitem', { name: t('applicationsDetail.actions.consider') }).click();
    await expectDialogOpen(page);
  },
  // Picking a type makes the form dirty, so Cancel asks before discarding.
  '/applications/new::discard': async (page, locale) => {
    const t = makeT(locale);
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: t('applicationsNew.actions.cancel') }).click();
    await expectDialogOpen(page);
  },
  // [52.6.4] The portal form. The sweep lands here without `?student=`, which sends the page back
  // to the list, so the opener takes the list's own "New application" link. Picking a type makes
  // the form dirty, so Cancel asks before discarding.
  '/portal/applications/new::discard': async (page, locale) => {
    const t = makeT(locale);
    if (!page.url().includes('/portal/applications/new')) {
      await page.getByRole('link', { name: t('portalApplications.newApplication') }).click();
    }
    await page.getByRole('radio').first().check();
    await page
      .getByRole('button', { name: t('portalApplications.new.actions.cancel'), exact: true })
      .click();
    await expectDialogOpen(page);
  },
  // The detail route resolves to the newest application, which may already be decided; Withdraw
  // exists only on an open one the parent filed, so go to the first of those.
  '/portal/applications/$applicationId::withdraw': async (page, locale) => {
    const session = await apiSession(page.request, 'PARENT');
    const mine = await get<{ data: { id: string; can: { withdraw: boolean } }[] }>(
      page.request,
      session,
      '/applications?view=mine&limit=100',
    );
    const open = mine.data.find((a) => a.can.withdraw);
    if (!open) throw new Error('no withdrawable application for the parent (seed)');
    await page.goto(`/portal/applications/${open.id}`);
    await page
      .getByRole('button', { name: makeT(locale)('applicationsDetail.actions.withdraw') })
      .click();
    await expectDialogOpen(page);
  },
  // [30.4.1] `ShortcutsSheet` (`ui/src/components/shortcuts-sheet.tsx`) —
  // the `?` keyboard-shortcuts help. It is global, not tied to any one
  // route, so it is deliberately NOT in `route-manifest.json` — that file
  // only lists navigable routes, and this dialog has no URL.
  '$global::shortcuts-sheet': async (page) => {
    await page.keyboard.press('?');
    await expectDialogOpen(page);
  },
  // [30.5.1] `CommandPalette` itself — same "global, no URL" reasoning as
  // the shortcuts sheet above. Wired into the axe sweep alongside it now
  // that `command-palette-launcher.tsx` mounts both behind global
  // listeners (`e2e/a11y/routes.a11y.spec.ts`'s `$global` sweep).
  '$global::command-palette': async (page) => {
    await page.keyboard.press('ControlOrMeta+k');
    await expectDialogOpen(page);
  },
  // #1733: the Action tab renders grouped headers and `aria-disabled` rows.
  '$global::command-palette-actions': async (page) => {
    await page.keyboard.press('ControlOrMeta+k');
    await expectDialogOpen(page);
    await page.keyboard.press('Control+3');
  },
};

/** Keys in `overlayOpeners` that open a route-agnostic overlay rather
 * than one scoped to a manifest route — swept separately by
 * `routes.a11y.spec.ts`'s `$global` sweep. */
export const GLOBAL_OVERLAY_KEYS = Object.keys(overlayOpeners).filter((key) =>
  key.startsWith('$global::'),
);
