import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';
import { resolvePath } from '../responsive/routes';
import { expectNoAxeViolations } from './assert';

/**
 * [53.4 / #3382] Axe scan (blocking) of the five notice screens (portal detail too), both locales (no `@sweep` tag, so it runs on every PR, not only nightly): the staff list,
 * the composer, the staff detail, the portal list and the portal detail. The detail uses the notice the e2e seed
 * publishes (`seed.notices.ts`). The routes are also in the manifest sweep; this spec names the
 * epic's screens so a regression here points straight at them.
 */
for (const locale of ['bn', 'en'] as const) {
  const t = makeT(locale);

  test.describe(`notices staff screens · ${locale}`, () => {
    test.use({ ...loggedIn('admin'), e2eLocale: locale });

    test('list has zero axe violations', async ({ page }) => {
      await page.goto('/communications/notices');
      await expect(
        page.getByRole('heading', { level: 1, name: t('notices.manage.listTitle') }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('compose has zero axe violations', async ({ page }) => {
      await page.goto('/communications/notices/new');
      await expect(page.getByLabel(t('noticeCompose.fields.title'))).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('detail has zero axe violations', async ({ page, request }) => {
      const path = await resolvePath(request, {
        path: '/communications/notices/$noticeId',
        role: 'admin',
        archetype: 'detail',
      });
      await page.goto(path);
      await expect(page.getByRole('tab', { name: t('notices.manage.tabReport') })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });

  test.describe(`notices portal list · ${locale}`, () => {
    test.use({ ...loggedIn('parent'), e2eLocale: locale });

    test('portal list has zero axe violations', async ({ page }) => {
      await page.goto('/portal/notices');
      await expect(
        page.getByRole('heading', { level: 1, name: t('portalNotices.title') }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('portal detail has zero axe violations', async ({ page, request }) => {
      const path = await resolvePath(request, {
        path: '/portal/notices/$noticeId',
        role: 'parent',
        archetype: 'detail',
      });
      await page.goto(path);
      await expect(
        page.getByRole('heading', { level: 1, name: t('portalNotices.title') }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}
