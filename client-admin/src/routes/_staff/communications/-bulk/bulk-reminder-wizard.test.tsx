/**
 * [8.11.9]'s bulk fee-reminder wizard, mounted at
 * `/communications/reminders?mode=bulk` — real route tree, same
 * reasoning `reminders.test.tsx` gives for the single-student page.
 *
 * The two behaviors that matter most, in order:
 * 1. Recipients come from **explicit selection**, never from the dues
 *    filters alone — Next stays disabled at zero selected.
 * 2. Send exists only while the server preview matches the current
 *    inputs — editing any earlier step turns the footer button back into
 *    Preview until the preview is re-run (a queued bulk SMS cannot be
 *    recalled).
 */
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatMonthName, formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../../help/test-utils';
import { routeTree } from '../../../../routeTree.gen';

const STUDENT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const STUDENT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

function dueRow(studentId: string, name: string, registration: string) {
  return {
    student_id: studentId,
    full_name: name,
    registration_number: registration,
    roll_number: 1,
    class_name: 'One',
    section_name: 'A',
    total_due: 1200,
    months_overdue: 2,
    dues: [],
  };
}

/** Two fixed rows so "Select row 1"/"Select row 2" map to known ids. */
function duesHandler() {
  return http.get('/api/v1/fees/dues', () =>
    HttpResponse.json({
      data: [
        dueRow(STUDENT_A, 'Arif Hossain', '12345678'),
        dueRow(STUDENT_B, 'Mitu Akter', '87654321'),
      ],
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
    }),
  );
}

/** Counts and row indices render in the region's numerals. */
const n = (value: number) => formatNumber(value, REGION_BD_EN);

function render() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/communications/reminders?mode=bulk'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

/** The footer's primary button while on the recipients / message step. */
function wizardNext(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: /^Next: (message|check)$/ });
}

/** `Send reminders to 2 people` — the footer primary once a preview is current. */
const SEND_NAME = `Send reminders to ${n(2)} people`;

async function selectBothStudents(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('checkbox', { name: `Select row ${n(1)}` }));
  await user.click(screen.getByRole('checkbox', { name: `Select row ${n(2)}` }));
}

async function fillMessageStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(wizardNext());
  await user.type(screen.getByRole('textbox', { name: 'Round name' }), 'August dues');
  await user.click(screen.getByRole('textbox', { name: 'Message template' }));
  await user.paste('Dear {{guardian_name}}, dues are open.');
}

describe('bulk reminder wizard', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  it('shows the message and mediums (?) on the message step [#3314]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await user.click(wizardNext());
    await expectHelp('communications.feeReminders.section.bulkMessage');
    await expectHelp('communications.feeReminders.field.bulkMediums');
    // The (?) sits beside the label, so the textbox keeps its name.
    expect(screen.getByRole('textbox', { name: 'Message template' })).toBeTruthy();
  });

  it('opens as a full page from the single-reminder page, and Close returns to it', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/communications/reminders'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await user.click(await screen.findByRole('button', { name: 'Remind many at once' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bulk Fee Reminders' }),
    ).toBeTruthy();
    // Nothing picked or typed yet, so Close leaves without asking.
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('heading', { name: 'Fee Reminders' })).toBeTruthy();
  });

  it('requires explicit selection: Next is disabled at zero selected and the counter tracks picks', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    // Filters populated a table, but nothing is selected — the filters
    // alone never define the recipient set.
    expect(screen.getByText(`${n(0)} of ${n(500)} students picked`)).toBeTruthy();
    expect(wizardNext().disabled).toBe(true);

    await selectBothStudents(user);
    expect(screen.getByText(`${n(2)} of ${n(500)} students picked`)).toBeTruthy();
    expect(wizardNext().disabled).toBe(false);
  });

  it('swaps the footer button from Preview to Send, and back when an earlier step changes', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());

    // On review: never previewed — the standing rule. The one filled
    // button is Preview; there is no Send yet.
    expect(screen.queryByRole('button', { name: SEND_NAME })).toBeNull();
    expect(screen.getByText('Check the preview to enable sending.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    // MSW's default bulk preview echoes both students back as recipients.
    await screen.findByText(`${n(2)} guardian(s) will receive this reminder · ${n(1)} skipped`);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: SEND_NAME }).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Preview recipients' })).toBeNull();

    // Mutate an earlier step: the completed "Message" crumb is a button.
    await user.click(screen.getByRole('button', { name: 'Message' }));
    await user.click(screen.getByRole('textbox', { name: 'Message template' }));
    await user.paste(' Pay soon.');
    await user.click(wizardNext());

    // Previewed-then-edited — the staleness warning, Send gone again.
    expect(screen.queryByRole('button', { name: SEND_NAME })).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview recipients' })).toBeTruthy();
    expect(
      screen.getByText(
        'The earlier steps changed since the last preview — preview again before sending.',
      ),
    ).toBeTruthy();
  });

  it('keeps the selection when stepping back, and asks before Close discards it', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await user.click(wizardNext());
    await user.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(screen.getByText(`${n(2)} of ${n(500)} students picked`)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Bulk Fee Reminders' })).toBeTruthy();
  });

  it('asks before the footer Cancel discards ticked students', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('checkbox', { name: `Select row ${n(1)}` }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Bulk Fee Reminders' })).toBeTruthy();
  });

  it('lists months by name, asks for 25 rows by default and shows the step row', async () => {
    let limit: string | null = null;
    server.use(
      http.get('/api/v1/fees/dues', ({ request }) => {
        limit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 });
      }),
    );
    const user = userEvent.setup();
    render();

    await screen.findByText('No students match these filters.');
    expect(limit).toBe('25');
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain('Recipients');

    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    // The test tenant has no region settings, so month names follow the Bangla default.
    expect(
      await screen.findByRole('option', { name: formatMonthName(1, REGION_BD_EN) }),
    ).toBeTruthy();
    expect(screen.queryByRole('option', { name: '01' })).toBeNull();
  });

  it('shows one translated sentence for a 400 on preview, never the server text', async () => {
    const serverMessage = 'student_ids contains an unknown id';
    server.use(
      duesHandler(),
      http.post('/api/v1/communications/reminder/bulk/preview', () =>
        HttpResponse.json(
          apiErrorBody(400, serverMessage, '/api/v1/communications/reminder/bulk/preview'),
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'The preview could not be made — go back and check the students and message.',
    );
    expect(screen.queryByText(serverMessage)).toBeNull();
  });

  it('rejects unsupported placeholders on the message step before any request', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await user.click(wizardNext());
    await user.type(screen.getByRole('textbox', { name: 'Round name' }), 'August dues');
    await user.click(screen.getByRole('textbox', { name: 'Message template' }));
    await user.paste('Dear {{parent_name}}');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('{{parent_name}}');
    expect(wizardNext().disabled).toBe(true);
  });

  it('submits the exact composed body and links to the created batch', async () => {
    let sentBody: Record<string, unknown> | undefined;
    server.use(
      duesHandler(),
      http.post('/api/v1/communications/reminder/bulk', async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            id: 'batch-new-1',
            batch_name: 'August dues',
            status: 'PROCESSING',
            total_recipients: 2,
            successful_count: 0,
            failed_count: 0,
            message_template: 'Dear {{guardian_name}}, dues are open.',
            created_at: new Date().toISOString(),
            skipped: [],
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText(`${n(2)} guardian(s) will receive this reminder · ${n(1)} skipped`);
    await user.click(screen.getByRole('button', { name: SEND_NAME }));

    await screen.findByText('“August dues” is being sent in the background.');
    expect(sentBody).toEqual({
      student_ids: [STUDENT_A, STUDENT_B],
      message_template: 'Dear {{guardian_name}}, dues are open.',
      batch_name: 'August dues',
      mediums: ['EMAIL', 'SMS', 'WHATSAPP'],
    });

    // The footer primary now opens the round's detail page.
    expect(screen.getByRole('button', { name: 'See sending progress' })).toBeTruthy();
  });

  it('completes the review step with the keyboard alone', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());

    // Keyboard-only from here: focus the preview button, activate it,
    // then reach and activate submit — [8.11.9]'s "preview step
    // keyboard-operable" AC.
    screen.getByRole('button', { name: 'Preview recipients' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByText(`${n(2)} guardian(s) will receive this reminder · ${n(1)} skipped`);
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: SEND_NAME });
    expect(submit.disabled).toBe(false);
    submit.focus();
    await user.keyboard('{Enter}');
    await screen.findByText(/is being sent in the background\./);
  });

  it('surfaces the rate-limit note on a 429 from the bulk send', async () => {
    server.use(
      duesHandler(),
      http.post('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json(
          apiErrorBody(
            429,
            'ThrottlerException: Too Many Requests',
            '/api/v1/communications/reminder/bulk',
          ),
          { status: 429 },
        ),
      ),
    );
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText(`${n(2)} guardian(s) will receive this reminder · ${n(1)} skipped`);
    await user.click(screen.getByRole('button', { name: SEND_NAME }));

    await waitFor(() => {
      expect(
        screen.getByText('Too many bulk requests in a row — wait a moment and try again.'),
      ).toBeTruthy();
    });
  });

  it('[15.6.8/#551] disables send only when metered and short — never in OFF mode', async () => {
    server.use(
      duesHandler(),
      http.post('/api/v1/communications/reminder/bulk/preview', () =>
        HttpResponse.json({
          total_students: 2,
          recipients_count: 2,
          skipped_count: 0,
          students: [],
          projection: {
            sms_recipients: 2,
            sms_units: 2,
            metering: 'PLATFORM',
            available: 1,
            reserved: 0,
            shortfall: 1,
          },
        }),
      ),
    );
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));

    await screen.findByText(`(${n(1)} short)`, { exact: false });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: SEND_NAME }).disabled).toBe(true);
  });

  it('[15.6.8/#551] renders required vs available inline on a 409 INSUFFICIENT_SMS_CREDIT send', async () => {
    server.use(
      duesHandler(),
      http.post('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'Insufficient SMS credit to send this batch.',
            timestamp: new Date().toISOString(),
            path: '/api/v1/communications/reminder/bulk',
            requestId: 'req-1',
            details: { code: 'INSUFFICIENT_SMS_CREDIT', required: 2, available: 1 },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText(`${n(2)} guardian(s) will receive this reminder · ${n(1)} skipped`);
    await user.click(screen.getByRole('button', { name: SEND_NAME }));

    await waitFor(() => {
      expect(
        screen.getByText(
          `Not enough SMS credit to send: ${n(2)} unit(s) needed, only ${n(1)} available.`,
        ),
      ).toBeTruthy();
    });
  });

  it('is axe clean with the preview on screen', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: `Select row ${n(1)}` });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText(`${n(2)} guardian(s) will receive this reminder · ${n(1)} skipped`);

    // Scan the wizard body (the dialog's second child, after the shell's header):
    // FullPageShell's own <header> is flagged `landmark-no-duplicate-banner` next
    // to the app shell's banner in jsdom — a shared-shell issue, reported separately.
    const body = screen.getByRole('dialog').children[1];
    expect(body).toBeTruthy();
    await expect(body as Element).toHaveNoViolations();
  });
});
