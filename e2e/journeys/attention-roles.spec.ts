import type { APIRequestContext, Page } from '@playwright/test';
import { ALERT_RULES, AlertCategory, UserRole, type AlertItem } from '@biddaloy/shared';

import { apiSession, get } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';
import type { SeedRole } from '../seed-contract';

/**
 * [67.6.02] Role matrix: every seeded role sees only alerts of its own categories, in the
 * API, in the bar and in the modal. English UI. Read-only: nothing here writes data.
 *
 * Allowed categories for a role R, built from the rule catalogue:
 *   - the category of every rule whose roles include R,
 *   - the category of every personal rule (roles: [], addressed to one user),
 *   - MANUAL (any role can be sent a manual alert),
 *   - the category of a rule that escalates to R (attendance.not_taken goes to EXECUTIVE and ADMIN).
 */
const t = makeT('en');
const BAR = '[data-tone] button[aria-haspopup="dialog"]';
const ESCALATIONS: [string, UserRole[]][] = [
  ['attendance.not_taken', [UserRole.EXECUTIVE, UserRole.ADMIN]],
  ['study_plan.unreported', [UserRole.EXECUTIVE, UserRole.ADMIN]],
];

function allowedCategories(role: UserRole): Set<AlertCategory> {
  const allowed = new Set<AlertCategory>([AlertCategory.MANUAL, AlertCategory.NOTICE]);
  for (const rule of ALERT_RULES) {
    if (rule.roles.length === 0 || rule.roles.includes(role)) allowed.add(rule.category);
  }
  for (const [ruleKey, roles] of ESCALATIONS) {
    const rule = ALERT_RULES.find((r) => r.key === ruleKey);
    if (rule && roles.includes(role)) allowed.add(rule.category);
  }
  return allowed;
}

interface Expectation {
  role: SeedRole;
  home: string;
  /** admin, teacher and parent must hold at least one seeded item, so the matrix is not vacuous. */
  mustHaveItems: boolean;
}

async function checkRole(
  page: Page,
  request: APIRequestContext,
  { role, home, mustHaveItems }: Expectation,
) {
  const session = await apiSession(request, role);
  const allowed = allowedCategories(role.toUpperCase() as UserRole);
  // API: every item's category is one this role may see.
  const fetchItems = async () => {
    const { items } = await get<{ items: AlertItem[] }>(
      request,
      session,
      '/attention/items?tab=active&pageSize=100',
    );
    const outOfRole = items
      .filter((i) => !allowed.has(i.category))
      .map((i) => `${i.ruleKey}:${i.category}`);
    expect(outOfRole).toEqual([]);
    return items;
  };
  const items = await fetchItems();
  if (mustHaveItems) expect(items.length).toBeGreaterThan(0);

  // UI: no OPEN item means no bar (D14); otherwise every card in the modal is one of the API's.
  await page.goto(home);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  const bar = page.locator(BAR);
  const open = items.filter((i) => i.state === 'OPEN');
  if (open.length === 0) {
    await page.waitForLoadState('networkidle');
    // The e2e server runs the real scheduler (FAST sweep every 5 min): one may have opened an
    // item since the fetch above, and then the bar is right to show.
    if ((await fetchItems()).some((i) => i.state === 'OPEN')) return;
    await expect(bar).toHaveCount(0);
    return;
  }
  await expect(bar).toBeVisible({ timeout: 15_000 });
  await bar.click();
  const dialog = page.getByRole('dialog', { name: t('attention.modal.title') });
  await expect(dialog).toBeVisible();
  const cards = dialog.locator('[data-alert-item]');
  await expect(cards.first()).toBeVisible();
  const shown = await cards.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-alert-item')),
  );
  // Same scheduler race: a card the modal shows existed either before it opened or still after.
  const known = new Set([...items, ...(await fetchItems())].map((i) => i.recipientId));
  expect(shown.filter((id) => !known.has(id ?? ''))).toEqual([]);
  // each card carries a severity badge
  expect(
    await dialog.locator('[data-alert-item] [data-slot="status-badge"]').count(),
  ).toBeGreaterThan(0);
}

const en = { e2eLocale: 'en' };

test.describe('super_admin', () => {
  test.use({ ...loggedIn('super_admin'), ...en });
  test('sees only platform alerts', async ({ page, request }) => {
    await checkRole(page, request, { role: 'super_admin', home: '/schools', mustHaveItems: false });
  });
});

test.describe('admin', () => {
  test.use({ ...loggedIn('admin'), ...en });
  test('sees only admin alerts', async ({ page, request }) => {
    await checkRole(page, request, { role: 'admin', home: '/', mustHaveItems: true });
  });
});

test.describe('executive', () => {
  test.use({ ...loggedIn('executive'), ...en });
  test('sees only executive alerts', async ({ page, request }) => {
    await checkRole(page, request, { role: 'executive', home: '/', mustHaveItems: false });
  });
});

test.describe('accountant', () => {
  test.use({ ...loggedIn('accountant'), ...en });
  test('sees only accountant alerts', async ({ page, request }) => {
    await checkRole(page, request, { role: 'accountant', home: '/', mustHaveItems: false });
  });
});

test.describe('teacher', () => {
  test.use({ ...loggedIn('teacher'), ...en });
  test('sees only teacher alerts', async ({ page, request }) => {
    await checkRole(page, request, { role: 'teacher', home: '/', mustHaveItems: true });
  });
});

test.describe('office_staff', () => {
  test.use({ ...loggedIn('office_staff'), ...en });
  test('sees only office staff alerts', async ({ page, request }) => {
    await checkRole(page, request, { role: 'office_staff', home: '/', mustHaveItems: false });
  });
});

test.describe('exam_controller', () => {
  test.use({ ...loggedIn('exam_controller'), ...en });
  test('sees only exam controller alerts', async ({ page, request }) => {
    await checkRole(page, request, { role: 'exam_controller', home: '/', mustHaveItems: false });
  });
});

test.describe('committee', () => {
  test.use({ ...loggedIn('committee'), ...en });
  test('sees only committee alerts', async ({ page, request }) => {
    await checkRole(page, request, { role: 'committee', home: '/', mustHaveItems: false });
  });
});

test.describe('parent', () => {
  test.use({ ...loggedIn('parent'), ...en });
  test('sees only parent alerts', async ({ page, request }) => {
    await checkRole(page, request, { role: 'parent', home: '/portal', mustHaveItems: true });
  });
});

test.describe('student', () => {
  test.use({ ...loggedIn('student'), ...en });
  test('sees only student alerts', async ({ page, request }) => {
    await checkRole(page, request, { role: 'student', home: '/portal', mustHaveItems: false });
  });
});
