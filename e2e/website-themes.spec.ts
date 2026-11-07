import {
  activateInvite,
  provisionSchool,
  resendSchoolAdminInvitation,
  superAdminApiSession,
} from './api';
import type { ApiSession } from './api';
import { shells } from './config';
import { expect, test } from './fixtures/test';
import { t } from './i18n';

/**
 * [40.4.10 #3648] School website designs: an ADMIN walks through every theme on Website > Design
 * (card selection, second colour set, save), publishes, and the public read API answers with the
 * same theme and palette.
 *
 * Why the API and not the page: the e2e stack does not run the site container, so there is no
 * `html[data-theme]` or CSS custom property to read. Theme and palette rendering (pixels,
 * contrast, no CSS leaking between themes) is checked by `site/e2e/themes/*.spec.ts`.
 *
 * Runs in its own school so publishing here never turns the shared school's website
 * into "published" under `journeys/website-setup.spec.ts`, which needs a never-published site.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

interface Theme {
  id: string;
  name: { bn?: string; en?: string };
  palettes: { id: string }[];
}
interface Site {
  theme: string;
  palette: string;
  subdomain: string;
  version: number;
  draft_revision: number;
  has_published: boolean;
  draft: { theme: string; palette: string };
}

test('admin switches every theme, saves, publishes, and the public read API agrees', async ({
  browser,
  playwright,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const setup = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  const superAdmin = await superAdminApiSession(setup);
  const provisioned = await provisionSchool(
    setup,
    superAdmin,
    `E2E Themes School ${suffix}`,
    `e2e-themes-school-${suffix}`,
    'Themes Admin',
    `themes-admin-${suffix}@e2e.example.com`,
  );
  const token = await resendSchoolAdminInvitation(
    setup,
    superAdmin,
    provisioned.schoolId,
    provisioned.adminUserId,
  );
  const activated = await activateInvite(setup, token, 'A-strong-themes-pw-1');
  const session: ApiSession = { token: activated.token, tenantId: activated.tenantId };
  const state = await setup.storageState();
  const headers = { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId };

  const context = await browser.newContext({
    storageState: {
      ...state,
      origins: [
        {
          origin: shells.app.baseURL.replace(/\/$/, ''),
          localStorage: [
            {
              name: 'biddaloy:activeTenant',
              value: JSON.stringify({ tenantId: activated.tenantId, role: activated.role }),
            },
          ],
        },
      ],
    },
  });
  const page = await context.newPage();

  try {
    const getJson = async <T>(path: string) => {
      const r = await setup.get(`/api/v1${path}`, { headers });
      expect(r.ok(), `${path}: ${r.status()}`).toBe(true);
      return (await r.json()) as T;
    };
    const themes = await getJson<Theme[]>('/website/themes');
    // The seven ids of the SiteTheme enum (shared/src/enums), each with at least two colour sets.
    expect(themes.map((x) => x.id).sort()).toEqual([
      'basic',
      'college',
      'high-school',
      'international',
      'madrasa',
      'premium',
      'primary',
    ]);

    await page.goto('/website/design');
    await expect(page.getByRole('heading', { name: t('website.design.designs') })).toBeVisible();
    let site = await getJson<Site>('/website');
    let enabled = false;

    for (const theme of themes) {
      await test.step(`theme ${theme.id}`, async () => {
        const card = page.getByRole('button', { name: theme.name.bn ?? theme.id, exact: true });
        if (site.draft.theme !== theme.id) {
          await card.click();
          await page.getByRole('button', { name: t('website.design.changeTheme.confirm') }).click();
        }
        await expect(card).toHaveAttribute('aria-pressed', 'true');

        const second = page
          .getByRole('radiogroup', { name: t('website.design.colours') })
          .getByRole('radio')
          .nth(1);
        await second.click();
        await expect(second).toBeChecked();

        const saved = page.waitForResponse(
          (r) => r.url().includes('/api/v1/website/draft') && r.request().method() === 'PUT',
        );
        await page.getByRole('button', { name: t('website.pages.saveDraft') }).click();
        expect((await saved).ok()).toBe(true);

        site = await getJson<Site>('/website');
        expect(site.draft.theme).toBe(theme.id);
        expect(site.draft.palette).toBe(theme.palettes[1].id);

        const published = await setup.post('/api/v1/website/publish', {
          headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
          data: { version: site.version, draft_revision: site.draft_revision },
        });
        expect(published.ok(), `publish: ${published.status()}`).toBe(true);
        if (!enabled) {
          const on = await setup.post('/api/v1/website/enabled', {
            headers,
            data: { enabled: true },
          });
          expect(on.ok(), `enable: ${on.status()}`).toBe(true);
          enabled = true;
        }
        site = await getJson<Site>('/website');

        // Anonymous read of the live site, by host (SITE_ROOT_DOMAIN is sites.e2e.test).
        const manifest = await setup.get(
          `/api/v1/public/site/by-host/${site.subdomain}.sites.e2e.test/manifest`,
        );
        expect(manifest.ok(), `manifest: ${manifest.status()}`).toBe(true);
        expect(await manifest.json()).toMatchObject({
          theme: theme.id,
          palette: theme.palettes[1].id,
        });
      });
    }
  } finally {
    await context.close();
    await setup.dispose();
  }
});
