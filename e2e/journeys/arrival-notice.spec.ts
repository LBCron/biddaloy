import { type APIRequestContext } from '@playwright/test';

import {
  adminApiSession,
  createClassSection,
  createGuardian,
  createTeacher,
  currentAcademicYear,
  get,
  isFridayAnywhere,
  loginAsFreshUser,
  markableDateIso,
  post,
  put,
  type ApiSession,
} from '../api';
import { shells } from '../config';
import { expect, guest, test } from '../fixtures/test';
import { t } from '../i18n';
import { LoginPage } from '../pages/login-page';

/**
 * [84.4.4] Epic 84 close journey: the guardian asks, the class teacher answers in My class,
 * the teacher finalizes the register, and the arrival message is queued for the guardian.
 *
 * Own data, so no other spec can change it: a fresh section in the current year, one student,
 * one guardian with a portal account (batch invite + first sign-in with a code), and a fresh
 * class teacher. Nothing else finalizes this section's register, so the finalize below always
 * runs and the message check always checks.
 *
 * The school switch: the dev seed turns arrival notices on (`ensureArrivalNoticeSetting`) and no
 * spec turns them off, so this spec writes no settings and has nothing to restore.
 *
 * Why the last leg reads the communication history and not `/portal/notifications`: a PUSH
 * arrival notice goes to a browser push device (D44) and is never written to the alerts
 * worklist. The new guardian has no device (the log ends FAILED, NO_PUSH_DEVICE), so the push
 * log row is the observable proof that the notice was produced.
 */

interface InviteBatchStatus {
  batch_id: string;
  queued: number;
}

/** Bearer session for a fresh account, on its own request context (its own token family). */
async function freshApiSession(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<ApiSession> {
  const res = await request.post('/api/v1/auth/login', { data: { email, password } });
  expect(res.ok(), `login ${email}: ${res.status()}`).toBe(true);
  const body = (await res.json()) as {
    access_token: string;
    memberships: { tenantId: string }[];
  };
  return { token: body.access_token, tenantId: body.memberships[0]!.tenantId };
}

test.describe('arrival notice: guardian asks -> teacher answers -> register -> message', () => {
  test.use(guest);
  // Kept on purpose ([84 follow-up]): on a Friday there is no school-day register for "today", and
  // `ArrivalNoticeService` sends nothing for any other date (the text says "today", see its
  // "past date sends nothing" tests), so `markableDateIso()`'s Thursday fallback cannot work here.
  // Making the weekday irrelevant means changing the school's weekend in calendar settings,
  // which every other spec in the shared e2e school reads - so it is not done from this spec.
  test.skip(isFridayAnywhere(), 'the school is closed on Friday; no register to finalize');

  test('the whole story on a section of its own', async ({ browser, playwright, request }) => {
    test.setTimeout(180_000);
    const today = markableDateIso();
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const childName = `Arrival Child ${suffix}`;
    const phone = `019${suffix.slice(-8)}`;
    const admin = await adminApiSession(request);

    // --- setup: section, child, guardian with an account, class teacher -------------------
    // My class lists the current year only, so the section goes into that year.
    const chain = await createClassSection(
      request,
      admin,
      await currentAcademicYear(request, admin),
    );
    const guardian = await createGuardian(request, admin, `Arrival Guardian ${suffix}`, phone);
    const student = await post<{ id: string }>(request, admin, '/students', {
      full_name: childName,
      class_section_id: chain.sectionId,
      guardian_ids: [guardian.id],
    });
    const batch = await post<{ batch_id: string }>(request, admin, '/users/invitations/batch', {
      guardian_ids: [guardian.id],
    });
    // The processor links the guardian to a new passwordless PARENT account.
    await expect
      .poll(
        async () =>
          (
            await get<InviteBatchStatus>(
              request,
              admin,
              `/users/invitations/batch/${batch.batch_id}`,
            )
          ).queued,
        { timeout: 30_000, intervals: [500, 1000] },
      )
      .toBe(0);
    const teacherName = `Arrival Teacher ${suffix}`;
    const teacher = await createTeacher(request, admin, teacherName, chain);

    const settings = await get<{ attendance?: { arrivalNotice?: { enabled?: boolean } } }>(
      request,
      admin,
      `/schools/${admin.tenantId}/settings`,
    );
    expect(
      settings.attendance?.arrivalNotice?.enabled,
      'arrival notices are off for the e2e school - re-run `yarn seed` on a fresh database',
    ).toBe(true);

    const parentContext = await browser.newContext();
    const teacherApi = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    const teacherContext = await browser.newContext({
      storageState: await loginAsFreshUser(
        teacherApi,
        shells.app.baseURL,
        teacher.email,
        teacher.password,
      ),
    });
    try {
      await test.step('1. the guardian asks on the portal', async () => {
        const page = await parentContext.newPage();
        const login = new LoginPage(page);
        await login.goto();
        await page.getByRole('link', { name: t('auth.login.firstTime') }).click();
        await login.requestAndEnterOtp(phone);
        await page.getByRole('button', { name: t('auth.setPassword.skip') }).click();
        await expect(page).toHaveURL(/\/portal/);

        await page.goto('/portal/attendance');
        const sw = page.getByRole('switch', {
          name: t('portal.arrivalNotice.switchLabel', { name: childName }),
        });
        await expect(sw).not.toBeChecked();
        const asked = page.waitForResponse(
          (r) =>
            r.url().includes(`/portal/arrival-subscriptions/${student.id}`) &&
            r.request().method() === 'PUT',
        );
        await sw.click();
        expect((await asked).ok()).toBe(true);
        await expect(sw).toBeChecked();
        await expect(page.getByText(t('portal.arrivalNotice.status.waiting'))).toBeVisible();
      });

      await test.step('2. the class teacher answers "every school day" in My class', async () => {
        const page = await teacherContext.newPage();
        await page.goto(`/my-class/${chain.sectionId}`);
        const card = page.getByRole('region', { name: t('myClass.cards.arrival') });
        await expect(card).toBeVisible();
        await expect(card.getByText(childName)).toBeVisible();
        const answered = page.waitForResponse(
          (r) =>
            r.url().includes('/attendance/arrival-subscriptions/') &&
            r.request().method() === 'PATCH',
        );
        // The only waiting request in this section is this child's.
        await card.getByRole('button', { name: t('myClass.arrival.everyDay') }).click();
        expect((await answered).ok()).toBe(true);
        await expect(card.getByRole('button', { name: t('myClass.arrival.everyDay') })).toHaveCount(
          0,
        );
      });

      await test.step('3. the teacher finalizes the register with the child present', async () => {
        const session = await freshApiSession(teacherApi, teacher.email, teacher.password);
        const register = await get<{
          session: { version: number; state: string };
          students: { student_id: string }[];
        }>(teacherApi, session, `/attendance/sections/${chain.sectionId}/register?date=${today}`);
        // Nothing else knows this section, so today's register cannot be finalized yet.
        expect(register.session.state).not.toBe('FINALIZED');
        const saved = await put<{ session: { state: string } }>(
          teacherApi,
          session,
          `/attendance/sections/${chain.sectionId}/register`,
          {
            date: today,
            base_version: register.session.version,
            client_request_id: crypto.randomUUID(),
            finalize: true,
            entries: register.students.map((s) => ({
              student_id: s.student_id,
              status: 'PRESENT',
            })),
          },
        );
        expect(saved.session.state).toBe('FINALIZED');
      });

      await test.step("4. the child's communication history holds the arrival notice", async () => {
        // The finalize queues the notice after its commit and does not wait for it (D26).
        await expect
          .poll(
            async () => {
              const logs = await get<{ medium: string; recipient_address: string }[]>(
                request,
                admin,
                `/communications/student/${student.id}`,
              );
              // Nothing else messages this new child, so a PUSH log to a push: address is the
              // notice. The history route never returns the body (it is not in the response DTO),
              // so the wording and the two names are asserted in the server unit tests
              // (ARRIVAL_TEMPLATES), not here.
              return logs.some(
                (l) => l.medium === 'PUSH' && l.recipient_address.startsWith('push:'),
              );
            },
            { timeout: 15_000, intervals: [500, 1000] },
          )
          .toBe(true);
      });
    } finally {
      await parentContext.close();
      await teacherContext.close();
      await teacherApi.dispose();
    }
  });
});
