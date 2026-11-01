import type { Page } from '@playwright/test';

import { expectNoAxeViolations } from '../a11y/assert';
import { adminApiSession, apiSession, del, get } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { SEED_DASHBOARD_EXAM_NAME } from '../seed-contract';
import { ListShellPage } from '../pages/list-shell';

/**
 * [8.10.7.3.99] The headmaster / admin `/dashboard` with real Group A cards and
 * the briefing band: attendance, staff, collection, at-risk, mark entry, syllabus
 * and upcoming for the EXECUTIVE; SMS balance and failed messages for the ADMIN.
 * Teacher and accountant cards have no client body yet (a later wave), so their
 * dashboards are covered at API level by `dashboard-group-b-api.spec.ts`.
 *
 * The briefing band's button always opens `/notifications?tab=active` (the
 * #1877 amendment); the ticket's older "navigates to /attendance" is not asserted.
 */

const widgetTitle = (key: string) => t(`dashboard.widgets.${key}.title`);
const card = (page: Page, key: string) => page.getByRole('region', { name: widgetTitle(key) });

/** Cards in the EXECUTIVE default layout that have a client body, in layout order. */
const EXECUTIVE_CARDS = [
  widgetTitle('attendance-today'),
  widgetTitle('staff-today'),
  widgetTitle('collection-month'),
  widgetTitle('at-risk-students'),
  SEED_DASHBOARD_EXAM_NAME, // the mark-entry card is titled with the exam being marked
  widgetTitle('syllabus-progress'),
  t('calendar.upcomingPanel.title'),
];

async function openDashboard(page: Page) {
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { level: 1, name: t('dashboard.page.title') }),
  ).toBeVisible();
  // Every card has left its skeleton.
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

test.describe('dashboard: executive', () => {
  test.use(loggedIn('executive'));

  test('briefing band: a headline and one primary button to the to-do list', async ({
    page,
    request,
  }) => {
    const session = await apiSession(request, 'executive');
    const summary = await get<{ critical: number; warning: number; reminder: number }>(
      request,
      session,
      '/attention/summary',
    );
    await openDashboard(page);

    const open = summary.critical + summary.warning + summary.reminder;
    if (open === 0) {
      await expect(page.getByText(t('attention.modal.empty'))).toBeVisible();
      return;
    }
    const button = page.getByRole('main').locator('a[href^="/notifications"]').first();
    await expect(button).toBeVisible();
    await button.click();
    await expect(page).toHaveURL(/\/notifications\?tab=active/);
  });

  test('the Group A cards render in layout order; the attendance card shows its table', async ({
    page,
  }) => {
    await openDashboard(page);

    const headings = page.locator(
      '[data-testid="grid-desktop"] h2, [data-testid="grid-desktop"] h3',
    );
    await expect
      .poll(async () => await headings.allTextContents())
      .toEqual(expect.arrayContaining(EXECUTIVE_CARDS));
    const seen = (await headings.allTextContents()).filter((h) => EXECUTIVE_CARDS.includes(h));
    expect(seen).toEqual(EXECUTIVE_CARDS);

    // "Show table" turns the 30-day sparkline into a table with a caption.
    await card(page, 'attendance-today')
      .getByRole('button', { name: t('dashboard.widgets.common.showTable') })
      .click();
    await expect(
      card(page, 'attendance-today').getByRole('table', { name: widgetTitle('attendance-today') }),
    ).toBeVisible();
  });

  test('at-risk: the "see all" button expands the list in place (when the seed has more rows than fit)', async ({
    page,
  }) => {
    await openDashboard(page);
    const atRisk = card(page, 'at-risk-students');
    await expect(atRisk).toBeVisible();
    // The list is computed by a nightly job; "computing" has no rows yet, and a seed with few
    // at-risk students has no toggle on desktop (it shows five rows). Say so instead of failing.
    // Not the widget's (?) help button, which is also a collapsed popover trigger (Epic 44).
    const seeAll = atRisk
      .getByRole('button', { name: /\S/, expanded: false })
      .and(page.locator(':not([data-help-id])'));
    if ((await seeAll.count()) === 0) {
      test.info().annotations.push({
        type: 'not-exercised',
        description: 'no at-risk "see all" toggle: the seed lists five or fewer students',
      });
      return;
    }
    const before = await atRisk.locator('tbody tr:visible').count();
    await seeAll.first().click();
    await expect(atRisk.locator('tbody tr:visible')).not.toHaveCount(before);
    await expect(atRisk.getByRole('button', { expanded: true })).toBeVisible();
  });

  test('axe is clean on the populated page, light and dark', async ({ page }) => {
    await openDashboard(page);
    await expectNoAxeViolations(page, 'main');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expectNoAxeViolations(page, 'main');
  });
});

test.describe('dashboard: executive on a phone', () => {
  test.use({ ...loggedIn('executive'), viewport: { width: 390, height: 844 }, hasTouch: true });

  test('key numbers show as tiles; tapping a tile expands its card', async ({ page }) => {
    await openDashboard(page);
    const tiles = page.getByRole('region', { name: t('dashboard.page.keyNumbers') });
    await expect(tiles).toBeVisible();

    // A tile's own toggle, not the attendance tile by name: on the weekly off that tile falls
    // back to a "school closed" card, which expands in place and has no toggle.
    const tile = page.getByTestId('grid-phone').locator('[data-tile-toggle]:visible').first();
    await expect(tile).toHaveAttribute('aria-expanded', 'false');
    await tile.tap();
    await expect(tile).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('tile-expanded')).toBeVisible();
    await expectNoAxeViolations(page, 'main');

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expectNoAxeViolations(page, 'main');
  });
});

test.describe('dashboard: admin', () => {
  test.use(loggedIn('admin'));

  test('SMS balance and failed messages cards render beside the Group A cards', async ({
    page,
  }) => {
    await openDashboard(page);
    await expect(card(page, 'sms-balance')).toBeVisible();
    await expect(card(page, 'failed-messages')).toBeVisible();
    await expect(card(page, 'attendance-today')).toBeVisible();
  });

  test('an exam saved with a mark-entry deadline keeps the date when reopened for edit (3-20)', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const name = `E2E dashboard exam ${Date.now()}`;
    // Five days ahead: the picker opens on this month, the day may be in the next one.
    const deadline = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    let examId: string | null = null;

    try {
      await page.goto('/exams');
      await page
        .getByRole('button', { name: t('exams.list.addExam') })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: t('exams.examForm.createTitle') });
      await dialog.getByRole('textbox', { name: t('exams.examForm.nameLabel') }).fill(name);
      await dialog.getByRole('combobox', { name: t('exams.examForm.academicYearLabel') }).click();
      await page.getByRole('option').first().click();
      await dialog.getByRole('combobox', { name: t('exams.examForm.classLabel') }).click();
      await page.getByRole('option').first().click();

      await dialog
        .getByRole('button', { name: t('exams.examForm.deadlineLabel'), exact: true })
        .click();
      const cell = page.locator(`[data-date="${deadline}"]`);
      for (let i = 0; i < 2 && !(await cell.isVisible()); i += 1) {
        await page.getByRole('button', { name: t('common.date.nextMonth') }).click();
      }
      await cell.click();
      await dialog.getByRole('button', { name: t('exams.examForm.save') }).click();
      await expect(dialog).toBeHidden();

      const found = await get<{
        data: { id: string; name: string; mark_entry_deadline: string | null }[];
      }>(request, admin, '/exams?limit=100');
      const created = found.data.find((e) => e.name === name);
      expect(created, 'the exam was created').toBeDefined();
      examId = created!.id;
      expect(created!.mark_entry_deadline?.slice(0, 10)).toBe(deadline);

      // Reopen for edit: the picker shows the saved date, and saving unchanged keeps it.
      await page.reload();
      const list = new ListShellPage(page, { titleKey: 'exams.list.title' });
      await list.clickRowAction(name, 'exams.list.edit');
      const edit = page.getByRole('dialog', { name: t('exams.examForm.editTitle') });
      await expect(
        edit.getByRole('button', { name: t('exams.examForm.deadlineLabel'), exact: true }),
      ).not.toContainText(t('exams.examForm.deadlinePlaceholder'));
      await edit.getByRole('button', { name: t('exams.examForm.save') }).click();
      await expect(edit).toBeHidden();

      const after = await get<{ mark_entry_deadline: string | null }>(
        request,
        admin,
        `/exams/${examId}`,
      );
      expect(after.mark_entry_deadline?.slice(0, 10)).toBe(deadline);
    } finally {
      if (examId) await del(request, admin, `/exams/${examId}`).catch(() => undefined);
    }
  });
});
