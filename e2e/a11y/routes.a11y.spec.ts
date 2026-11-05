import type { APIRequestContext, Page } from '@playwright/test';

import { adminApiSession, createStaffUser, createStudentWithDues } from '../api';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import type { SeedRole } from '../seed-contract';
import { resolvePath, routes, type ManifestRoute } from '../responsive/routes';
import { GLOBAL_OVERLAY_KEYS, overlayOpeners } from './overlay-openers';
import { skipIfKnown } from '../responsive/known-failures';
import { expectNoAxeViolations } from './assert';

/**
 * Same reasoning as `responsive/reflow.spec.ts`'s identical helper: a
 * `redirect` archetype route may land somewhere that opens a modal by
 * default (e.g. a legacy URL that lands on a page with a modal open), which
 * correctly `aria-hide`s the underlying `<h1>` while open — the dialog's own
 * required title is the equivalent "rendered something meaningful" signal.
 * (`/payments/record` used to be that case; it is now a full-page form.)
 */
function pageOrDialogHeading(page: Page, route: ManifestRoute) {
  const heading = page.getByRole('heading', { level: 1 }).first();
  if (route.archetype !== 'redirect') return heading;
  return heading.or(page.getByRole('dialog').first());
}

/**
 * [8.5.5] Route-level axe suite — BLOCKING. Scans every manifest route
 * (and every named overlay state, open) at the five-tag WCAG set, in
 * both locales. [8.13.12] adds a third variant — `bn` in dark mode, see
 * `VARIANTS`'s own comment below for why it is one locale rather than
 * both. Suppressions only via `exceptions.ts`'s time-boxed
 * `a11yException` passed to `.disableRules()` — none are currently in
 * effect.
 */

const LOCALES = ['bn', 'en'] as const;

/**
 * [8.13.12]: every route/overlay combination also needs an axe pass in
 * dark mode — the dark `-bg` status tints this ticket adds are exactly the
 * kind of thing only a real accessibility scan, not `check-contrast.mjs`'s
 * pairwise math, catches wired to the wrong element. Full `LOCALES` x
 * `theme` coverage would double this suite's already-substantial runtime
 * for a dimension that (per `docs/architecture/09-design-direction.md`'s
 * ground/surface inversion) recolors tokens uniformly rather than
 * reflowing layout the way a locale swap can — so only one locale, `bn`
 * (the platform default, `i18n/locale-storage.ts`'s `DEFAULT_LOCALE`),
 * also runs the dark variant. `en` stays light-only.
 */
type Variant = { locale: (typeof LOCALES)[number]; theme: 'light' | 'dark' };
const VARIANTS: Variant[] = [
  ...LOCALES.map((locale): Variant => ({ locale, theme: 'light' })),
  { locale: 'bn', theme: 'dark' },
];

async function ensureDuesRow(request: APIRequestContext): Promise<void> {
  const session = await adminApiSession(request);
  await createStudentWithDues(request, session, `A11y Dues ${Date.now()}`);
}

/** [13.7.1] The `/staff::restore-member` opener needs someone under "Former". */
async function ensureFormerMember(request: APIRequestContext): Promise<void> {
  const session = await adminApiSession(request);
  const { id } = await createStaffUser(request, session, `A11y Former ${Date.now()}`);
  const removed = await request.delete(`/api/v1/users/${id}`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
  });
  if (!removed.ok()) throw new Error(`DELETE /users/${id} failed: ${removed.status()}`);
}

for (const { locale, theme } of VARIANTS) {
  test.describe(`a11y · ${locale}${theme === 'dark' ? ' · dark' : ''} @sweep`, () => {
    for (const route of routes) {
      test.describe(route.path, () => {
        if (route.role === 'guest') {
          test.use({ ...guest, e2eLocale: locale });
        } else if (route.path === '/select-school') {
          // The picker only renders for a session with no persisted tenant.
          test.use({ ...loggedIn(route.role as SeedRole, { tenant: 'none' }), e2eLocale: locale });
        } else {
          test.use({ ...loggedIn(route.role as SeedRole), e2eLocale: locale });
        }

        test('has zero axe violations', async ({ page, request }) => {
          skipIfKnown('axe', route.path);
          if (route.path === '/fees/dues' || route.path === '/students') {
            // Overlay openers below select the first row — make sure one exists.
            if (route.overlays?.length) await ensureDuesRow(request);
          }
          if (route.path === '/staff' && route.overlays?.length) await ensureFormerMember(request);
          if (theme === 'dark') {
            // Seeded via `addInitScript`, not a plain `localStorage.setItem`
            // after `goto()` — it has to be in place before
            // `client-admin/index.html`'s boot script reads it on the very
            // first navigation, the same requirement `theme-toggle.spec.ts`
            // and `color-scheme.spec.ts` document for the same call.
            await page.addInitScript(() => localStorage.setItem('biddaloy:theme', 'dark'));
          }
          const path = await resolvePath(request, route);
          await page.goto(path);
          await expect(pageOrDialogHeading(page, route)).toBeVisible();
          if (theme === 'dark') {
            expect(
              await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
            ).toBe('dark');
          }
          await expectNoAxeViolations(page);

          for (const overlay of route.overlays ?? []) {
            await test.step(`overlay ${overlay} open`, async () => {
              const opener = overlayOpeners[`${route.path}::${overlay}`];
              if (!opener) throw new Error(`no opener for ${route.path}::${overlay}`);
              await opener(page, locale);
              // A `-tab` overlay (and /dashboard's `customise` mode) is a state of the page, not a
              // dialog: scan the page body.
              await expectNoAxeViolations(
                page,
                overlay.endsWith('-tab') || overlay.startsWith('customise')
                  ? 'main'
                  : '[role="dialog"], [role="alertdialog"]',
              );
              await page.keyboard.press('Escape');
            });
          }
        });
      });
    }

    // [30.4.3]/[30.5.1] Global overlays — `CommandPalette` and
    // `ShortcutsSheet` — have no URL, so they sit outside the per-route
    // `routes` loop above. Opened from `/dashboard`, an arbitrary staff
    // route that's always reachable for the `admin` seed role.
    test.describe('$global overlays', () => {
      test.use({ ...loggedIn('admin'), e2eLocale: locale });

      for (const key of GLOBAL_OVERLAY_KEYS) {
        test(`${key} has zero axe violations`, async ({ page }) => {
          if (theme === 'dark') {
            await page.addInitScript(() => localStorage.setItem('biddaloy:theme', 'dark'));
          }
          await page.goto('/dashboard');
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          const opener = overlayOpeners[key];
          if (!opener) throw new Error(`no opener for ${key}`);
          await opener(page, locale);
          await expectNoAxeViolations(page, '[role="dialog"]');
        });
      }
    });
  });
}
