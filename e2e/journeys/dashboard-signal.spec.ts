import type { Page } from '@playwright/test';

import bnSignal from '../../ui/src/i18n/locales/bn/signal.json';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [#3601] Dashboard signal colour (epic #3592, D8/D10): a signalled card shows an icon AND
 * screen-reader text, never colour alone; a card without a signal carries no accent.
 * The errored-widget case (no signal) is a unit test (`widget-card.test.tsx`): the service
 * worker defeats `page.route` on the built app, so it cannot be forced here.
 */

// Level words a card can announce (bn is the default e2e locale). `levelAria` is a template.
const LEVEL_TEXTS = Object.entries(bnSignal)
  .filter(([key]) => key !== 'levelAria')
  .map(([, text]) => text);

async function openDashboard(page: Page) {
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { level: 1, name: t('dashboard.page.title') }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

test.describe('dashboard signal colour: admin', () => {
  test.use(loggedIn('admin'));

  test('every accented card has an icon and level text; none is colour only', async ({ page }) => {
    await openDashboard(page);
    const accented = page.locator('[data-testid="grid-desktop"] [class*="text-signal-"]');

    // The seeded school has at least one signalled card.
    await expect.poll(() => accented.count()).toBeGreaterThan(0);

    for (const el of await accented.all()) {
      await expect(el.locator('svg[aria-hidden="true"]')).toHaveCount(1);
      const text = (await el.locator('.sr-only').textContent())?.trim() ?? '';
      expect(LEVEL_TEXTS, `sr-only text "${text}" is a signal label`).toContain(text);
    }
  });

  test('a card with no signal wiring carries no accent', async ({ page }) => {
    await openDashboard(page);
    const attendance = page.getByRole('region', {
      name: t('dashboard.widgets.attendance-today.title'),
    });
    await expect(attendance).toBeVisible();
    await expect(
      attendance.locator('[class*="text-signal-"], [class*="border-s-signal-"]'),
    ).toHaveCount(0);
  });
});
