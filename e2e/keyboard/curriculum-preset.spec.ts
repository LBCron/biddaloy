import type { Browser, BrowserContext, Page, PlaywrightWorkerArgs } from '@playwright/test';

import {
  activateInvite,
  applyPreset,
  get,
  patch,
  presetState,
  provisionSchool,
  resendSchoolAdminInvitation,
  superAdminApiSession,
  type ApiSession,
} from '../api';
import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { focusedText, tabUntilFocused } from './keyboard-utils';

/**
 * [35.5.3] Curriculum preset, KEYBOARD ONLY. No `page.mouse` and no
 * `.click(` call anywhere in this file.
 *
 * Applying a preset needs a FRESH school (any academic year / class / student
 * turns the status to CUSTOM), and a reset wipes it again — so each journey
 * provisions its own dedicated tenant over the API (same pattern as
 * `organisation-structure.spec.ts`) instead of touching the shared seeded one.
 */

// Pack data (`server/src/modules/presets/packs/bd/nctb`): the English name is
// the phrase the confirm dialog wants typed; the Bangla names are what the
// default-locale UI renders for the cards and checkboxes.
const NCTB_NAME_EN = 'Bangladesh NCTB curriculum';
const NCTB_NAME_BN = 'বাংলাদেশ এনসিটিবি পাঠ্যক্রম';
const NCTB_STAGES_BN = ['প্রাথমিক', 'নিম্ন মাধ্যমিক', 'মাধ্যমিক', 'উচ্চ মাধ্যমিক'];
const NCTB_VERSION_BANGLA_BN = 'বাংলা';
// Pack's PRIMARY stage = classes 1-5.
const PRIMARY_CLASS_COUNT = 5;
// `action-registry.ts` `presets.apply` — the palette has no i18n catalog.
const PALETTE_APPLY_LABEL_BN = 'তৈরি শিক্ষাক্রম ব্যবহার করুন';

interface FreshSchool {
  schoolId: string;
  admin: ApiSession & { role: string };
  adminContext: BrowserContext;
}

async function freshSchool(
  browser: Browser,
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<FreshSchool> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const setupRequest = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    const superAdmin = await superAdminApiSession(setupRequest);
    const provisioned = await provisionSchool(
      setupRequest,
      superAdmin,
      `E2E Preset School ${suffix}`,
      `e2e-preset-school-${suffix}`,
      'Preset Admin',
      `preset-admin-${suffix}@e2e.example.com`,
    );
    const inviteToken = await resendSchoolAdminInvitation(
      setupRequest,
      superAdmin,
      provisioned.schoolId,
      provisioned.adminUserId,
    );
    const admin = await activateInvite(setupRequest, inviteToken, 'A-strong-preset-pw-1');
    // [13.5.1] A fresh school's admin is sent from /dashboard to the setup
    // wizard once; this journey is about the palette, so mark it seen.
    await patch(setupRequest, admin, '/onboarding', { seen: true });
    const state = await setupRequest.storageState();
    const adminContext = await browser.newContext({
      storageState: {
        ...state,
        origins: [
          {
            origin: shells.app.baseURL.replace(/\/$/, ''),
            localStorage: [
              {
                name: 'biddaloy:activeTenant',
                value: JSON.stringify({ tenantId: admin.tenantId, role: admin.role }),
              },
            ],
          },
        ],
      },
    });
    return { schoolId: provisioned.schoolId, admin, adminContext };
  } finally {
    await setupRequest.dispose();
  }
}

/** Presses Tab once (twice past a (?)) and asserts the checkbox with this exact label took focus. */
async function tabToCheckbox(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Tab');
  // The Stages legend carries a (?) (Epic 44) that sits before the first checkbox.
  if (await page.evaluate(() => document.activeElement?.hasAttribute('data-help-id')))
    await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name, exact: true })).toBeFocused();
}

test.describe('apply a curriculum preset', () => {
  test.setTimeout(90_000);

  test('palette -> pick NCTB -> Primary + Bangla -> review -> type name -> apply', async ({
    browser,
    playwright,
  }) => {
    const { admin, adminContext } = await freshSchool(browser, playwright);
    const page = await adminContext.newPage();
    const api = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    try {
      expect(await presetState(api, admin)).toBe('AVAILABLE');

      await test.step('Ctrl+K, Action tab, "Use a ready-made curriculum"', async () => {
        await page.goto('/dashboard');
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await page.keyboard.press('ControlOrMeta+k');
        await expect(
          page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
        ).toBeFocused();
        await page.keyboard.press('Control+3');
        await expect(
          page.getByRole('tab', { name: t('nav.commandPalette.tabs.action') }),
        ).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.type(PALETTE_APPLY_LABEL_BN);
        await expect(page.getByRole('option', { name: PALETTE_APPLY_LABEL_BN })).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/curriculum-preset$/);
        // The page swaps a skeleton for the wizard after `useRouteFocus` ran,
        // so the <h1> does not keep focus here; Tab walks in from the top.
        await expect(
          page.getByRole('heading', { level: 1, name: t('curriculumPreset.title') }),
        ).toBeVisible();
      });

      await test.step('focus the NCTB card, Enter previews, Esc closes', async () => {
        // `exact`: `useRouteFocus` can land late on `<main>` (heading swapped
        // by the skeleton) in the middle of this walk, and `<main>`'s text
        // *contains* the card name — a substring match stops there.
        await tabUntilFocused(page, NCTB_NAME_BN, 200, { exact: true });
        const card = page.getByRole('group', { name: NCTB_NAME_BN });
        await expect(card).toBeFocused();
        await page.keyboard.press('Enter');
        // Only the open dialog: the palette that launched this page may still be animating out
        // (data-state="closed"), and an unscoped role match is then a strict-mode violation.
        const preview = page.locator('[role="dialog"][data-state="open"]');
        await expect(preview).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(preview).toBeHidden();
        // The preview opens from state (no Radix trigger), so the page hands
        // focus back to the card that opened it.
        await expect(card).toBeFocused();
      });

      await test.step('Tab to Select (pressed), then Next', async () => {
        await page.keyboard.press('Tab');
        expect(await focusedText(page)).toBe(t('curriculumPreset.cards.select'));
        await page.keyboard.press('Enter');
        await expect(
          page.getByRole('button', { name: t('curriculumPreset.cards.selected') }),
        ).toHaveAttribute('aria-pressed', 'true');
        await tabUntilFocused(page, t('common.wizard.next'), 40, { tag: 'BUTTON' });
        await page.keyboard.press('Enter');
        await expect(
          page.getByRole('checkbox', { name: NCTB_STAGES_BN[0]!, exact: true }),
        ).toBeVisible();
      });

      await test.step('options: only Primary + Bangla', async () => {
        await tabToCheckbox(page, NCTB_STAGES_BN[0]!); // Primary stays on
        for (const stage of NCTB_STAGES_BN.slice(1)) {
          await tabToCheckbox(page, stage);
          await page.keyboard.press('Space');
          await expect(page.getByRole('checkbox', { name: stage, exact: true })).not.toBeChecked();
        }
        await tabToCheckbox(page, NCTB_VERSION_BANGLA_BN);
        await page.keyboard.press('Space');
        await expect(
          page.getByRole('checkbox', { name: NCTB_VERSION_BANGLA_BN, exact: true }),
        ).toBeChecked();
        await tabUntilFocused(page, t('common.wizard.next'), 40, { tag: 'BUTTON' });
        await page.keyboard.press('Enter');
        // The pack is unverified: the review step carries the warning.
        await expect(
          page.getByRole('note').filter({ hasText: t('curriculumPreset.unverifiedWarning') }),
        ).toBeVisible();
      });

      await test.step('review: open the confirm dialog, type the exact name, apply', async () => {
        await tabUntilFocused(page, t('curriculumPreset.submit'), 10, { tag: 'BUTTON' });
        await page.keyboard.press('Enter');
        // The label names the preset in the UI language (bn); the English
        // name is still accepted (`alsoAccept`, #2948), so typing it must
        // enable Apply — the POST below proves it did.
        const nameField = page.getByRole('textbox', {
          name: t('curriculumPreset.confirm.typeLabel', { name: NCTB_NAME_BN }),
        });
        await expect(nameField).toBeFocused();
        await page.keyboard.type(NCTB_NAME_EN);
        await tabUntilFocused(page, t('curriculumPreset.confirm.apply'), 5, { tag: 'BUTTON' });
        const applied = page.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/presets/apply'),
        );
        await page.keyboard.press('Enter');
        const response = await applied;
        expect(response.ok(), await response.text()).toBe(true);
      });

      await test.step('applied summary + exactly the Primary classes exist', async () => {
        await expect(
          page.getByRole('heading', { name: t('curriculumPreset.applied.title') }),
        ).toBeVisible();
        const classes = await get<{ data: unknown[]; total: number }>(api, admin, '/classes');
        expect(classes.total).toBe(PRIMARY_CLASS_COUNT);
      });

      await test.step('same school afterwards: summary only, no apply control', async () => {
        await page.reload();
        await expect(
          page.getByRole('heading', { name: t('curriculumPreset.applied.title') }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: t('curriculumPreset.submit') })).toHaveCount(
          0,
        );
        expect(await presetState(api, admin)).toBe('APPLIED');
      });
    } finally {
      await api.dispose();
      await adminContext.close();
    }
  });
});

test.describe('super-admin reset', () => {
  test.use(loggedIn('super_admin'));
  test.setTimeout(90_000);

  test('school detail -> Reset curriculum preset with a reason -> Available again', async ({
    page,
    browser,
    playwright,
  }) => {
    const { schoolId, admin, adminContext } = await freshSchool(browser, playwright);
    const api = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    try {
      await applyPreset(api, admin, {
        presetId: 'bd/nctb',
        startYear: new Date().getFullYear(),
        stages: ['PRIMARY'],
        versions: ['bangla'],
      });
      expect(await presetState(api, admin)).toBe('APPLIED');

      await test.step('open the card by keyboard and fill the reason', async () => {
        await page.goto(`/schools/${schoolId}`);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await tabUntilFocused(page, t('presetReset.card.button'), 120, { tag: 'BUTTON' });
        await page.keyboard.press('Enter');
        const reason = page.getByRole('textbox', { name: t('presetReset.dialog.reasonLabel') });
        await expect(reason).toBeFocused();
        await page.keyboard.type('E2E keyboard reset of a throwaway school');
      });

      await test.step('Tab to confirm, Enter, wait for the reset response', async () => {
        await tabUntilFocused(page, t('presetReset.dialog.confirm'), 5, { tag: 'BUTTON' });
        const reset = page.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().endsWith('/preset/reset'),
        );
        await page.keyboard.press('Enter');
        const response = await reset;
        expect(response.ok(), await response.text()).toBe(true);
        await expect(page.getByRole('dialog')).toBeHidden();
      });

      await test.step('the school is Available again and its admin sees the cards', async () => {
        expect(await presetState(api, admin)).toBe('AVAILABLE');
        const adminPage = await adminContext.newPage();
        await adminPage.goto('/curriculum-preset');
        await expect(adminPage.getByRole('group', { name: NCTB_NAME_BN })).toBeVisible();
      });
    } finally {
      await api.dispose();
      await adminContext.close();
    }
  });
});
