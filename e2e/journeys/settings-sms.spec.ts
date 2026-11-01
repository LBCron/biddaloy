import type { BrowserContext, Page } from '@playwright/test';

import {
  activateInvite,
  patch,
  provisionSchool,
  resendSchoolAdminInvitation,
  superAdminApiSession,
} from '../api';
import { shells } from '../config';
import { expect, test } from '../fixtures/test';
import { startVendorStub, type VendorStub } from '../fixtures/vendor-stub';
import { makeT } from '../i18n';

/**
 * [#3304] Settings › Communication › SMS against a fake OneCodeSoft on 127.0.0.1: choose the
 * company, Test connection, Send a test message, Save, then the Message log row and Check status.
 * The server accepts this loopback address only under the e2e-only seam (08-security Rule 7).
 * Runs against its own school, provisioned over the API (`provisionSchool`, same pattern as
 * `keyboard/organisation-structure.spec.ts`): saving a stub-backed company onto the shared seeded
 * school could change what another worker's spec sends, and a failed run would leave it pointed
 * at a closed stub. A throwaway school needs no cleanup.
 * Local runs: Playwright starts the API with the seam when :3000 is free. A dev server already on
 * :3000 is reused as is, so start it with `NODE_ENV=test OUTBOUND_TEST_ALLOW_LOOPBACK=true` or stop
 * it first, or every stub call is refused. CI never reuses a server.
 */
const t = makeT('en');
const phone = '01712345678';
// The Message log shows a number the way the region formats it.
const shownPhone = '01712-345678';
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
let stub: VendorStub;
let adminContext: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser, playwright }) => {
  stub = await startVendorStub();
  const setupRequest = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    const superAdmin = await superAdminApiSession(setupRequest);
    const provisioned = await provisionSchool(
      setupRequest,
      superAdmin,
      `E2E SMS School ${suffix}`,
      `e2e-sms-school-${suffix}`,
      'SMS Admin',
      `sms-admin-${suffix}@e2e.example.com`,
    );
    const inviteToken = await resendSchoolAdminInvitation(
      setupRequest,
      superAdmin,
      provisioned.schoolId,
      provisioned.adminUserId,
    );
    const activated = await activateInvite(setupRequest, inviteToken, 'A-strong-sms-pw-1');
    // [13.5.1] A fresh school's admin is sent to the setup wizard once; mark it seen.
    await patch(
      setupRequest,
      { token: activated.token, tenantId: activated.tenantId },
      '/onboarding',
      { seen: true },
    );
    const state = await setupRequest.storageState();
    adminContext = await browser.newContext({
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
              { name: 'biddaloy:locale', value: 'en' },
            ],
          },
        ],
      },
    });
  } finally {
    await setupRequest.dispose();
  }
  page = await adminContext.newPage();
});
test.afterAll(async () => {
  await adminContext?.close();
  await stub?.close();
});

test('OneCodeSoft: test connection, test message, save, log row, check status', async () => {
  test.setTimeout(120_000);
  const section = page.locator('#sms-section');

  await page.goto('/settings?section=communication');
  await expect(section).toBeVisible();

  await test.step('choose OneCodeSoft and fill the details', async () => {
    await section.getByRole('combobox', { name: t('settings.sms.provider') }).click();
    await page.getByRole('option', { name: 'OneCodeSoft' }).click();
    await section.getByLabel('Sender name').fill('E2ESchool');
    await section.getByLabel('API address').fill(stub.url);
    // A secret field shows no input until Add is pressed.
    await section
      .getByRole('button', { name: t('settings.secret.set') })
      .first()
      .click();
    await section.getByLabel('API key').first().fill('stub-key');
  });

  await test.step('a refused key shows our sentence and none of the vendor text', async () => {
    stub.failWith = 401;
    await section.getByRole('button', { name: t('settings.testConnection.action') }).click();
    await expect(section.getByText(t('settings.testConnection.failure'))).toBeVisible();
    await expect(page.getByText('Unauthenticated')).toHaveCount(0);
    stub.failWith = null;
  });

  await test.step('Test connection passes', async () => {
    await section.getByRole('button', { name: t('settings.testConnection.action') }).click();
    await expect(section.getByText(t('settings.testConnection.success'))).toBeVisible();
  });

  await test.step('Send a test message', async () => {
    await section.getByLabel(t('settings.sendTestMessage.phone')).fill(phone);
    await section.getByRole('button', { name: t('settings.sendTestMessage.label') }).click();
    await expect(section.getByText(t('settings.sendTestMessage.sent'))).toBeVisible();
    expect(stub.requests.some((r) => r.method === 'POST' && r.path === '/v3/send-sms')).toBe(true);
  });

  await test.step('Save shows the Set up pill', async () => {
    await section.getByRole('button', { name: t('settings.save.action') }).click();
    await expect(section.getByText(t('settings.channelStatus.ready'))).toBeVisible();
  });

  await test.step('the Message log has the Sent row; Check status reaches Delivered', async () => {
    await page.goto('/communications/message-log?search=Test');
    const row = page.getByRole('row').filter({ hasText: shownPhone }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: t('communications.messageLog.viewDetail') }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: t('communications.messageLog.checkStatus') }).click();
    // The toast lives outside the dialog (the app's Toaster), the status inside it.
    await expect(page.getByText(t('communications.messageLog.checkStatusDone'))).toBeVisible();
    await expect(dialog.getByText('Delivered').first()).toBeVisible();
  });
});
