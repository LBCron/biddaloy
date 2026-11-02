import type { APIRequestContext, Page } from '@playwright/test';

import { adminApiSession, get, post, type ApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { fileStudentLeave, freeLeaveDays } from '../responsive/routes';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS, type SeedRole } from '../seed-contract';

// [52.5.8] The staff Applications screens, end to end: file a leave and see the balance move,
// bulk approve (never a fee waiver), the reports page, the student tab, and the old route gone.

interface ListItem {
  id: string;
  serial: string;
  type: string;
  subject_student_id: string | null;
  can: { decide: boolean };
}

async function roleSession(request: APIRequestContext, role: SeedRole): Promise<ApiSession> {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const response = await request.post('/api/v1/auth/login', {
    data: { email: SEED_ROLE_EMAILS[role], password },
  });
  if (!response.ok()) throw new Error(`${role} login failed: ${response.status()}`);
  const body = (await response.json()) as {
    access_token: string;
    memberships: { tenantId: string }[];
  };
  return { token: body.access_token, tenantId: body.memberships[0]!.tenantId };
}

/** Opens the kit DatePicker named `label` and picks `iso` (same pattern as `admission.spec.ts`). */
async function pickDate(page: Page, label: string, iso: string): Promise<void> {
  const grid = page.getByRole('grid');
  const cell = page.locator(`[data-date="${iso}"]`);
  // CI once saw the second popover dismissed right after it opened (cell "not stable", then
  // detached): reopen and retry instead of waiting out the test timeout on a gone cell.
  await expect(async () => {
    if (!(await grid.isVisible()))
      await page.getByRole('button', { name: label }).click({ timeout: 3_000 });
    // The picker opens on this month; the free day may be a few months ahead. Every click has a
    // short timeout so a popover that closed mid-loop fails this attempt and toPass reopens it.
    for (let i = 0; i < 12 && !(await cell.isVisible()); i += 1) {
      await page
        .getByRole('button', { name: t('common.date.nextMonth') })
        .click({ timeout: 3_000 });
    }
    await cell.click({ timeout: 3_000 });
  }).toPass({ timeout: 15_000 });
  // The closing popover of the first field must be gone before the second one opens.
  await expect(grid).toHaveCount(0);
}

const isoDate = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

/**
 * The first Monday at least two days after the school's today (Asia/Dhaka, as the server decides
 * it, not the runner's clock), as `YYYY-MM-DD`. The dashboard seed (`seed.dashboard.ts`
 * `seedStaff`) holds an APPROVED leave_record with no application on today and tomorrow for
 * `staff_profiles[1]` by id, which can be this admin; `freeStaffLeaveDay` only sees applications.
 * Counting from the runner's clock, Sunday 18:00-24:00 UTC gave Dhaka's Monday: LEAVE_OVERLAP.
 */
function nextMonday(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * The first working day from next Monday to the end of this year (the calendar API, so no seeded
 * holiday) that none of this staff member's open or approved leaves covers: a rerun on one
 * database must not hit LEAVE_OVERLAP, and the balance compared below is this year's.
 */
async function freeStaffLeaveDay(
  request: APIRequestContext,
  session: ApiSession,
  staffProfileId: string,
): Promise<string> {
  const { dates } = await get<{ dates: string[] }>(
    request,
    session,
    `/school-calendar/working-days?from=${nextMonday()}&to=${nextMonday().slice(0, 4)}-12-31`,
  );
  // ponytail: one page of 100 leaves; page through if a database ever holds more.
  const leaves = await get<{
    data: { status: string; start_date: string | null; end_date: string | null }[];
  }>(
    request,
    session,
    `/applications?view=all&type=STAFF_LEAVE&staff_profile_id=${staffProfileId}&limit=100`,
  );
  const held = leaves.data.filter((a) =>
    ['PENDING', 'UNDER_CONSIDERATION', 'APPROVED'].includes(a.status),
  );
  const day = dates.find((d) => !held.some((a) => a.start_date! <= d && d <= a.end_date!));
  if (!day) throw new Error('no free working day left this year for the admin');
  return day;
}

const rowFor = (page: Page, serial: string) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name: `আবেদন ${serial} খুলুন` }) });

test.describe.serial('staff leave: file -> approve -> balance moves', () => {
  // The balance endpoint reads the current year only: no room once next week is next year.
  test.skip(
    nextMonday().slice(0, 4) !== String(new Date().getFullYear()),
    'next week is already next year',
  );
  let applicationId: string | undefined;
  let balanceBefore: number;
  let staffProfileId: string;

  // Cancel the approved leave (the executive approved it; nobody cancels their own) so its CASUAL
  // days return: reruns on one database would otherwise drain the quota into LEAVE_BALANCE_EXCEEDED.
  test.afterAll(async ({ request }) => {
    if (!applicationId) return;
    const executive = await roleSession(request, 'executive');
    const res = await request.post(`/api/v1/applications/${applicationId}/cancel`, {
      headers: { Authorization: `Bearer ${executive.token}`, 'X-Tenant-ID': executive.tenantId },
      data: { reason: 'E2E cleanup' },
    });
    // Cleanup only: never fail the run, but say so — a silent failure brings the quota drain back.
    if (!res.ok())
      console.warn(`staff-leave cleanup cancel failed: ${res.status()} ${await res.text()}`);
  });

  test.describe('1. admin files a casual leave', () => {
    test.use(loggedIn('admin'));

    test('Ctrl+K action opens the form at step 2; submit lands on the detail', async ({
      page,
      request,
    }) => {
      const session = await adminApiSession(request);
      const me = await get<{ staff_profile_id: string | null }>(request, session, '/users/me');
      if (!me.staff_profile_id) throw new Error('seed admin has no staff profile');
      staffProfileId = me.staff_profile_id;
      const balances = await get<{ leave_type: string; balance: number | null }[]>(
        request,
        session,
        `/leave/balance?staff_profile_id=${staffProfileId}`,
      );
      const casual = balances.find((b) => b.leave_type === 'CASUAL');
      // The seed gives CASUAL a quota; null would mean "unlimited" and nothing could move.
      expect(casual?.balance).not.toBeNull();
      balanceBefore = casual!.balance!;

      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.keyboard.press('ControlOrMeta+k');
      await expect(
        page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
      ).toBeFocused();
      await page.keyboard.press('Control+3'); // Action tab
      await page.keyboard.type('ছুটির আবেদন করুন');
      await expect(page.getByRole('option').first()).toBeVisible();
      // The form re-renders when the balance hint arrives; a picker opened before then is replaced.
      const balanceLoaded = page.waitForResponse(
        (r) => r.url().includes('/leave/balance') && r.ok(),
      );
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/applications\/new\?type=STAFF_LEAVE/);
      await balanceLoaded;

      const day = await freeStaffLeaveDay(request, session, staffProfileId);
      await page.getByRole('combobox', { name: t('applicationForms.fields.leaveType') }).click();
      await page.getByRole('option', { name: t('leave.type.CASUAL') }).click();
      // The Select hands focus back to its trigger when its close animation ends; a date popover
      // opened before that loses focus and closes (seen on slow CI runners).
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await pickDate(page, t('applicationForms.fields.startDate'), day);
      await pickDate(page, t('applicationForms.fields.endDate'), day);
      await page.getByLabel(t('applicationForms.fields.reason')).fill('E2E পারিবারিক কাজ');
      const next = page.getByRole('button', { name: t('applicationsNew.actions.next') });
      await next.click(); // details -> addressee
      await next.click(); // -> attachments
      await next.click(); // -> letter preview
      await page.getByRole('button', { name: t('applicationsNew.actions.submit') }).click();

      await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);
      applicationId = page.url().split('/').pop()!;
      await expect(page.getByText(t('applications.statuses.PENDING')).first()).toBeVisible();
      const created = await get<{ serial: string }>(
        request,
        session,
        `/applications/${applicationId}`,
      );
      await expect(page.getByText(created.serial).first()).toBeVisible();
      // A15: nobody decides their own application.
      await expect(
        page
          .getByRole('button', { name: t('applicationsDetail.actions.approve') })
          .and(page.locator(':not([data-help-id])')),
      ).toHaveCount(0);
    });
  });

  test.describe('2. executive approves it', () => {
    test.use(loggedIn('executive'));

    test('the detail page shows Approve and the status becomes approved', async ({ page }) => {
      await page.goto(`/applications/${applicationId}`);
      await page
        .getByRole('button', { name: t('applicationsDetail.actions.approve') })
        .and(page.locator(':not([data-help-id])'))
        .click();
      // Wait for the approve itself: the APPROVED text also shows elsewhere on the page, so it
      // passed while the server answered 409 LEAVE_OVERLAP.
      const approved = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/applications/${applicationId}/approve`) &&
          r.request().method() === 'POST',
      );
      await page
        .getByRole('button', { name: t('applicationsDetail.dialogs.approve.submit') })
        .click();
      expect((await approved).ok()).toBe(true);
      await expect(page.getByText(t('applications.statuses.APPROVED')).first()).toBeVisible();
    });
  });

  test.describe('3. admin sees the balance drop', () => {
    test.use(loggedIn('admin'));

    test('balance fell by the approved working days', async ({ request }) => {
      const session = await adminApiSession(request);
      const app = await get<{ status: string; effect_result: { days: number } | null }>(
        request,
        session,
        `/applications/${applicationId}`,
      );
      expect(app.status).toBe('APPROVED');
      const days = app.effect_result?.days ?? 0;
      expect(days).toBeGreaterThan(0);
      const balances = await get<{ leave_type: string; balance: number }[]>(
        request,
        session,
        `/leave/balance?staff_profile_id=${staffProfileId}`,
      );
      expect(balances.find((b) => b.leave_type === 'CASUAL')?.balance).toBe(balanceBefore - days);
    });
  });
});

test.describe('staff leave approved by mistake: revoke days already taken', () => {
  test.use(loggedIn('executive'));

  const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return isoDate(d);
  };

  test('executive cancels an ended approved leave with the mistake box ticked; the balance shows the days back', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const me = await get<{ staff_profile_id: string | null }>(request, admin, '/users/me');
    if (!me.staff_profile_id) throw new Error('seed admin has no staff profile');
    const balanceOf = async () =>
      (
        await get<{ leave_type: string; balance: number }[]>(
          request,
          admin,
          `/leave/balance?staff_profile_id=${me.staff_profile_id}`,
        )
      ).find((b) => b.leave_type === 'SICK')?.balance;
    const before = await balanceOf();

    // A leave that has already ended, approved by the executive (nobody cancels their own).
    const filed = await post<{ id: string }>(request, admin, '/applications', {
      type: 'STAFF_LEAVE',
      payload: {
        // SICK, not CASUAL: the journey above checks the same admin's CASUAL balance, and the two
        // tests can run at the same time.
        leave_type: 'SICK',
        start_date: daysAgo(10),
        end_date: daysAgo(8),
        reason: 'E2E mistake',
      },
    });
    const executive = await roleSession(request, 'executive');
    await post(request, executive, `/applications/${filed.id}/approve`, {});
    expect(await balanceOf()).toBeLessThan(before!);

    await page.goto(`/applications/${filed.id}`);
    await page.getByRole('button', { name: t('common.actions.moreActions') }).click();
    await page.getByRole('menuitem', { name: t('applicationsDetail.actions.cancel') }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(t('applicationsDetail.dialogs.cancel.reasonLabel'))
      .fill('Approved the wrong person');
    await dialog
      .getByRole('checkbox', { name: t('applicationsDetail.dialogs.cancel.revokeTakenDays') })
      .click();
    // Wait for the cancel itself: the CANCELLED status text is also a substring of the submit
    // button's label, so seeing it proves nothing about the server (#2409).
    const cancelled = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/applications/${filed.id}/cancel`) && r.request().method() === 'POST',
    );
    await dialog
      .getByRole('button', { name: t('applicationsDetail.dialogs.cancel.submit') })
      .click();
    expect((await cancelled).ok()).toBe(true);
    expect(await balanceOf()).toBe(before);
  });
});

test.describe('bulk approve (teacher)', () => {
  test.use(loggedIn('teacher'));

  // The fee waiver stays pending by design; reject it after, or reruns pile up in the inbox.
  let waiverId: string | undefined;
  test.afterEach(async ({ request }) => {
    if (!waiverId) return;
    const teacher = await roleSession(request, 'teacher');
    await request.post(`/api/v1/applications/${waiverId}/reject`, {
      headers: { Authorization: `Bearer ${teacher.token}`, 'X-Tenant-ID': teacher.tenantId },
      data: { reason: 'E2E cleanup' },
    });
  });

  test('approves 3 leaves, skips the fee waiver, and says so', async ({ page, request }) => {
    // Own rows, so parallel shards never consume each other's: filed for a student in the
    // teacher's section (found from the teacher's own inbox) as paper entries by the admin.
    const teacher = await roleSession(request, 'teacher');
    const admin = await adminApiSession(request);
    const inbox = await get<{ data: ListItem[] }>(request, teacher, '/applications?view=inbox');
    const studentId = inbox.data.find((a) => a.subject_student_id)?.subject_student_id;
    if (!studentId) throw new Error('teacher inbox has no student application (seed)');
    // Distinct free working days: approving one must never overlap another of the same student.
    const leaves = [];
    for (const day of await freeLeaveDays(request, admin, studentId, 3)) {
      leaves.push(await fileStudentLeave(request, admin, studentId, day));
    }
    const waiver = await post<{ id: string; serial: string }>(request, admin, '/applications', {
      type: 'FEE_WAIVER',
      subject_student_id: studentId,
      applicant_name: 'E2E অভিভাবক',
      payload: { kind: 'FLAT', value: 200, reason: 'E2E' },
    });
    waiverId = waiver.id;

    await page.goto('/applications?view=inbox');
    for (const { serial } of [...leaves, waiver]) {
      await rowFor(page, serial).getByRole('checkbox').check();
    }
    await page
      .getByRole('button', { name: t('applicationsList.bulk.approve') })
      .and(page.locator(':not([data-help-id])'))
      .click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog).toContainText(t('applicationsList.bulk.confirmBodyExcluded', { n: 1 }));
    const [request3] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/applications/bulk-approve')),
      dialog.getByRole('button', { name: t('applicationsList.bulk.confirm') }).click(),
    ]);
    expect((request3.postDataJSON() as { ids: string[] }).ids).toHaveLength(3);
    await expect(
      page.getByText(t('applicationsList.bulk.resultTitle', { total: 3, ok: 3 })),
    ).toBeVisible();
    // The fee waiver needs its own look (D35): still waiting in the inbox.
    await expect(rowFor(page, waiver.serial)).toBeVisible();
  });
});

test.describe('reports', () => {
  test.describe('admin', () => {
    test.use(loggedIn('admin'));

    test('header link opens the report; a stale testimonial is listed', async ({ page }) => {
      await page.goto('/applications');
      // Scoped to the page: the sidebar has a "Reports" group button of the same name.
      await page
        .locator('#main-content')
        .getByRole('button', { name: t('applicationsList.actions.reports') })
        .click();
      await expect(page).toHaveURL(/\/applications\/reports/);
      await expect(
        page.getByRole('heading', { level: 1, name: t('nav.items.applicationsReportsNav') }),
      ).toBeVisible();
      await expect(page.getByLabel(t('applicationsReports.tilesLabel'))).toBeVisible();
      const crumbs = page.locator('[data-slot="breadcrumbs"]');
      await expect(crumbs).toContainText(t('nav.items.applications'));
      await expect(crumbs).toContainText(t('nav.items.applicationsReports'));
      const stale = page.getByRole('region', { name: t('applicationsReports.staleTitle') });
      await expect(
        stale
          .getByRole('row')
          .filter({ hasText: t('applications.types.TESTIMONIAL') })
          .first(),
      ).toBeVisible();
    });
  });

  test.describe('teacher', () => {
    test.use(loggedIn('teacher'));

    test('has no header link and the report is refused', async ({ page }) => {
      await page.goto('/applications');
      await expect(
        page.getByRole('heading', { level: 1, name: t('nav.items.applications') }),
      ).toBeVisible();
      await expect(
        page
          .locator('#main-content')
          .getByRole('button', { name: t('applicationsList.actions.reports') }),
      ).toHaveCount(0);
      await page.goto('/applications/reports');
      await expect(
        page.getByRole('heading', { name: t('common.accessDenied.title') }),
      ).toBeVisible();
      await expect(page.getByLabel(t('applicationsReports.tilesLabel'))).toHaveCount(0);
    });
  });
});

test.describe('student tab and the retired route (admin)', () => {
  test.use(loggedIn('admin'));

  test('the student page lists their applications; the eye opens one', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const all = await get<{ data: ListItem[] }>(request, admin, '/applications?view=all');
    const row = all.data.find((a) => a.subject_student_id);
    if (!row) throw new Error('no student application seeded');
    await page.goto(`/students/${row.subject_student_id}?tab=applications`);
    const open = page.locator(`a[href$="/applications/${row.id}"]`).first();
    await expect(open).toBeVisible();
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/applications/${row.id}$`));
  });

  test('POST /leave/requests is gone (D20)', async ({ request }) => {
    const admin = await adminApiSession(request);
    const response = await request.post('/api/v1/leave/requests', {
      headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId },
      data: {},
    });
    expect(response.status()).toBe(404);
  });
});
