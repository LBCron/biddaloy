import { expect, loggedIn, test } from '../fixtures/test';
import type { Page } from '@playwright/test';
import { t } from '../i18n';

/**
 * Phone shell below `md` for the three shells (D12 one 56 px row, D13
 * drawer, D14 fixed bottom bar with per-role cells, C8 platform/committee
 * short bars). Cells per role come from `client-admin/src/nav-tree.ts`
 * `STAFF_BOTTOM_NAV`; every string goes through `t()`.
 */

const cellLabel = (key: string) => t(`nav.bottomNavCells.${key}` as Parameters<typeof t>[0]);

function staffBar(page: Page) {
  return page.getByRole('navigation', { name: t('nav.bottomNavStaffLabel') });
}

/** Asserts the bar holds exactly these short labels (links, in order) plus More. */
async function expectCells(page: Page, keys: string[], bar = staffBar(page)) {
  await expect(bar).toBeVisible();
  const links = bar.getByRole('link');
  await expect(links).toHaveCount(keys.length);
  for (const [i, key] of keys.entries()) {
    await expect(links.nth(i)).toHaveText(cellLabel(key));
  }
  await expect(bar.getByRole('button', { name: t('nav.items.more') })).toBeVisible();
  await expect(bar.locator('a, button')).toHaveCount(keys.length + 1);
}

test.describe('staff bottom nav', () => {
  test.use({ ...loggedIn('admin'), viewport: { width: 390, height: 844 } });

  test('ADMIN: dashboard, students, attendance, dues + More, each at least 44x44', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expectCells(page, ['dashboard', 'students', 'attendance', 'dues']);
    for (const cell of await staffBar(page).locator('a, button').all()) {
      const box = await cell.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(
      staffBar(page).getByRole('link', { name: cellLabel('dashboard') }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('the students cell is current on /students', async ({ page }) => {
    await page.goto('/students');
    await expect(staffBar(page).getByRole('link', { name: cellLabel('students') })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('on a page with no cell, nothing is current and More carries the active marker', async ({
    page,
  }) => {
    await page.goto('/fee-structures');
    const bar = staffBar(page);
    await expect(bar.locator('[aria-current]')).toHaveCount(0);
    await expect(bar.getByRole('button', { name: t('nav.items.more') })).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  test('More opens the drawer, Escape closes it, and focus returns to a real on-screen control', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await staffBar(page)
      .getByRole('button', { name: t('nav.items.more') })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Radix hardcodes the DialogTrigger (the phone bar's menu button) as the
    // focus-restore target, even though `More` opened the drawer.
    await expect(page.getByRole('button', { name: t('nav.openMenuLabel') })).toBeFocused();
  });

  test('exactly one 56 px sticky chrome row holds menu, school name, search, bell and account', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const row = page.locator('[data-app-mobile-header]');
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(Math.abs((box?.height ?? 0) - 56)).toBeLessThanOrEqual(1);
    expect(
      await row.evaluate((el) => getComputedStyle(el.closest('[data-app-header]')!).position),
    ).toBe('sticky');

    await expect(row.getByRole('button', { name: t('nav.openMenuLabel') })).toBeVisible();
    await expect(
      row.getByRole('button', { name: t('nav.commandPalette.buttonLabel') }),
    ).toBeVisible();
    await expect(row.getByRole('button', { name: t('nav.userMenu.label') })).toBeVisible();
    await expect(row.getByText(/\S/).first()).toBeVisible();
    // the school name is in the row (truncating span)
    expect((await row.locator('span.truncate').first().innerText()).trim().length).toBeGreaterThan(
      0,
    );
    // menu + search + bell + account, nothing else crowds the row
    await expect(row.getByRole('button')).toHaveCount(4);

    // language + theme live in the account menu below md
    const themeButton = page.getByLabel(t('nav.theme.label'), { exact: true });
    const languageButton = page.getByLabel(new RegExp(t('nav.language.label')));
    await expect(themeButton).toHaveCount(1);
    await expect(themeButton).toBeHidden();
    await expect(languageButton).toHaveCount(1);
    await expect(languageButton).toBeHidden();
    // the desktop tenant/role row is hidden
    await expect(page.locator('[data-app-header-row]')).toBeHidden();
  });

  test('the bar is fixed to the viewport bottom and never hides content', async ({ page }) => {
    const bar = page.locator('[data-app-bottom-nav]');
    for (const path of ['/dashboard', '/students']) {
      await page.goto(path);
      await expect(bar).toBeVisible();
      expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
      // Widgets and list rows keep arriving after first paint; measure the settled page, or a
      // late row can extend below the bar after the scroll-to-bottom was taken.
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
      const viewportHeight = page.viewportSize()!.height;
      // #3087: this failed once in CI, never locally. Read the boxes only once they are stable
      // (scroll and layout can settle a frame later), so poll until the bar's
      // bottom edge and the content's last edge both hold, instead of taking one early reading.
      // Every sample scrolls to the bottom first, so content that grows mid-poll is re-measured
      // from the new bottom, not from a stale scroll position.
      await expect
        .poll(
          async () =>
            page.evaluate((vh) => {
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
              const bar = document.querySelector('[data-app-bottom-nav]')!.getBoundingClientRect();
              let bottom = 0;
              for (const child of Array.from(document.querySelector('main')!.children)) {
                bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
              }
              return {
                barAtBottom: Math.abs(bar.y + bar.height - vh) <= 1,
                contentClear: bottom <= bar.y + 1,
              };
            }, viewportHeight),
          { message: `bar fixed to bottom and content clear of it on ${path}` },
        )
        .toEqual({ barAtBottom: true, contentClear: true });
    }
  });

  test.describe('at desktop width (1280px)', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the bottom nav is hidden, and the tenant row is visible', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(staffBar(page)).toBeHidden();
      await expect(page.locator('[data-app-header-row]')).toBeVisible();
    });
  });
});

// One describe per role, written out on purpose (no generated tests).
test.describe('TEACHER bottom nav', () => {
  test.use({ ...loggedIn('teacher'), viewport: { width: 390, height: 844 } });

  test('dashboard, attendance, routine, homework + More', async ({ page }) => {
    await page.goto('/dashboard');
    await expectCells(page, ['dashboard', 'attendance', 'routine', 'homework']);
  });

  test('dashboard cell is current on /dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      staffBar(page).getByRole('link', { name: cellLabel('dashboard') }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('my class is still reachable from the More drawer', async ({ page }) => {
    await page.goto('/dashboard');
    await staffBar(page)
      .getByRole('button', { name: t('nav.items.more') })
      .click();
    await expect(page.getByRole('dialog').locator('a[href="/my-class"]')).toBeVisible();
  });
});

test.describe('ACCOUNTANT bottom nav', () => {
  test.use({ ...loggedIn('accountant'), viewport: { width: 390, height: 844 } });

  test('dashboard, dues, payment, invoices + More', async ({ page }) => {
    await page.goto('/dashboard');
    await expectCells(page, ['dashboard', 'dues', 'payment', 'invoices']);
  });
});

test.describe('EXECUTIVE bottom nav', () => {
  test.use({ ...loggedIn('executive'), viewport: { width: 390, height: 844 } });

  test('dashboard, students, attendance, reports + More', async ({ page }) => {
    await page.goto('/dashboard');
    await expectCells(page, ['dashboard', 'students', 'attendance', 'reports']);
  });
});

test.describe('OFFICE_STAFF bottom nav', () => {
  test.use({ ...loggedIn('office_staff'), viewport: { width: 390, height: 844 } });

  test('dashboard, students, applicants, attendance + More', async ({ page }) => {
    await page.goto('/dashboard');
    await expectCells(page, ['dashboard', 'students', 'applicants', 'attendance']);
  });
});

test.describe('EXAM_CONTROLLER bottom nav', () => {
  test.use({ ...loggedIn('exam_controller'), viewport: { width: 390, height: 844 } });

  test('dashboard, exams, analysis, students + More', async ({ page }) => {
    await page.goto('/dashboard');
    await expectCells(page, ['dashboard', 'exams', 'analysis', 'students']);
  });
});

test.describe('COMMITTEE bottom nav', () => {
  test.use({ ...loggedIn('committee'), viewport: { width: 390, height: 844 } });

  test('dashboard, calendar + More (C8: two cells, never empty)', async ({ page }) => {
    await page.goto('/dashboard');
    await expectCells(page, ['dashboard', 'calendar']);
  });
});

test.describe('portal shell (parent)', () => {
  test.use({ ...loggedIn('parent'), viewport: { width: 320, height: 900 } });

  test('has a menu button now (D12) and overview, fees, attendance, results + More', async ({
    page,
  }) => {
    await page.goto('/portal');
    await expect(page.getByRole('button', { name: t('nav.openMenuLabel') })).toBeVisible();
    await expectCells(
      page,
      ['overview', 'fees', 'attendance', 'results'],
      page.getByRole('navigation', { name: t('nav.bottomNavLabel') }),
    );
  });

  test('one 56 px phone row', async ({ page }) => {
    await page.goto('/portal');
    const row = page.locator('[data-app-mobile-header]');
    await expect(row).toHaveCount(1);
    const box = await row.boundingBox();
    expect(Math.abs((box?.height ?? 0) - 56)).toBeLessThanOrEqual(1);
    // the whole sticky header (not just the phone row) is that one row: no second desktop row below md
    const header = await page.locator('[data-app-header]').boundingBox();
    expect(Math.abs((header?.height ?? 0) - 56)).toBeLessThanOrEqual(1);
  });
});

test.describe('platform console (super_admin)', () => {
  test.use({ ...loggedIn('super_admin'), viewport: { width: 390, height: 844 } });

  test('schools, holidays, dashboard + More at 390 px', async ({ page }) => {
    await page.goto('/schools');
    await expectCells(page, ['schools', 'holidays', 'dashboard']);
    await expect(page.locator('[data-app-mobile-header]')).toHaveCount(1);
  });

  test.describe('at 1280px', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the sidebar holds exactly three links', async ({ page }) => {
      await page.goto('/schools');
      const sidebar = page.getByRole('navigation', { name: t('nav.navLabel') });
      // Schools, Holiday sets, Subscriptions (#1821).
      await expect(sidebar.getByRole('link')).toHaveCount(3);
    });
  });
});
