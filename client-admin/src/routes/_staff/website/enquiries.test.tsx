import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server, userEvent } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { baseSite, mockWebsite } from './-test-handlers';

const contactDraft = (on: boolean) => ({
  theme: 'BASIC',
  palette: 'green',
  pages: [
    {
      page: 'contact',
      enabled: true,
      sections: [{ key: 'contact', enabled: true, data: { enquirySmsToOffice: on, phone: '017' } }],
    },
  ],
});

const items = [
  {
    id: 'e1',
    name: 'Rahim',
    phone: '01712345678',
    message: 'Is admission open?',
    seen_at: null,
    created_at: '2026-11-03T06:00:00.000Z',
  },
  {
    id: 'e2',
    name: 'Karim',
    phone: '01812345678',
    message: 'Thanks',
    seen_at: '2026-11-03T07:00:00.000Z',
    created_at: '2026-11-02T06:00:00.000Z',
  },
];

/** Registers the enquiry routes; returns the order write calls arrive in. */
function mockEnquiries(list = items, smsOn = false) {
  const calls: string[] = [];
  let site = { ...baseSite, draft: contactDraft(smsOn) as never };
  mockWebsite({ draft: contactDraft(smsOn) as never });
  server.use(
    http.get('/api/v1/website/enquiries', () =>
      HttpResponse.json({ items: list, total: list.length, unseen: 1 }),
    ),
    http.post('/api/v1/website/enquiries/:id/seen', ({ params }) => {
      calls.push(`seen:${String(params.id)}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/v1/website/enquiries/:id', ({ params }) => {
      calls.push(`delete:${String(params.id)}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('/api/v1/website', () => HttpResponse.json(site)),
    http.put('/api/v1/website/draft', async ({ request }) => {
      const b = (await request.json()) as {
        config: { pages: { sections: { data: { enquirySmsToOffice: boolean } }[] }[] };
        draft_revision: number;
      };
      calls.push(
        `sms:${b.config.pages[0]!.sections[0]!.data.enquirySmsToOffice}:${b.draft_revision}`,
      );
      // Keep the saved draft, so the refetch and the response both show the switch on.
      site = { ...site, draft: b.config as never, draft_revision: b.draft_revision + 1 };
      return HttpResponse.json(site);
    }),
  );
  return calls;
}

const render = (role: UserRole = UserRole.ADMIN) =>
  renderWithRouter(routeTree, {
    initialEntries: ['/website/enquiries'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

describe('/website/enquiries', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists messages with a call link, and an unseen row is bold', async () => {
    mockEnquiries();
    render();
    const link = await screen.findByRole('link', { name: 'Call Rahim' });
    expect(link.getAttribute('href')).toBe('tel:01712345678');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Rahim').className).toContain('font-semibold');
    expect(screen.getByText('Karim').className).not.toContain('font-semibold');
  });

  it('ticking Seen calls the API, and a seen row cannot be unticked', async () => {
    const calls = mockEnquiries();
    render();
    const unseen = await screen.findByRole('switch', { name: 'Mark Rahim as seen' });
    expect(
      screen.getByRole<HTMLButtonElement>('switch', { name: 'Mark Karim as seen' }).disabled,
    ).toBe(true);
    await userEvent.click(unseen);
    await waitFor(() => expect(calls).toEqual(['seen:e1']));
  });

  it('asks before deleting a message', async () => {
    const calls = mockEnquiries();
    render();
    await screen.findByText('Rahim');
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    expect(await screen.findByText('Delete this message?')).toBeTruthy();
    expect(calls).toEqual([]);
    const buttons = screen.getAllByRole('button', { name: 'Delete' });
    await userEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(calls).toEqual(['delete:e1']));
  });

  it('shows the empty state', async () => {
    mockEnquiries([]);
    render();
    expect(await screen.findByText('No one has written yet')).toBeTruthy();
  });

  it('saves the office SMS switch into the draft', async () => {
    const calls = mockEnquiries();
    render();
    const sms = await screen.findByRole('switch', {
      name: /Send an SMS to the office phone/,
    });
    await waitFor(() => expect((sms as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(sms);
    await waitFor(() => expect(calls).toEqual(['sms:true:3']));
    // The saved draft is kept, so the switch stays on and usable after the refetch.
    await waitFor(() => expect(sms.getAttribute('aria-checked')).toBe('true'));
    expect((sms as HTMLButtonElement).disabled).toBe(false);
  });
});
