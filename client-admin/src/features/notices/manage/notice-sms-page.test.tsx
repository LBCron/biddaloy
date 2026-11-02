/** [53.6.01] SMS approval page: look, tick, approve, decline, double-click, non-approver. */
import { Toaster } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoticeSmsPage } from './notice-sms-page';

const ID = '11111111-1111-4111-8111-111111111111';
const ROW = '33333333-3333-4333-8333-333333333333';

const view = (over: Record<string, unknown> = {}) => ({
  status: 'PENDING',
  requester: 'Karim',
  requestedAt: '2026-10-09T05:00:00.000Z',
  live: true,
  items: [
    {
      id: ROW,
      guardianName: 'Rahim Uddin',
      forStudent: 'Sumi, 6 A',
      reachable: true,
      smsWanted: true,
      phone: '01•••••234',
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
  counts: { willSend: 1, optedOut: 0, noPhone: 0 },
  sms: {
    text: 'Exam routine https://x/n/…',
    length: 26,
    segments: 1,
    encoding: 'GSM_7',
    creditCost: 1,
  },
  ...over,
});

const err = (status: number, code?: string) =>
  new HttpResponse(
    JSON.stringify({
      statusCode: status,
      message: 'x',
      timestamp: new Date().toISOString(),
      path: '/x',
      requestId: 'r',
      ...(code ? { details: { code } } : {}),
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

function renderPage(onClose = () => undefined) {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <>
        <Toaster />
        <NoticeSmsPage noticeId={ID} onClose={onClose} />
      </>
    ),
  });
  return renderWithRouter(root.addChildren([index]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('NoticeSmsPage', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows people, text, counts and cost; unticking sends a PATCH', async () => {
    const user = userEvent.setup();
    let patch: unknown;
    server.use(
      http.get(`*/notices/${ID}/sms`, () => HttpResponse.json(view())),
      http.patch(`*/notices/${ID}/sms/recipients`, async ({ request }) => {
        patch = await request.json();
        return HttpResponse.json({ updated: 1 });
      }),
    );
    renderPage();

    expect(await screen.findByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText(/Exam routine https/)).toBeTruthy();
    expect(screen.getByText('SMS credits it will use')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Send an SMS to Rahim Uddin' }));
    await waitFor(() => expect(patch).toEqual({ ids: [ROW], smsWanted: false }));
  });

  it('Approve sends one POST with an Idempotency-Key and closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let key: string | null = null;
    server.use(
      http.get(`*/notices/${ID}/sms`, () => HttpResponse.json(view())),
      http.post(`*/notices/${ID}/sms/approve`, ({ request }) => {
        key = request.headers.get('idempotency-key');
        return HttpResponse.json({ status: 'APPROVED', queued: 1 });
      }),
    );
    renderPage(onClose);

    await screen.findByText('Rahim Uddin');
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(key).toBeTruthy();
  });

  it('Decline asks first and then posts decline', async () => {
    const user = userEvent.setup();
    let declined = 0;
    server.use(
      http.get(`*/notices/${ID}/sms`, () => HttpResponse.json(view())),
      http.post(`*/notices/${ID}/sms/decline`, () => {
        declined += 1;
        return HttpResponse.json({ status: 'DECLINED', queued: 0 });
      }),
    );
    renderPage();

    await screen.findByText('Rahim Uddin');
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(declined).toBe(0);
    await user.click(screen.getAllByRole('button', { name: 'Decline' }).at(-1)!);
    await waitFor(() => expect(declined).toBe(1));
  });

  it('a 409 NOTICE_SMS_NOT_PENDING on approve says it was already decided and stays open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    server.use(
      http.get(`*/notices/${ID}/sms`, () => HttpResponse.json(view())),
      http.post(`*/notices/${ID}/sms/approve`, () => err(409, 'NOTICE_SMS_NOT_PENDING')),
    );
    renderPage(onClose);

    await screen.findByText('Rahim Uddin');
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    expect(await screen.findByText('This request was already decided.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a 409 INSUFFICIENT_SMS_CREDIT says nothing was sent and the request still waits', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    server.use(
      http.get(`*/notices/${ID}/sms`, () => HttpResponse.json(view())),
      http.post(`*/notices/${ID}/sms/approve`, () => err(409, 'INSUFFICIENT_SMS_CREDIT')),
    );
    renderPage(onClose);

    await screen.findByText('Rahim Uddin');
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    // Not "already decided": the admin must know to top up, the request is still open.
    expect(
      await screen.findByText(
        'Not enough SMS credit. Nothing was sent, and the request is still waiting. Top up, then approve again.',
      ),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a 409 with no code (the same click still in flight) says to wait, not that someone decided', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/notices/${ID}/sms`, () => HttpResponse.json(view())),
      http.post(`*/notices/${ID}/sms/approve`, () => err(409)),
    );
    renderPage();

    await screen.findByText('Rahim Uddin');
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    expect(
      await screen.findByText(
        'Your earlier click is still being worked on. Wait a moment, then open the page again.',
      ),
    ).toBeTruthy();
  });

  it('a failed tick shows an error instead of quietly snapping back', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/notices/${ID}/sms`, () => HttpResponse.json(view())),
      http.patch(`*/notices/${ID}/sms/recipients`, () => err(500)),
    );
    renderPage();

    await screen.findByText('Rahim Uddin');
    await user.click(screen.getByRole('checkbox', { name: 'Send an SMS to Rahim Uddin' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('Approve waits while an untick is still on its way', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.use(
      http.get(`*/notices/${ID}/sms`, () => HttpResponse.json(view())),
      http.patch(`*/notices/${ID}/sms/recipients`, async () => {
        await held;
        return HttpResponse.json({ updated: 1 });
      }),
    );
    renderPage();

    await screen.findByText('Rahim Uddin');
    const approve = screen.getByRole('button', { name: 'Approve and send' });
    expect(approve.hasAttribute('disabled')).toBe(false);
    const box = screen.getByRole('checkbox', { name: 'Send an SMS to Rahim Uddin' });
    await user.click(box);
    // Approving now would still send to the person just unticked.
    await waitFor(() => expect(approve.hasAttribute('disabled')).toBe(true));
    // A second tick would race the first one: the box waits too.
    expect(box.hasAttribute('disabled')).toBe(true);
    release();
    await waitFor(() => expect(approve.hasAttribute('disabled')).toBe(false));
    await waitFor(() => expect(box.hasAttribute('disabled')).toBe(false));
  });

  it('the tick boxes wait while Approve is still on its way', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.use(
      http.get(`*/notices/${ID}/sms`, () => HttpResponse.json(view())),
      http.post(`*/notices/${ID}/sms/approve`, async () => {
        await held;
        return HttpResponse.json({ status: 'APPROVED', queued: 1 });
      }),
    );
    renderPage();

    await screen.findByText('Rahim Uddin');
    const box = screen.getByRole('checkbox', { name: 'Send an SMS to Rahim Uddin' });
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    // An untick now would race the approve and change who gets the SMS.
    await waitFor(() => expect(box.hasAttribute('disabled')).toBe(true));
    release();
  });

  it('a decided request is read only: no approve, decline or ticking', async () => {
    server.use(
      http.get(`*/notices/${ID}/sms`, () => HttpResponse.json(view({ status: 'APPROVED' }))),
    );
    renderPage();

    await screen.findByText('Rahim Uddin');
    expect(screen.getByText('This request is already decided. You can only read it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    expect(
      screen.getByRole('checkbox', { name: 'Send an SMS to Rahim Uddin' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('a non-approver (403) sees the no-access sentence and no buttons', async () => {
    server.use(http.get(`*/notices/${ID}/sms`, () => err(403)));
    renderPage();

    expect(await screen.findByText('Only an admin can look at the SMS request.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and send' })).toBeNull();
  });
});
