import type { APIRequestContext, Page } from '@playwright/test';

import { expectNoAxeViolations } from '../a11y/assert';
import { adminApiSession, createGuardian, createStudentWithDues, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { makeT, t } from '../i18n';
import { ListShellPage } from '../pages/list-shell';

/**
 * [97.4.03] Message log (`/communications/message-log`), Epic 97 D23/D25, rescoped by D10: no
 * vendor stub. Real rows come from the real send route (the e2e school has no SMS company, so the
 * message is recorded and fails); the Check status matrix and the 409 answer use API-layer mocks.
 * Nothing here reaches a company. [#3351 r1] Check status follows the row's own
 * `can_check_status` (the server decides), and the Company / Sent-by choices come from
 * `GET /communications/logs/filter-options`, readable by every role that opens the page.
 *
 * Not covered (needs a vendor): a status pull that flips Sent to Delivered, and a SENT row that
 * carries a real `provider_message_id`.
 */

const logPage = (page: Page) =>
  new ListShellPage(page, {
    titleKey: 'communications.messageLog.title',
    searchLabelKey: 'communications.messageLog.searchLabel',
  });

interface LogRow {
  id: string;
  status: string;
  recipient_name: string;
  message_body: string;
  can_check_status: boolean;
}

/** One guardian (unique name) and one manual SMS to them. Returns what the page will show. */
async function seedMessage(request: APIRequestContext, withStudent = false) {
  const session = await adminApiSession(request);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const name = `MsgLog Guardian ${stamp}`;
  const guardian = await createGuardian(request, session, name);
  let studentId: string | undefined;
  if (withStudent) {
    studentId = (
      await createStudentWithDues(request, session, `MsgLog Student ${stamp}`, {
        guardianId: guardian.id,
      })
    ).studentId;
  }
  await post(request, session, '/communications/send', {
    medium: 'SMS',
    guardian_id: guardian.id,
    ...(studentId ? { student_id: studentId } : {}),
    message_body: `Message log e2e ${stamp}`,
  });
  const read = () =>
    get<{ data: LogRow[] }>(
      request,
      session,
      `/communications/logs?search=${encodeURIComponent(name)}`,
    );
  // The worker settles the row a moment after the send; the steps below filter by its status, so
  // wait for the final one instead of reading QUEUED and racing the worker. 20 s: the default 5 s
  // ran out on a loaded machine (#3351 r2 local run 3 of 3).
  await expect
    .poll(async () => (await read()).data[0]?.status ?? 'none', { timeout: 20_000 })
    .not.toMatch(/^(QUEUED|none)$/);
  const logs = await read();
  expect(logs.data).toHaveLength(1);
  // Never SENT to a company here, so the server says no Check status.
  expect(logs.data[0]!.can_check_status).toBe(false);
  return { session, name, guardianId: guardian.id, studentId, row: logs.data[0]! };
}

test.describe('admin, real rows', () => {
  test.use(loggedIn('admin'));

  test('search and filters reach the API and narrow the rows; detail dialog; URL keeps filters', async ({
    page,
    request,
  }) => {
    // Seven page loads plus a worker round trip: 13-17 s alone, past 30 s on a loaded machine.
    test.setTimeout(90_000);
    const { name, row, session } = await seedMessage(request);
    const list = logPage(page);
    const logsCall = (param: string, value: string) =>
      page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          r.url().includes('/api/v1/communications/logs?') &&
          new URL(r.url()).searchParams.get(param) === value,
      );

    await page.goto('/communications/message-log');
    await list.expectLoaded();

    await test.step('search reaches the API, one row', async () => {
      const call = logsCall('search', name);
      await list.search(name);
      await call;
      await list.expectResultCount(1);
    });

    await test.step('Kind = Sent by staff keeps it, Automatic empties it', async () => {
      const manual = logsCall('trigger', 'MANUAL');
      await list.filterBySelect(
        'communications.messageLog.triggerFilterLabel',
        t('communications.messageLog.triggers.MANUAL'),
      );
      await manual;
      await expect(page).toHaveURL(/trigger=MANUAL/);
      await list.expectResultCount(1);

      const auto = logsCall('trigger', 'AUTOMATED');
      await list.filterBySelect(
        'communications.messageLog.triggerFilterLabel',
        t('communications.messageLog.triggers.AUTOMATED'),
      );
      await auto;
      await list.expectResultCount(0);
      await list.expectEmptyState('communications.messageLog.noMatch');
    });

    await test.step('channel and status from the URL reach the API', async () => {
      const other = row.status === 'SENT' ? 'READ' : 'SENT';
      await page.goto(
        `/communications/message-log?search=${encodeURIComponent(name)}&medium=SMS&status=${row.status}`,
      );
      await list.expectResultCount(1);
      await page.goto(
        `/communications/message-log?search=${encodeURIComponent(name)}&medium=EMAIL&status=${row.status}`,
      );
      await list.expectResultCount(0);
      await page.goto(
        `/communications/message-log?search=${encodeURIComponent(name)}&status=${other}`,
      );
      await list.expectResultCount(0);
      await page.reload();
      await list.expectResultCount(0);
      await expect(page).toHaveURL(new RegExp(`status=${other}`));
    });

    await test.step('detail dialog shows the D22 fields and the message; no Check status', async () => {
      await page.goto(`/communications/message-log?search=${encodeURIComponent(name)}`);
      await list.expectResultCount(1);
      await list.clickRowAction(name, 'communications.messageLog.viewDetail');
      const dialog = page.getByRole('dialog', {
        name: t('communications.messageLog.detail.title'),
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(name, { exact: true })).toBeVisible();
      for (const key of [
        'recipient',
        'channel',
        'status',
        'kind',
        'sentBy',
        'sent',
        'company',
        'providerMessageId',
        'segments',
        'batch',
        'error',
        'message',
      ]) {
        await expect(
          dialog
            .locator('dt')
            .getByText(t(`communications.messageLog.detail.${key}`), { exact: true }),
        ).toBeVisible();
      }
      // The message itself (D22), from the real row.
      await expect(dialog.getByText(row.message_body, { exact: true })).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: t('communications.messageLog.checkStatus') }),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    await test.step('server answers 409 with a fixed sentence for a message that cannot be checked', async () => {
      const res = await request.post(`/api/v1/communications/logs/${row.id}/check-status`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
          'X-Tenant-ID': session.tenantId,
          'Idempotency-Key': `e2e-msglog-${row.id}`,
        },
      });
      expect(res.status()).toBe(409);
      const body = (await res.json()) as { message: string };
      expect(body.message).not.toContain(row.id);
      expect(body.message).not.toContain(name);
    });
  });

  test('student and guardian views show only that person; Show all messages leaves the view', async ({
    page,
    request,
  }) => {
    const seeded = await seedMessage(request, true);
    const list = logPage(page);

    await page.goto(`/communications/message-log?guardian=${seeded.guardianId}`);
    await list.expectLoaded();
    await expect(page.getByText(t('communications.messageLog.scopedGuardian'))).toBeVisible();
    await list.expectResultCount(1);
    await expect(list.row(seeded.name)).toHaveCount(1);

    await page.goto(`/communications/message-log?student=${seeded.studentId}`);
    await expect(page.getByText(t('communications.messageLog.scopedStudent'))).toBeVisible();
    await list.expectResultCount(1);

    // [#3343] The filters work inside the view too, and the server keeps it to this student.
    const other = seeded.row.status === 'SENT' ? 'READ' : 'SENT';
    await page.goto(`/communications/message-log?student=${seeded.studentId}&status=${other}`);
    await list.expectResultCount(0);
    await page.goto(
      `/communications/message-log?student=${seeded.studentId}&status=${seeded.row.status}`,
    );
    await list.expectResultCount(1);
    await expect(page).toHaveURL(new RegExp(`student=${seeded.studentId}`));

    // A real link (it can open in a new tab), not a button.
    await page.getByRole('link', { name: t('communications.messageLog.scopedClear') }).click();
    await expect(page).not.toHaveURL(/student=/);
    await expect(page.getByText(t('communications.messageLog.scopedStudent'))).toHaveCount(0);
    await expect(
      page.getByRole('combobox', { name: t('communications.messageLog.statusFilterLabel') }),
    ).toBeVisible();
  });
});

test.describe('admin, API mocks', () => {
  test.use(loggedIn('admin'));
  // The production build's service worker answers /api itself, so `page.route()` never sees it.
  test.use({ serviceWorkers: 'block' });

  const stamp = `${Date.now()}`;
  const base = {
    medium: 'SMS',
    error: null,
    recipient_address: '01712345678',
    trigger: 'MANUAL',
    student_id: null,
    guardian_id: null,
    created_at: '2026-01-15T05:00:00.000Z',
    message_body: 'Dues reminder',
    subject: null,
    segments: 1,
    batch_id: null,
    is_test: false,
    sent_by_user_id: null,
    sent_by_name: null,
    can_check_status: false,
  };
  const rows = [
    {
      ...base,
      id: 'a0000000-0000-4000-8000-000000000001',
      recipient_name: `Can Check ${stamp}`,
      status: 'SENT',
      provider: 'onecodesoft',
      provider_message_id: 'vendor-1',
      // The one row the server says can be checked; every other row says no.
      can_check_status: true,
      is_test: true,
      batch_id: 'b0000000-0000-4000-8000-000000000001',
      sent_by_user_id: 'a0000000-0000-4000-8000-0000000000aa',
      sent_by_name: 'Rahima Akter',
    },
    {
      ...base,
      id: 'a0000000-0000-4000-8000-000000000002',
      recipient_name: `No Id ${stamp}`,
      status: 'SENT',
      provider: 'onecodesoft',
      provider_message_id: null,
    },
    {
      ...base,
      id: 'a0000000-0000-4000-8000-000000000003',
      recipient_name: `Delivered ${stamp}`,
      status: 'DELIVERED',
      provider: 'onecodesoft',
      provider_message_id: 'vendor-3',
    },
    {
      ...base,
      id: 'a0000000-0000-4000-8000-000000000004',
      recipient_name: `No Status Cap ${stamp}`,
      status: 'SENT',
      provider: 'greenweb',
      provider_message_id: 'vendor-4',
    },
    {
      ...base,
      id: 'a0000000-0000-4000-8000-000000000005',
      recipient_name: `No Company ${stamp}`,
      status: 'SENT',
      provider: null,
      provider_message_id: 'vendor-5',
    },
    {
      ...base,
      id: 'a0000000-0000-4000-8000-000000000006',
      recipient_name: `Failed ${stamp}`,
      status: 'FAILED',
      error: 'FAILED',
      provider: 'onecodesoft',
      provider_message_id: 'vendor-6',
    },
  ];
  const company = (name: string) => ({ medium: 'SMS', name, label: { en: name, bn: name } });

  async function mockApi(page: Page, seen: string[]) {
    await page.route('**/api/v1/communications/logs?*', (route) => {
      seen.push(route.request().url());
      return route.fulfill({
        json: { data: rows, total: rows.length, page: 1, limit: 25, totalPages: 1 },
      });
    });
    await page.route('**/api/v1/communications/logs/filter-options', (route) =>
      route.fulfill({
        json: {
          companies: [company('onecodesoft'), company('greenweb')],
          senders: [{ id: 'a0000000-0000-4000-8000-0000000000aa', full_name: 'Rahima Akter' }],
        },
      }),
    );
  }

  test('Check status follows the row flag; a 409 shows our sentence, never the server text', async ({
    page,
  }) => {
    await mockApi(page, []);
    const list = logPage(page);
    // Server text the page must never show (Rule 23/24): it picks its own translated sentence.
    const fixed = 'Server English text that must not reach the user.';
    let checks = 0;
    await page.route('**/api/v1/communications/logs/*/check-status', (route) => {
      checks += 1;
      return route.fulfill({
        status: 409,
        json: {
          statusCode: 409,
          message: fixed,
          error: 'Conflict',
          requestId: 'e2e-request',
          path: '/api/v1/communications/logs/check-status',
          timestamp: new Date().toISOString(),
        },
      });
    });

    await page.goto('/communications/message-log');
    await list.expectLoaded();
    await list.expectResultCount(rows.length);
    await expectNoAxeViolations(page);

    const checkButton = page
      .getByRole('dialog')
      .getByRole('button', { name: t('communications.messageLog.checkStatus') });
    for (const [prefix, visible] of [
      ['Can Check', true],
      ['No Id', false],
      ['Delivered', false],
      ['No Status Cap', false],
      ['No Company', false],
      ['Failed', false],
    ] as const) {
      await list.clickRowAction(`${prefix} ${stamp}`, 'communications.messageLog.viewDetail');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(checkButton).toHaveCount(visible ? 1 : 0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
    }

    // Back on the first row: its D22 detail (Test mark, sender, round link), then press it.
    await list.clickRowAction(`Can Check ${stamp}`, 'communications.messageLog.viewDetail');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(t('communications.messageLog.detail.test'))).toBeVisible();
    await expect(dialog.getByText('Rahima Akter', { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('link', { name: t('communications.messageLog.detail.batchLink') }),
    ).toHaveAttribute('href', /b0000000-0000-4000-8000-000000000001/);
    await checkButton.dblclick();
    await expect(page.getByText(t('communications.messageLog.checkStatusCannot'))).toBeVisible();
    await expect(page.getByText(fixed)).toHaveCount(0);
    // A double click asks once.
    expect(checks).toBe(1);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(checkButton).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await list.expectResultCount(rows.length);
  });

  test('every filter in the URL is sent to the API', async ({ page }) => {
    const seen: string[] = [];
    await mockApi(page, seen);
    const from = '2026-01-01';
    const to = '2026-01-31';
    await page.goto(
      `/communications/message-log?status=FAILED&medium=SMS&trigger=MANUAL&provider=onecodesoft&search=abc&from_date=${from}&to_date=${to}&sent_by=a0000000-0000-4000-8000-0000000000aa`,
    );
    await logPage(page).expectResultCount(rows.length);
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    const params = new URL(seen[seen.length - 1]!).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({
      status: 'FAILED',
      medium: 'SMS',
      trigger: 'MANUAL',
      provider: 'onecodesoft',
      search: 'abc',
      from_date: from,
      to_date: to,
      sent_by: 'a0000000-0000-4000-8000-0000000000aa',
    });
  });
});

test.describe('who can reach it', () => {
  for (const role of ['accountant', 'office_staff'] as const) {
    test.describe(`${role} (has COMMUNICATION_BULK_SEND, not SETTINGS_MANAGE / USER_READ)`, () => {
      test.use(loggedIn(role));
      test('nav link and page work, with the Company filter and no 403 on load', async ({
        page,
      }) => {
        const forbidden: string[] = [];
        page.on('response', (res) => {
          if (res.url().includes('/api/') && res.status() === 403) forbidden.push(res.url());
        });
        const options = page.waitForResponse(
          (r) => r.url().includes('/api/v1/communications/logs/filter-options') && r.ok(),
        );
        await page.goto('/communications/message-log');
        await logPage(page).expectLoaded();
        await options;
        await expect(
          page.getByRole('link', { name: t('nav.items.messageLog'), exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('combobox', { name: t('communications.messageLog.companyLabel') }),
        ).toBeVisible();
        expect(forbidden).toEqual([]);
      });
    });
  }

  test.describe('teacher (LOG_READ only)', () => {
    test.use(loggedIn('teacher'));
    test('no nav link, no palette action, URL shows no-access', async ({ page }) => {
      await page.goto('/communications/message-log');
      await expect(
        page.getByRole('heading', { name: t('common.accessDenied.title') }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: t('nav.items.messageLog'), exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+k');
      const box = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
      await expect(box).toBeFocused();
      for (const tab of ['action', 'page']) {
        await page.getByRole('tab', { name: t(`nav.commandPalette.tabs.${tab}`) }).click();
        await box.fill(t('nav.items.messageLog'));
        await expect(page.getByRole('option', { name: t('nav.items.messageLog') })).toHaveCount(0);
      }
    });
  });

  test.describe('admin palette', () => {
    test.use({ ...loggedIn('admin'), e2eLocale: 'en' });
    test('Ctrl+K "Message log" opens the page', async ({ page }) => {
      const en = makeT('en');
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.keyboard.press('ControlOrMeta+k');
      await expect(
        page.getByRole('combobox', { name: en('nav.commandPalette.ariaLabel') }),
      ).toBeFocused();
      await page.getByRole('tab', { name: en('nav.commandPalette.tabs.action') }).click();
      await page.keyboard.type('Message log');
      await expect(page.getByRole('option', { name: /^Message log/ }).first()).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/communications\/message-log/);
      await expect(
        page.getByRole('heading', { level: 1, name: en('communications.messageLog.title') }),
      ).toBeVisible();
    });
  });
});
