import type { Page } from '@playwright/test';

import bnSignal from '../../ui/src/i18n/locales/bn/signal.json';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [#3601] Dashboard signal colour (epic #3592, D8/D10): a signalled card shows an icon AND
 * screen-reader text, never colour alone. Every signal marker (WidgetCard, SetupChecklistCard)
 * carries `data-signal="<level>"` and holds both the aria-hidden icon and the sr-only label.
 * The errored-widget case (no signal) is a unit test (`widget-card.test.tsx`): the service
 * worker defeats `page.route` on the built app, so it cannot be forced here.
 */

// The labels a desktop card can announce (bn is the default e2e locale): the level words
// plus the per-widget phrasings the wired widgets use.
const LEVEL_TEXTS = (
  [
    'needsAction',
    'watch',
    'healthy',
    'behind',
    'onTrack',
    'ahead',
    'pastDeadline',
    'approaching',
    'done',
    'low',
  ] as const
).map((key) => bnSignal[key]);

async function openDashboard(page: Page) {
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { level: 1, name: t('dashboard.page.title') }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
}

test.describe('dashboard signal colour: admin', () => {
  test.use(loggedIn('admin'));

  test('every signal marker has an icon and level text; none is colour only', async ({ page }) => {
    await openDashboard(page);
    const markers = page.locator('[data-testid="grid-desktop"] [data-signal]');

    // The seeded school has at least one signalled card.
    await expect.poll(() => markers.count()).toBeGreaterThan(0);

    for (const marker of await markers.all()) {
      await expect(marker.locator('svg[aria-hidden="true"]')).toHaveCount(1);
      const text = (await marker.locator('.sr-only').textContent())?.trim() ?? '';
      expect(LEVEL_TEXTS, `sr-only text "${text}" is a signal label`).toContain(text);
    }
  });
});
