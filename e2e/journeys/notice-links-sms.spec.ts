import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';

import {
  adminApiSession,
  createClassSection,
  createGuardian,
  get,
  post,
  type ApiSession,
} from '../api';
import { shells } from '../config';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [53.6.04 / #3390] Epic 53 close journey for the link and SMS paths (D12, D24, D31).
 *
 * Case 1: a public notice opens at `/n/<token>` with no login; after the admin turns the link
 * off, the same address shows the one dead-link message.
 * Case 2: OFFICE_STAFF asks for an SMS; the admin sees it on the SMS page, unticks one person,
 * approves, and the message log holds n-1 SMS (the sink: `MESSAGE_SINK`, nothing leaves the
 * machine). The log shows each personal link masked as `/n/••••••`, never the token.
 * Case 3: OFFICE_STAFF has no access to the SMS page (read-only guard, 403 from the API).
 *
 * Data is built through the API with a unique suffix so no other spec can change it. The three
 * writes (publish, approve) carry no double-click check here: approve is in the double-submit
 * registry (`notice sms approve`).
 */

const bearer = (s: ApiSession) => ({
  Authorization: `Bearer ${s.token}`,
  'X-Tenant-ID': s.tenantId,
});

interface SmsView {
  items: { id: string; guardianName: string; forStudent: string | null; reachable: boolean }[];
  counts: { willSend: number };
}

async function guardiansInSection(
  request: APIRequestContext,
  admin: ApiSession,
  sectionId: string,
  names: string[],
  phones: string[],
) {
  const out: { guardianId: string; studentId: string }[] = [];
  for (const [i, name] of names.entries()) {
    const g = await createGuardian(request, admin, name, phones[i]!);
    const s = await post<{ id: string }>(request, admin, '/students', {
      full_name: `Student of ${name}`,
      class_section_id: sectionId,
      guardian_ids: [g.id],
    });
    out.push({ guardianId: g.id, studentId: s.id });
  }
  return out;
}

async function publishNotice(
  request: APIRequestContext,
  s: ApiSession,
  title: string,
  people: { guardianId: string; studentId: string }[],
  opts: { isPublic?: boolean; requestSms?: boolean },
) {
  const n = await post<{ id: string }>(request, s, '/notices', {
    title,
    body: `Body of ${title}`,
    isPublic: opts.isPublic ?? false,
  });
  await post(request, s, `/notices/${n.id}/recipients`, {
    items: people.map((p) => ({
      kind: 'GUARDIAN',
      guardianId: p.guardianId,
      studentId: p.studentId,
    })),
  });
  await post(request, s, `/notices/${n.id}/publish`, { requestSms: opts.requestSms ?? false });
  return n.id;
}

test.describe('notice links and SMS', () => {
  test.use(loggedIn('admin'));
  test.setTimeout(180_000);

  test('a public link opens with no login, and turning it off gives the dead page', async ({
    page,
    request,
    browser,
  }) => {
    const admin = await adminApiSession(request);
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const chain = await createClassSection(request, admin);
    const people = await guardiansInSection(
      request,
      admin,
      chain.sectionId,
      [`PubG ${suffix}`],
      [`017${suffix.slice(-8)}`],
    );
    const title = `Public notice ${suffix}`;
    const id = await publishNotice(request, admin, title, people, { isPublic: true });
    const { token } = await post<{ token: string }>(
      request,
      admin,
      `/notices/${id}/public-link`,
      {},
    );

    // A fresh context carries no cookies and no stored tenant: an anonymous reader.
    const anon = await browser.newContext();
    try {
      const reader = await anon.newPage();
      await reader.goto(`/n/${token}`);
      await expect(reader.getByRole('heading', { name: title })).toBeVisible();
      await expect(reader.getByText(`Body of ${title}`)).toBeVisible();

      // Admin turns the link off on the real notice page.
      await page.goto(`/communications/notices/${id}`);
      await page.getByRole('button', { name: t('notices.manage.link.off') }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: t('notices.manage.link.off') })
        .click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(page.getByText(t('notices.manage.link.offDone'))).toBeVisible();

      await reader.goto(`/n/${token}`);
      await expect(reader.getByText(t('notices.public.notFoundTitle'))).toBeVisible();
      // Rule 23: the dead page never repeats the token.
      expect(await reader.content()).not.toContain(token);
    } finally {
      await anon.close();
    }
  });

  test('office staff asks for an SMS, the admin approves n-1, the log hides personal links', async ({
    page,
    request,
    playwright,
  }) => {
    const admin = await adminApiSession(request);
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const chain = await createClassSection(request, admin);
    const base = `NSMS${suffix}`;
    const names = [`${base} One`, `${base} Two`, `${base} Three`];
    const people = await guardiansInSection(
      request,
      admin,
      chain.sectionId,
      names,
      names.map((_, i) => `016${suffix.slice(-7)}${i}`),
    );

    // OFFICE_STAFF writes and publishes with an SMS request: nothing is sent yet.
    const office = await officeSession(playwright);
    const title = `SMS notice ${suffix}`;
    const id = await publishNotice(request, office, title, people, { requestSms: true });

    const logs = async () =>
      get<{ data: { message_body: string | null }[]; total: number }>(
        request,
        admin,
        `/communications/logs?search=${encodeURIComponent(base)}&medium=SMS&limit=100`,
      );
    expect((await logs()).total).toBe(0);

    // The office user is refused on the SMS routes (D24: approval is not theirs).
    const denied = await request.get(`/api/v1/notices/${id}/sms`, { headers: bearer(office) });
    expect(denied.status()).toBe(403);

    await test.step('admin sees the request, unticks one person, approves', async () => {
      await page.goto(`/communications/notices/${id}`);
      await page.getByRole('button', { name: t('notices.manage.sms.review') }).click();
      await expect(page.getByText(t('notices.manage.sms.pageTitle'))).toBeVisible();
      const view = await get<SmsView>(request, admin, `/notices/${id}/sms`);
      expect(view.counts.willSend).toBe(3);
      const first = view.items[0]!;
      await page
        .getByRole('checkbox', {
          name: first.forStudent
            ? t('notices.manage.sms.sendToFor', {
                name: first.guardianName,
                student: first.forStudent,
              })
            : t('notices.manage.sms.sendTo', { name: first.guardianName }),
        })
        .click();
      await expect
        .poll(
          async () => (await get<SmsView>(request, admin, `/notices/${id}/sms`)).counts.willSend,
        )
        .toBe(2);
      const approved = page.waitForResponse(
        (r) => r.url().endsWith(`/notices/${id}/sms/approve`) && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: t('notices.manage.sms.approve') }).click();
      expect((await approved).ok()).toBe(true);
    });

    // n - 1 = 2 SMS logs reach the sink, one per ticked person.
    await expect.poll(async () => (await logs()).total, { timeout: 30_000 }).toBe(2);

    await test.step('the message log never shows a personal link', async () => {
      // The link opens the notice with no login and marks that guardian seen, so a log reader
      // must not be able to copy it (opening it is covered by notice-links.service.integration.spec.ts).
      for (const row of (await logs()).data) {
        expect(row.message_body ?? '').toMatch(/\/n\/••••••$/);
      }
    });
  });
});

/** Office staff session: the seeded login, in its own request context (own cookies). */
async function officeSession(playwright: PlaywrightWorkerArgs['playwright']): Promise<ApiSession> {
  const ctx = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    const res = await ctx.post('/api/v1/auth/login', {
      data: { email: SEED_ROLE_EMAILS.office_staff, password: process.env[SEED_PASSWORD_ENV] },
    });
    if (!res.ok()) throw new Error(`office login failed: ${res.status()}`);
    const body = (await res.json()) as {
      access_token: string;
      memberships: { tenantId: string; role: string }[];
    };
    const m = body.memberships.find((x) => x.role === 'OFFICE_STAFF');
    if (!m) throw new Error('no OFFICE_STAFF membership');
    return { token: body.access_token, tenantId: m.tenantId };
  } finally {
    await ctx.dispose();
  }
}
