/**
 * [87.SD] / [97.4.02] `/communications/message-log` — filters in the URL, row detail, Check
 * status. Real route tree, MSW-backed (D10: no vendor stub, the API layer is the seam).
 */
import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const GUARDIAN = '22222222-2222-4222-8222-222222222222';
const SENDER = '33333333-3333-4333-8333-333333333333';
const BATCH = '44444444-4444-4444-8444-444444444444';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'log-1',
  medium: 'SMS',
  recipient_address: '01712345678',
  recipient_name: 'Karim Uddin',
  status: 'SENT',
  trigger: 'MANUAL',
  student_id: 's-1',
  guardian_id: 'g-1',
  provider_message_id: 'vendor-1',
  provider: 'onecodesoft',
  error: null,
  created_at: '2026-10-20T09:00:00.000Z',
  message_body: 'Your dues are 500 taka.' as string | null,
  body_withheld: false,
  subject: null,
  segments: 2,
  batch_id: BATCH,
  is_test: true,
  sent_by_user_id: SENDER,
  sent_by_name: 'Rahima Akter',
  can_check_status: true,
  ...over,
});
type Row = ReturnType<typeof row>;

const page = (data: unknown[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 25,
  totalPages: data.length ? 1 : 0,
});

const filterOptions = {
  companies: [
    { name: 'onecodesoft', medium: 'SMS', label: { en: 'OneCodeSoft', bn: 'ওয়ানকোডসফট' } },
    { name: 'greenweb', medium: 'SMS', label: { en: 'Greenweb', bn: 'গ্রিনওয়েব' } },
  ],
  senders: [{ id: SENDER, full_name: 'Rahima Akter' }],
};

function mockLogs(data: unknown[], onQuery?: (q: URLSearchParams) => void) {
  server.use(
    http.get('/api/v1/communications/logs', ({ request }) => {
      onQuery?.(new URL(request.url).searchParams);
      return HttpResponse.json(page(data));
    }),
    http.get('/api/v1/communications/logs/filter-options', () => HttpResponse.json(filterOptions)),
  );
}

function render(path: string, role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

async function openDetail() {
  const [button] = await screen.findAllByRole('button', { name: 'View message' });
  fireEvent.click(button!);
  return await screen.findByRole('dialog');
}

/** The value shown under one label of the row detail. */
function detailValue(dialog: HTMLElement, label: string) {
  const dt = within(dialog)
    .getAllByText(label)
    .find((el) => el.tagName === 'DT');
  return dt?.nextElementSibling as HTMLElement;
}

const apiError = (status: number, message: string) =>
  HttpResponse.json(
    { statusCode: status, message, requestId: 'r-1', path: '/', timestamp: '2026-10-31T00:00:00Z' },
    { status },
  );

describe('/communications/message-log', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('passes every URL filter to the API and lists the failed message with its reason', async () => {
    let query: URLSearchParams | null = null;
    mockLogs([row({ status: 'FAILED', error: 'NO_PROVIDER', provider_message_id: null })], (q) => {
      query = q;
    });
    render(
      `/communications/message-log?medium=SMS&status=FAILED&search=Karim&trigger=MANUAL&sent_by=${SENDER}&provider=greenweb&from_date=2026-10-01&to_date=2026-10-31`,
    );

    expect(await screen.findByText('Karim Uddin')).toBeTruthy();
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(query?.get('status')).toBe('FAILED');
      expect(query?.get('medium')).toBe('SMS');
      expect(query?.get('search')).toBe('Karim');
      expect(query?.get('trigger')).toBe('MANUAL');
      expect(query?.get('sent_by')).toBe(SENDER);
      expect(query?.get('provider')).toBe('greenweb');
      expect(query?.get('from_date')).toBe('2026-10-01');
      expect(query?.get('to_date')).toBe('2026-10-31');
    });
  });

  it('drops hand-edited values the API would refuse, so the list still loads', async () => {
    let query = null as URLSearchParams | null;
    mockLogs([row()], (q) => {
      query = q;
    });
    render(
      `/communications/message-log?search=${'x'.repeat(101)}&sent_by=u-1&provider=${'p'.repeat(41)}&from_date=yesterday&to_date=2026-02-31&student=nope`,
    );

    expect(await screen.findByText('Karim Uddin')).toBeTruthy();
    expect(query?.has('search')).toBe(false);
    expect(query?.has('sent_by')).toBe(false);
    expect(query?.has('provider')).toBe(false);
    expect(query?.has('from_date')).toBe(false);
    // The right shape but no such day: the DTO's IsRealDate would 400 on it.
    expect(query?.has('to_date')).toBe(false);
    expect(query?.has('student_id')).toBe(false);
  });

  it('typing in Search writes it to the URL and asks the API with it', async () => {
    const user = userEvent.setup();
    const searches: (string | null)[] = [];
    mockLogs([row()], (q) => searches.push(q.get('search')));
    const { router } = render('/communications/message-log');

    const box = await screen.findByRole('textbox', { name: 'Search' });
    await user.type(box, 'Karim');

    await waitFor(() => expect(router.state.location.search).toMatchObject({ search: 'Karim' }));
    await waitFor(() => expect(searches).toContain('Karim'));
  });

  it('shows the plain empty state, without telling to change filters nobody set', async () => {
    mockLogs([]);
    render('/communications/message-log');
    expect(await screen.findByText('No messages found.')).toBeTruthy();
    expect(screen.getByText('The school has not sent a message yet.')).toBeTruthy();
  });

  it('says no message matches when a filter is on', async () => {
    mockLogs([]);
    render('/communications/message-log?status=FAILED');
    expect(await screen.findByText('No messages match these filters')).toBeTruthy();
  });

  it('shows an error line when the log cannot load', async () => {
    server.use(
      http.get('/api/v1/communications/logs', () => apiError(400, 'bad')),
      http.get('/api/v1/communications/logs/filter-options', () =>
        HttpResponse.json(filterOptions),
      ),
    );
    render('/communications/message-log');
    expect(await screen.findByText('Could not load the message log.')).toBeTruthy();
  });

  it('row detail renders every field', async () => {
    mockLogs([row()]);
    render('/communications/message-log');
    const dialog = await openDetail();
    const value = (label: string) => detailValue(dialog, label).textContent;

    expect(value('Recipient')).toBe('Karim Uddin');
    expect(value('Mobile or email')).toContain('01712');
    expect(value('Channel')).toBe('SMS');
    expect(value('Status')).toContain('Sent');
    expect(value('Status')).toContain('Test');
    expect(value('Kind')).toBe('Sent by staff');
    expect(value('Sent by')).toBe('Rahima Akter');
    expect(value('Sent')).not.toBe('—');
    expect(value('Company')).toBe('OneCodeSoft');
    expect(value("Company's message ID")).toBe('vendor-1');
    expect(value('SMS parts')).toBe('2');
    expect(value('Why it failed')).toBe('—');
    expect(value('Message')).toBe('Your dues are 500 taka.');
    const round = within(detailValue(dialog, 'Reminder round')).getByRole('link', {
      name: 'Open the round',
    });
    expect(round.getAttribute('href')).toContain(BATCH);
    // No subject on an SMS: the row is left out, not shown empty.
    expect(within(dialog).queryByText('Subject')).toBe(null);
  });

  it('row detail shows a dash for each value the row does not have', async () => {
    mockLogs([
      row({
        trigger: 'AUTOMATED',
        sent_by_user_id: null,
        sent_by_name: null,
        provider: null,
        provider_message_id: null,
        segments: null,
        batch_id: null,
        is_test: false,
        status: 'FAILED',
        error: 'NO_PROVIDER',
        can_check_status: false,
      }),
    ]);
    render('/communications/message-log');
    const dialog = await openDetail();
    const value = (label: string) => detailValue(dialog, label).textContent;

    expect(value('Sent by')).toBe('—');
    expect(value('Company')).toBe('—');
    expect(value("Company's message ID")).toBe('—');
    expect(value('SMS parts')).toBe('—');
    expect(value('Reminder round')).toBe('—');
    expect(value('Status')).not.toContain('Test');
    expect(value('Why it failed')).not.toBe('—');
  });

  // The server decides with `can_check_status` (D23); the page never guesses from other fields.
  const checkCases: [string, Partial<Row>, boolean][] = [
    ['the server says it can', {}, true],
    ['the server says it cannot (SENT row, company id)', { can_check_status: false }, false],
    ['a DELIVERED row', { status: 'DELIVERED', can_check_status: false }, false],
  ];
  it.each(checkCases)('Check status button, %s', async (_name, over, shown) => {
    mockLogs([row(over)]);
    render('/communications/message-log');
    const dialog = await openDetail();
    expect(!!within(dialog).queryByRole('button', { name: 'Check status' })).toBe(shown);
  });

  // [#3351 r2] The server holds an exam result back from a role without RESULT_READ.
  it('row detail says the message is not shown when the server withheld it', async () => {
    mockLogs([row({ trigger: 'RESULT_SMS', message_body: null, body_withheld: true })]);
    render('/communications/message-log', 'ACCOUNTANT');
    const dialog = await openDetail();
    expect(detailValue(dialog, 'Message').textContent).toBe(
      'Not shown: only staff who can see exam results can read this message.',
    );
  });

  it('when the filter choices fail the list still loads, without Sent by or Company', async () => {
    server.use(
      http.get('/api/v1/communications/logs', () => HttpResponse.json(page([row()]))),
      http.get('/api/v1/communications/logs/filter-options', () => apiError(500, 'boom')),
    );
    render('/communications/message-log');

    expect(await screen.findByText('Karim Uddin')).toBeTruthy();
    // No labels: the Company column shows the company's own name.
    expect(screen.getAllByText('onecodesoft').length).toBeGreaterThan(0);
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Sent by' })).toBe(null);
    expect(screen.queryByRole('combobox', { name: 'Company' })).toBe(null);
  });

  it('a shared link with a sender outside the choices still shows that sender', async () => {
    const OTHER = '55555555-5555-4555-8555-555555555555';
    mockLogs([row({ sent_by_user_id: OTHER, sent_by_name: 'Jamal Hossain' })]);
    render(`/communications/message-log?sent_by=${OTHER}`);

    expect(await screen.findByText('Karim Uddin')).toBeTruthy();
    const select = await screen.findByRole('combobox', { name: 'Sent by' });
    expect(await within(select).findByText('Jamal Hossain')).toBeTruthy();
  });

  it('Office staff: the Company and Sent-by filters come from the log, no 403 request is made', async () => {
    const forbidden: string[] = [];
    mockLogs([row()]);
    server.use(
      http.get(/\/api\/v1\/schools\/[^/]+\/settings\/messaging\/providers$/, ({ request }) => {
        forbidden.push(request.url);
        return apiError(403, 'Forbidden');
      }),
      http.get('/api/v1/users', ({ request }) => {
        forbidden.push(request.url);
        return apiError(403, 'Forbidden');
      }),
    );
    render('/communications/message-log', 'OFFICE_STAFF');

    expect(await screen.findByText('Karim Uddin')).toBeTruthy();
    const dialog = await openDetail();
    // The company label comes from the log's own list, readable by this role.
    expect(await within(dialog).findByText('OneCodeSoft')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Check status' })).toBeTruthy();
    expect(forbidden).toEqual([]);
  });

  it('a fast double click on Check status sends ONE request, with an Idempotency-Key', async () => {
    // The list answers what the server holds: DELIVERED once the check has run.
    let current = row();
    server.use(
      http.get('/api/v1/communications/logs', () => HttpResponse.json(page([current]))),
      http.get('/api/v1/communications/logs/filter-options', () =>
        HttpResponse.json(filterOptions),
      ),
    );
    vi.spyOn(toast, 'success').mockImplementation(() => '');
    const keys: (string | null)[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/v1/communications/logs/log-1/check-status', async ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        await gate;
        current = row({ status: 'DELIVERED', can_check_status: false });
        return HttpResponse.json(current);
      }),
    );
    render('/communications/message-log');
    const dialog = await openDetail();
    const button = await within(dialog).findByRole('button', { name: 'Check status' });
    fireEvent.click(button);
    fireEvent.click(button);
    release();

    await waitFor(() => expect(within(dialog).queryByRole('button', { name: /Check/ })).toBe(null));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBeTruthy();
    // Updated in place: the dialog now says Delivered.
    expect(detailValue(screen.getByRole('dialog'), 'Status').textContent).toContain('Delivered');
  });

  it('after a successful check the next click carries a new key; after a 502 the retry reuses it', async () => {
    mockLogs([row()]);
    vi.spyOn(toast, 'success').mockImplementation(() => '');
    vi.spyOn(toast, 'error').mockImplementation(() => '');
    const keys: (string | null)[] = [];
    const answers = [
      () => HttpResponse.json(row()), // still SENT, can be asked again
      () => apiError(502, 'Could not get the delivery status. Try again in a minute.'),
      () => HttpResponse.json(row()),
    ];
    server.use(
      http.post('/api/v1/communications/logs/log-1/check-status', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return answers[keys.length - 1]!();
      }),
    );
    render('/communications/message-log');
    const dialog = await openDetail();
    for (let i = 1; i <= 3; i += 1) {
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Check status' }));
      await waitFor(() => expect(keys).toHaveLength(i));
      await within(dialog).findByRole('button', { name: 'Check status' });
    }

    expect(keys[1]).not.toBe(keys[0]); // rotated after the success
    expect(keys[2]).toBe(keys[1]); // the 502 freed the key, the retry really runs
  });

  const errorCases: [number, string, string][] = [
    [
      409,
      'The delivery status of this message cannot be checked now.',
      'The delivery status of this message cannot be checked now.',
    ],
    [502, 'Server English text', 'Could not check the status. Try again in a minute.'],
  ];
  it.each(errorCases)(
    'Check status %s shows our translated sentence once, never the server text, with no retry',
    async (status, serverText, shown) => {
      mockLogs([row()]);
      const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
      let calls = 0;
      server.use(
        http.post('/api/v1/communications/logs/log-1/check-status', () => {
          calls += 1;
          return apiError(status, serverText);
        }),
      );
      render('/communications/message-log');
      const dialog = await openDetail();
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Check status' }));
      await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(shown));
      expect(toastSpy).toHaveBeenCalledTimes(1);
      if (serverText !== shown) expect(toastSpy).not.toHaveBeenCalledWith(serverText);
      expect(calls).toBe(1);
      // Still SENT: the button stays for another try.
      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Check status' }),
      ).toBeTruthy();
    },
  );

  it('Check status in Bangla shows the Bangla sentence for a 409', async () => {
    mockLogs([row()]);
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    server.use(
      http.post('/api/v1/communications/logs/log-1/check-status', () =>
        apiError(409, 'The delivery status of this message cannot be checked now.'),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/communications/message-log'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'bn',
    });
    const [view] = await screen.findAllByRole('button', { name: 'বার্তা দেখুন' });
    fireEvent.click(view!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'অবস্থা যাচাই করুন' }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith('এই বার্তার অবস্থা এখন যাচাই করা যাবে না।'),
    );
  });

  // The app's mutation handler (query-client.ts) owns the 403 toast; the page adds none.
  it('a 403 on Check status adds no toast of its own (the app-wide one explains it)', async () => {
    mockLogs([row()]);
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    let answered = false;
    server.use(
      http.post('/api/v1/communications/logs/log-1/check-status', () => {
        answered = true;
        return apiError(403, 'Forbidden resource');
      }),
    );
    render('/communications/message-log');
    const dialog = await openDetail();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check status' }));
    await waitFor(() => expect(answered).toBe(true));
    // Settled: the button is usable again, and the page itself showed nothing.
    await waitFor(() =>
      expect(
        within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Check status' }).disabled,
      ).toBe(false),
    );
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('disables Check status while the request is pending', async () => {
    mockLogs([row()]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/v1/communications/logs/log-1/check-status', async () => {
        await gate;
        return HttpResponse.json(row());
      }),
    );
    render('/communications/message-log');
    const dialog = await openDetail();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check status' }));
    const busy = await within(dialog).findByRole('button', { name: /Checking/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() =>
      expect(within(dialog).queryByRole('button', { name: /Checking/ })).toBe(null),
    );
  });

  it('the open dialog stays when a refetch moves its row off the page', async () => {
    let data = [row()];
    server.use(
      http.get('/api/v1/communications/logs', () => HttpResponse.json(page(data))),
      http.get('/api/v1/communications/logs/filter-options', () =>
        HttpResponse.json(filterOptions),
      ),
      http.post('/api/v1/communications/logs/log-1/check-status', () => {
        // New messages arrived: this row is now on page 2.
        data = [row({ id: 'log-2', recipient_name: 'Someone New' })];
        return HttpResponse.json(row({ status: 'DELIVERED', can_check_status: false }));
      }),
    );
    vi.spyOn(toast, 'success').mockImplementation(() => '');
    render('/communications/message-log');
    const dialog = await openDetail();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check status' }));

    expect(await screen.findByText('Someone New')).toBeTruthy();
    const open = screen.getByRole('dialog');
    expect(detailValue(open, 'Recipient').textContent).toBe('Karim Uddin');
    expect(detailValue(open, 'Status').textContent).toContain('Delivered');
  });

  // [#3343] One person's messages: the same list, narrowed on the server, with every filter and
  // Check status. The scope survives a filter change and Clear all (it is not a filter).
  it('?student= asks the log for that student, keeps the scope through filters, offers Check status', async () => {
    const user = userEvent.setup();
    const queries: URLSearchParams[] = [];
    mockLogs([row()], (q) => queries.push(q));
    const { router } = render(`/communications/message-log?student=${STUDENT}&status=SENT`);

    expect(await screen.findByText('Karim Uddin')).toBeTruthy();
    expect(screen.getByText('Showing messages for one student.')).toBeTruthy();
    expect(queries.at(-1)?.get('student_id')).toBe(STUDENT);
    expect(screen.getByRole('link', { name: 'Show all messages' })).toBeTruthy();

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'Karim');
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('Karim'));
    expect(queries.at(-1)?.get('student_id')).toBe(STUDENT);
    expect(queries.at(-1)?.get('status')).toBe('SENT');
    expect(router.state.location.search).toMatchObject({ student: STUDENT, search: 'Karim' });
    // The scope is no filter: no chip for it, and Clear all keeps it.
    expect(screen.queryByRole('button', { name: /student/i })).toBe(null);

    fireEvent.click(await screen.findByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(queries.at(-1)?.has('search')).toBe(false));
    expect(queries.at(-1)?.has('status')).toBe(false);
    expect(queries.at(-1)?.get('student_id')).toBe(STUDENT);
    expect(router.state.location.search).toMatchObject({ student: STUDENT });

    const dialog = await openDetail();
    expect(within(dialog).getByRole('button', { name: 'Check status' })).toBeTruthy();
  });

  it('?guardian= asks the log for that guardian and says so when nothing was sent', async () => {
    let query: URLSearchParams | null = null;
    mockLogs([], (q) => {
      query = q;
    });
    render(`/communications/message-log?guardian=${GUARDIAN}`);
    expect(await screen.findByText('No message has been sent to this guardian yet.')).toBeTruthy();
    expect(screen.getByText('Showing messages for one guardian.')).toBeTruthy();
    expect((query as URLSearchParams | null)?.get('guardian_id')).toBe(GUARDIAN);
    expect((query as URLSearchParams | null)?.has('student_id')).toBe(false);
  });
});
