import { AttendanceStatus } from '@biddaloy/shared';
import type { APIRequestContext } from '@playwright/test';
import {
  adminApiSession,
  apiSession,
  createStudentsInSection,
  get,
  isFridayAnywhere,
  markableDateIso,
  post,
  put,
  type ApiSession,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [76.5.08] Who saves the daily register (Epic 76 D1, D5, D10, D23), end to end:
 *  1. CLASS_TEACHER source: a teacher who is not the class teacher sees the banner
 *     and no Save; the class teacher still saves.
 *  2. DEVICE source: a student the machine saw but the register marks absent shows
 *     on the check-list, and the register carries the scanned badge.
 *  3. Settings > Attendance machines: add a machine, see the key once, revoke it.
 *
 * Serial: tests 1 and 2 flip the tenant's `attendance.dailySource`, restored in a
 * `finally`, so nothing else in this file may run beside them.
 */
test.describe.configure({ mode: 'serial' });

const DATE = markableDateIso();

interface Settings {
  version: number;
  attendance?: Record<string, unknown>;
}

async function setSource(
  request: APIRequestContext,
  admin: ApiSession,
  dailySource: 'ANY' | 'CLASS_TEACHER' | 'DEVICE',
) {
  const path = `/schools/${admin.tenantId}/settings`;
  const current = await get<Settings>(request, admin, path);
  const response = await request.patch(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId },
    data: { version: current.version, attendance: { ...current.attendance, dailySource } },
  });
  expect(response.ok(), `setting dailySource failed: ${response.status()}`).toBe(true);
}

interface RegisterView {
  can_write?: boolean;
  write_reason?: string | null;
  students: { student_id: string; roll_number: number }[];
}

test.describe('class teacher source', () => {
  test.use(loggedIn('teacher'));

  test('a teacher who is not the class teacher sees the banner and no Save', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    await setSource(request, admin, 'CLASS_TEACHER');
    try {
      // A section the teacher can open but may not save: found through the API, not hard-coded.
      const teacher = await apiSession(request, 'teacher');
      const mine = await get<{ section_id: string }[]>(request, teacher, '/attendance/my-sections');
      let blocked: string | undefined;
      for (const s of mine) {
        const view = await get<RegisterView>(
          request,
          teacher,
          `/attendance/sections/${s.section_id}/register?date=${DATE}`,
        );
        if (view.can_write === false) blocked = s.section_id;
      }
      test.skip(blocked === undefined, 'the seed has no section this teacher cannot save');

      await page.goto(`/attendance/${blocked}?date=${DATE}`);
      await expect(page.getByText(t('attendance.registerBanner.CLASS_TEACHER_ONLY'))).toBeVisible();
      await expect(
        page.getByRole('button', { name: t('attendance.mark.submitOnline') }),
      ).toHaveCount(0);
    } finally {
      await setSource(request, admin, 'ANY');
    }
  });
});

test.describe('device source', () => {
  test.use(loggedIn('admin'));

  test('a scanned student marked absent shows on the check-list and the register', async ({
    page,
    request,
  }) => {
    test.skip(isFridayAnywhere(), 'the school is closed on Friday');
    test.setTimeout(90_000);
    const admin = await adminApiSession(request);
    const chain = await createStudentsInSection(request, admin, 'Scan', 2);
    const register = await get<RegisterView>(
      request,
      admin,
      `/attendance/sections/${chain.sectionId}/register?date=${DATE}`,
    );
    const scanned = register.students[0]!.student_id;

    await setSource(request, admin, 'DEVICE');
    try {
      const device = await post<{ key: string }>(request, admin, '/attendance/devices', {
        name: `E2E scanner ${Date.now()}`,
        kind: 'RFID',
        roster_access: true,
      });
      const scan = await request.post('/api/v1/attendance/device-events', {
        headers: { 'X-Device-Key': device.key },
        data: {
          events: [
            {
              device_event_id: crypto.randomUUID(),
              student_id: scanned,
              occurred_at: new Date().toISOString(),
              direction: 'IN',
            },
          ],
        },
      });
      expect(scan.ok(), `scan failed: ${scan.status()}`).toBe(true);

      // The register marks the scanned student absent: the mismatch.
      await put(request, admin, `/attendance/sections/${chain.sectionId}/register`, {
        date: DATE,
        base_version: 0,
        client_request_id: crypto.randomUUID(),
        entries: [{ student_id: scanned, status: AttendanceStatus.ABSENT }],
      });

      await page.goto('/attendance');
      await expect(
        page.getByText(t('attendance.list.scannedAbsent_one', { count: 1 })).first(),
      ).toBeVisible();
    } finally {
      await setSource(request, admin, 'ANY');
    }
  });
});

test.describe('attendance machines', () => {
  test.use(loggedIn('admin'));

  test('add a machine, see the key once, revoke it', async ({ page }) => {
    const name = `E2E machine ${Date.now()}`;
    await page.goto('/settings?section=academics');

    await page
      .getByRole('button', { name: t('settings.attendanceDevices.add.button') })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: t('settings.attendanceDevices.add.title') });
    await dialog.getByLabel(t('settings.attendanceDevices.form.name')).fill(name);
    await dialog.getByRole('button', { name: t('settings.attendanceDevices.form.save') }).click();

    // The key is shown once; closing without copying asks first.
    const key = page.getByLabel(t('settings.attendanceDevices.key.label'));
    await expect(key).toHaveValue(/.+/);
    await page.getByRole('button', { name: t('settings.attendanceDevices.key.done') }).click();
    await expect(page.getByText(t('settings.attendanceDevices.key.confirmTitle'))).toBeVisible();
    await page
      .getByRole('button', { name: t('settings.attendanceDevices.key.confirmYes') })
      .click();
    await expect(page.getByText(name)).toBeVisible();

    // Revoke: the row leaves the list.
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: /.*/ }).last().click();
    await page
      .getByRole('menuitem', { name: t('settings.attendanceDevices.revoke.action') })
      .click();
    await page
      .getByRole('button', { name: t('settings.attendanceDevices.revoke.confirm') })
      .click();
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
