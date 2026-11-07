import { AttendanceStatus } from '@biddaloy/shared';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import {
  createOfferedSubject,
  createStudentsInSection,
  createTeacher,
  del,
  get,
  isFridayAnywhere,
  loginAsFreshUser,
  markableDateIso,
  post,
  put,
  type ApiSession,
  type ClassSectionChain,
} from '../api';
import { shells } from '../config';
import { newSchool, type NewSchool } from '../fixtures/new-school';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [76.5.08] Who saves the daily register (Epic 76 D1, D5, D10, D23), end to end:
 *  1. CLASS_TEACHER source: a subject teacher of a section (not its class teacher) sees the
 *     banner and no Save.
 *  2. DEVICE source: a student the machine saw but the register marks absent shows
 *     on the check-list.
 *  3. Settings > Attendance machines: add a machine, see the key once, revoke it.
 *
 * Tests 1 and 2 switch `attendance.dailySource`, a school-wide setting. Each runs in a school of
 * its own (`newSchool`), so a spec on another worker that saves a seeded register never meets
 * the switched setting, and the device-absent sweep can only reach that throwaway school.
 */

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

/** One section of `count` students in a new current academic year of `school`. My sections,
 * the check-list and a teacher's scope list current-year sections only. */
async function currentYearSection(
  school: NewSchool,
  namePrefix: string,
  count: number,
): Promise<ClassSectionChain> {
  const yearOf = DATE.slice(0, 4);
  const bounds = { start_date: `${yearOf}-01-01`, end_date: `${yearOf}-12-31` };
  const year = await post<{ id: string }>(school.api, school.session, '/academic-years', {
    name: `E2E Year ${Date.now()}`,
    ...bounds,
    is_current: true,
  });
  return createStudentsInSection(school.api, school.session, namePrefix, count, {
    id: year.id,
    ...bounds,
  });
}

interface RegisterView {
  session: { version: number };
  students: { student_id: string; roll_number: number }[];
}

test.describe('class teacher source', () => {
  test.use(guest);

  test('a subject teacher sees the banner and no Save', async ({ browser, playwright }) => {
    test.setTimeout(120_000);
    const school = await newSchool(browser, playwright);
    const teacherApi = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    let teacherContext: BrowserContext | undefined;
    try {
      const { api, session } = school;
      const chain = await currentYearSection(school, 'Source', 1);
      const subject = await createOfferedSubject(api, session, chain, 'E2E Source Subject');
      const teacher = await createTeacher(api, session, `E2E Subject Teacher ${Date.now()}`);
      // A subject teacher may open the section, but under CLASS_TEACHER may not save its day register.
      await post(api, session, `/classes/${chain.classId}/sections/${chain.sectionId}/teachers`, {
        teacher_id: teacher.teacherId,
        subject_id: subject.id,
      });
      await setSource(api, session, 'CLASS_TEACHER');

      teacherContext = await browser.newContext({
        storageState: await loginAsFreshUser(
          teacherApi,
          shells.app.baseURL,
          teacher.email,
          teacher.password,
        ),
      });
      const page = await teacherContext.newPage();
      await page.goto(`/attendance/${chain.sectionId}?date=${DATE}`);
      await expect(page.getByText(t('attendance.registerBanner.CLASS_TEACHER_ONLY'))).toBeVisible();
      await expect(
        page.getByRole('button', { name: t('attendance.mark.submitOnline') }),
      ).toHaveCount(0);
    } finally {
      await teacherContext?.close();
      await teacherApi.dispose();
      await school.context.close();
      await school.api.dispose();
    }
  });
});

test.describe('device source', () => {
  test.use(guest);

  test('a scanned student marked absent shows on the check-list', async ({
    browser,
    playwright,
  }) => {
    test.skip(isFridayAnywhere(), 'the school is closed on Friday');
    test.setTimeout(120_000);
    const school = await newSchool(browser, playwright);
    const { api, session, page } = school;
    let deviceId: string | undefined;
    try {
      const chain = await currentYearSection(school, 'Scan', 2);
      const path = `/attendance/sections/${chain.sectionId}/register`;
      const before = await get<RegisterView>(api, session, `${path}?date=${DATE}`);
      const scanned = before.students[0]!.student_id;

      await setSource(api, session, 'DEVICE');
      const device = await post<{ device: { id: string }; key: string }>(
        api,
        session,
        '/attendance/devices',
        { name: `E2E scanner ${Date.now()}`, kind: 'RFID', roster_access: true },
      );
      deviceId = device.device.id;
      const scan = await api.post('/api/v1/attendance/device-events', {
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

      // The scan opened today's register and bumped its version: send the version it has now.
      const afterScan = await get<RegisterView>(api, session, `${path}?date=${DATE}`);
      // The register marks the scanned student absent: the mismatch.
      await put(api, session, path, {
        date: DATE,
        base_version: afterScan.session.version,
        client_request_id: crypto.randomUUID(),
        entries: [{ student_id: scanned, status: AttendanceStatus.ABSENT }],
      });

      await page.goto('/attendance');
      await expect(
        page.getByText(t('attendance.list.scannedAbsent_one', { count: 1 })).first(),
      ).toBeVisible();
    } finally {
      if (deviceId) await del(api, session, `/attendance/devices/${deviceId}`);
      await school.context.close();
      await school.api.dispose();
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
    // exact: 'নাম' (name) is also a substring of the roster switch's label ('নামাতে').
    await dialog.getByLabel(t('settings.attendanceDevices.form.name'), { exact: true }).fill(name);
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

    // Revoke: the machine leaves the list. Each machine is a list item with its own buttons.
    const item = page.getByRole('listitem').filter({ hasText: name });
    await item
      .getByRole('button', { name: t('settings.attendanceDevices.revoke.action'), exact: true })
      .click();
    await page
      .getByRole('button', { name: t('settings.attendanceDevices.revoke.confirm'), exact: true })
      .click();
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
