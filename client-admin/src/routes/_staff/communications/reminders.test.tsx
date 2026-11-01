/**
 * [8.11.9]'s single-student fee reminder page — real route tree, same
 * reasoning `fees/generate.test.tsx` gives for itself.
 *
 * The one behavior that matters most here is the preview-staleness
 * guard: a sent SMS cannot be recalled, so "Send" must be disabled not
 * just before *a* preview but before a preview of *these exact inputs* —
 * the first test pins the whole enable → edit → re-disable loop.
 */
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  cleanupTestState,
  guardianFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { apiErrorBody } from '@biddaloy/ui/test';
import { formatNumber, formatPhone } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

/** Counts render in the region's numerals. */
const n = (value: number) => formatNumber(value, REGION_BD_EN);

const GUARDIAN_MOTHER = guardianFactory({
  id: 'guardian-1',
  full_name: 'Rahima Begum',
  relationship: 'Mother',
  preferred_communication: 'SMS',
  phone: '+8801700000001',
});

const GUARDIAN_FATHER = guardianFactory({
  id: 'guardian-2',
  full_name: 'Karim Uddin',
  relationship: 'Father',
  preferred_communication: 'EMAIL',
  email: 'karim@example.com',
});

const STUDENT = studentFactory({
  id: 'student-1',
  full_name: 'Arif Hossain',
  registration_number: '12345678',
  guardians: [GUARDIAN_MOTHER, GUARDIAN_FATHER],
});

function referenceHandlers() {
  return [
    http.get('/api/v1/students', () =>
      HttpResponse.json({ data: [STUDENT], total: 1, page: 1, limit: 10, totalPages: 1 }),
    ),
    http.get('/api/v1/students/:id', () => HttpResponse.json(STUDENT)),
  ];
}

/** A preview response echoing both guardians as recipients. */
function previewHandler(onBody?: (body: Record<string, unknown>) => void) {
  return http.post(
    '/api/v1/communications/reminder/single/:studentId/preview',
    async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      onBody?.(body);
      const guardianIds = (body['guardian_ids'] as string[] | undefined) ?? [
        GUARDIAN_MOTHER.id,
        GUARDIAN_FATHER.id,
      ];
      return HttpResponse.json({
        student_id: params['studentId'] as string,
        recipients: guardianIds.includes(GUARDIAN_MOTHER.id)
          ? [
              {
                guardian_id: GUARDIAN_MOTHER.id,
                guardian_name: GUARDIAN_MOTHER.full_name,
                medium: 'SMS',
                address: GUARDIAN_MOTHER.phone,
                message_body: 'Dear Rahima Begum, Arif Hossain has dues.',
                subject: null,
              },
            ]
          : [],
        skipped: guardianIds.includes(GUARDIAN_FATHER.id)
          ? [
              {
                guardian_id: GUARDIAN_FATHER.id,
                guardian_name: GUARDIAN_FATHER.full_name,
                reason: 'guardian_has_no_address_for_preferred_medium',
              },
            ]
          : [],
      });
    },
  );
}

function render(role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/communications/reminders'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

async function pickStudent(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole('textbox', { name: 'Search students' }), 'Arif');
  await user.click(await screen.findByRole('button', { name: /Arif Hossain · 12345678/ }));
  // Guardian checklist appears once the detail query resolves.
  await screen.findByLabelText(/Rahima Begum \(Mother\)/);
}

describe('/communications/reminders', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  it('shows the guardians, message and medium (?) [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    server.use(...referenceHandlers(), previewHandler());
    const user = userEvent.setup();
    render();
    await pickStudent(user);
    await expectHelp('communications.feeReminders.field.guardians');
    await expectHelp('communications.feeReminders.field.message');
    await expectHelp('communications.feeReminders.field.medium');
  });

  it('keeps Send disabled until a preview runs, and re-disables it when inputs change', async () => {
    server.use(...referenceHandlers(), previewHandler());

    const user = userEvent.setup();
    render();
    await pickStudent(user);

    const templateInput = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Message',
    });
    await user.click(templateInput);
    await user.paste('Dear {{guardian_name}}, dues are open.');

    // The blocking rule: composed but never previewed → no Send on screen,
    // and the one filled button is Preview.
    const sendName = `Send reminder to ${n(1)} person`;
    expect(screen.queryByRole('button', { name: sendName })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText('Dear Rahima Begum, Arif Hossain has dues.');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: sendName }).disabled).toBe(false);
    // After a preview, "Preview again" is the outline button.
    expect(screen.getByRole('button', { name: 'Preview again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview recipients' })).toBeNull();

    // The staleness guard's teeth: any edit after a successful preview
    // hides the preview (and Send) until it is re-run for the new inputs.
    await user.type(templateInput, ' Pay soon.');
    expect(screen.queryByRole('button', { name: sendName })).toBeNull();
    expect(screen.queryByText('Preview')).toBeNull();
    expect(
      screen.getByText('Inputs changed since the last preview — preview again before sending.'),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    expect(
      (await screen.findByRole<HTMLButtonElement>('button', { name: sendName })).disabled,
    ).toBe(false);
  });

  it('shows resolved recipients and the skipped list with a plain-language reason', async () => {
    server.use(...referenceHandlers(), previewHandler());

    const user = userEvent.setup();
    render();
    await pickStudent(user);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Dues reminder for your child.');
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));

    // Recipient row: name, channel, address, fully rendered message.
    await screen.findByText('Dear Rahima Begum, Arif Hossain has dues.');
    expect(screen.getByText(`Will receive (${n(1)})`)).toBeTruthy();
    expect(
      screen.getByText(`SMS · ${formatPhone(GUARDIAN_MOTHER.phone as string, REGION_BD_EN)}`),
    ).toBeTruthy();

    // The rendered body is what the network charges for — its count sits
    // with the SMS recipient row ('Dear Rahima Begum, Arif Hossain has
    // dues.' = 41 GSM-7 septets).
    expect(screen.getByText(`${n(41)} characters · ${n(1)} SMS`)).toBeTruthy();

    // Skipped row: the snake_case wire reason mapped to plain language —
    // a silently dropped guardian is the failure mode the issue names.
    expect(screen.getByText(`Skipped (${n(1)})`)).toBeTruthy();
    expect(screen.getByText('Karim Uddin')).toBeTruthy();
    expect(screen.getByText('No phone or email on file for the preferred channel')).toBeTruthy();
  });

  it('blocks unknown placeholders client-side with a translated line', async () => {
    let posted = false;
    server.use(
      ...referenceHandlers(),
      http.post('/api/v1/communications/reminder/single/:studentId/preview', () => {
        posted = true;
        return HttpResponse.json({ student_id: 'student-1', recipients: [], skipped: [] });
      }),
    );

    const user = userEvent.setup();
    render();
    await pickStudent(user);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Hello {{class_name}}');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      "{{class_name}} isn't recognised. Use the buttons below to insert a name or amount.",
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Preview recipients' }).disabled,
    ).toBe(true);
    expect(posted).toBe(false);
  });

  it('accepts whitespace-padded placeholders, matching the server pattern', async () => {
    server.use(...referenceHandlers());

    const user = userEvent.setup();
    render();
    await pickStudent(user);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Dear {{ guardian_name }}, dues: {{  due_amount  }}.');

    // The server trims inner padding before checking the name
    // (reminder-template.util.ts) — the client must not reject a
    // template the server would render fine.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Preview recipients' }).disabled,
    ).toBe(false);
  });

  it('shows placeholders as words, never raw tokens, and sends server tokens', async () => {
    let previewBody: Record<string, unknown> | undefined;
    server.use(
      ...referenceHandlers(),
      previewHandler((body) => {
        previewBody = body;
      }),
    );

    const user = userEvent.setup();
    render();
    await pickStudent(user);
    expect(screen.queryByText(/\{\{/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Guardian name' }));

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
    expect(textarea.value).toBe('{Guardian name}');
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText('Dear Rahima Begum, Arif Hossain has dues.');
    expect(previewBody?.['message_template']).toBe('{{guardian_name}}');
  });

  it('flags a single-brace word it does not know', async () => {
    server.use(...referenceHandlers());
    const user = userEvent.setup();
    render();
    await pickStudent(user);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Hello {Nope}');

    expect((await screen.findByRole('alert')).textContent).toContain('{Nope} isn');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Preview recipients' }).disabled,
    ).toBe(true);
  });

  it('sends exactly the previewed inputs and shows the sent/skipped result panel', async () => {
    let sendBody: Record<string, unknown> | undefined;
    server.use(
      ...referenceHandlers(),
      previewHandler(),
      http.post(
        '/api/v1/communications/reminder/single/:studentId',
        async ({ request, params }) => {
          sendBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            {
              student_id: params['studentId'] as string,
              sent: [
                {
                  communication_log_id: 'log-1',
                  guardian_id: GUARDIAN_MOTHER.id,
                  guardian_name: GUARDIAN_MOTHER.full_name,
                  medium: 'SMS',
                  status: 'QUEUED',
                },
              ],
              skipped: [
                {
                  guardian_id: GUARDIAN_FATHER.id,
                  guardian_name: GUARDIAN_FATHER.full_name,
                  reason: 'guardian_has_no_address_for_preferred_medium',
                },
              ],
            },
            { status: 201 },
          );
        },
      ),
    );

    const user = userEvent.setup();
    render();
    await pickStudent(user);

    // Deselect the father — the request must carry the explicit selection,
    // not "all guardians".
    await user.click(screen.getByLabelText(/Karim Uddin \(Father\)/));

    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Dues reminder for your child.');
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText('Dear Rahima Begum, Arif Hossain has dues.');

    await user.click(screen.getByRole('button', { name: `Send reminder to ${n(1)} person` }));

    await screen.findByText('Reminder sent');
    expect(sendBody?.['message_template']).toBe('Dues reminder for your child.');
    expect(sendBody?.['guardian_ids']).toEqual([GUARDIAN_MOTHER.id]);
    expect(sendBody?.['medium']).toBeUndefined();

    expect(screen.getByText(`Sent (${n(1)})`)).toBeTruthy();
    expect(screen.getByText('Queued')).toBeTruthy();
    expect(screen.getByText(`Skipped (${n(1)})`)).toBeTruthy();
    expect(screen.getByText(/No phone or email on file for the preferred channel/)).toBeTruthy();
  });

  it('discards a slow preview response that lands after the student changed', async () => {
    server.use(
      ...referenceHandlers(),
      http.post('/api/v1/communications/reminder/single/:studentId/preview', async ({ params }) => {
        // Slow response — settles only after the test has moved on to a
        // different (re-picked) student.
        await delay(300);
        return HttpResponse.json({
          student_id: params['studentId'] as string,
          recipients: [
            {
              guardian_id: GUARDIAN_MOTHER.id,
              guardian_name: GUARDIAN_MOTHER.full_name,
              medium: 'SMS',
              address: GUARDIAN_MOTHER.phone,
              message_body: 'STALE preview body',
              subject: null,
            },
          ],
          skipped: [],
        });
      }),
    );

    const user = userEvent.setup();
    render();
    await pickStudent(user);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Dues reminder.');
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));

    // Abandon the request's context while it is still in flight.
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await pickStudent(user);

    // Give the slow response time to land, then prove it was discarded:
    // no recipients section, and Send still blocked — an accepted stale
    // preview here would have re-armed Send against inputs nobody
    // previewed.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByText('STALE preview body')).toBeNull();
    expect(screen.queryByText(/Will receive/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();
  });

  // Re-picking the *same* student after "Change student" must re-apply the
  // all-guardians default. It used to leave the checklist empty with Preview
  // disabled and no on-screen reason, because the "defaults applied for"
  // marker still held that student's id.
  it('re-applies the guardian defaults when the same student is picked again', async () => {
    server.use(...referenceHandlers());
    const user = userEvent.setup();
    render();

    await pickStudent(user);
    expect(
      screen
        .getByRole('checkbox', { name: /Rahima Begum \(Mother\)/ })
        .getAttribute('aria-checked'),
    ).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await pickStudent(user);

    expect(
      screen
        .getByRole('checkbox', { name: /Rahima Begum \(Mother\)/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Dues reminder.');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Preview recipients' }).disabled,
    ).toBe(false);
  });

  it('keeps a deliberate guardian deselection across a background refetch', async () => {
    server.use(...referenceHandlers());

    const user = userEvent.setup();
    const { queryClient } = render();
    await pickStudent(user);

    await user.click(screen.getByLabelText(/Karim Uddin \(Father\)/));
    expect(
      screen.getByRole('checkbox', { name: /Karim Uddin \(Father\)/ }).getAttribute('aria-checked'),
    ).toBe('false');

    // A refetch hands back a fresh `student` object for the same id —
    // that must not re-select the guardian the accountant just excluded.
    await queryClient.refetchQueries();
    await waitFor(() =>
      expect(
        screen
          .getByRole('checkbox', { name: /Karim Uddin \(Father\)/ })
          .getAttribute('aria-checked'),
      ).toBe('false'),
    );
    expect(
      screen
        .getByRole('checkbox', { name: /Rahima Begum \(Mother\)/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows the SMS counter only while an SMS can actually go out', async () => {
    server.use(...referenceHandlers());

    const user = userEvent.setup();
    render();
    await pickStudent(user);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Dues reminder.');

    // Default (guardian preference) with the mother preferring SMS —
    // counter visible, labelled as a template-based estimate.
    expect(screen.getByText(`${n(14)} characters · ${n(1)} SMS`)).toBeTruthy();
    expect(screen.getByText(/Estimate — the exact count/)).toBeTruthy();

    // Explicit Email override: no SMS will go out — quoting SMS segment
    // limits would be noise.
    await user.click(screen.getByRole('combobox', { name: 'Send by' }));
    await user.click(await screen.findByRole('option', { name: 'Email' }));
    expect(screen.queryByText(`${n(14)} characters · ${n(1)} SMS`)).toBeNull();

    // Explicit SMS override: back.
    await user.click(screen.getByRole('combobox', { name: 'Send by' }));
    await user.click(await screen.findByRole('option', { name: 'SMS' }));
    expect(screen.getByText(`${n(14)} characters · ${n(1)} SMS`)).toBeTruthy();
  });

  it('shows one translated sentence for a server 400, never the server text', async () => {
    const serverMessage =
      'No deliverable guardian for student "Arif Hossain" — every candidate skipped: Rahima Begum (no_open_dues)';
    server.use(
      ...referenceHandlers(),
      http.post('/api/v1/communications/reminder/single/:studentId/preview', () =>
        HttpResponse.json(
          apiErrorBody(
            400,
            serverMessage,
            '/api/v1/communications/reminder/single/student-1/preview',
          ),
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    render();
    await pickStudent(user);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Dues reminder.');
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'The preview could not be made — check the student, guardians and message.',
    );
    expect(screen.queryByText(serverMessage)).toBeNull();
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();
  });

  it('shows the guardian phone formatted and an unknown skip reason in plain words', async () => {
    server.use(
      ...referenceHandlers(),
      http.post('/api/v1/communications/reminder/single/:studentId/preview', () =>
        HttpResponse.json({
          student_id: 'student-1',
          recipients: [],
          skipped: [
            { guardian_id: 'g-x', guardian_name: 'Karim Uddin', reason: 'some_future_reason' },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render();
    await pickStudent(user);
    const row = screen.getByRole('checkbox', { name: /Rahima Begum \(Mother\)/ }).closest('label');
    expect(row?.textContent).toContain(
      `Prefers SMS · ${formatPhone(GUARDIAN_MOTHER.phone as string, REGION_BD_EN)}`,
    );

    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Dues reminder.');
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText('Skipped for another reason');
    expect(screen.queryByText('some_future_reason')).toBeNull();
  });

  it('counts Bangla text as UCS-2 segments in a live region', async () => {
    server.use(...referenceHandlers());

    const user = userEvent.setup();
    render();
    await pickStudent(user);

    const bangla = 'প্রিয় অভিভাবক, আপনার সন্তানের ফি বকেয়া আছে।';
    const templateInput = screen.getByRole('textbox', { name: 'Message' });
    await user.click(templateInput);
    await user.paste(bangla);

    // 44 UTF-16 code units ≤ 70 → one UCS-2 segment. A GSM-7 counter
    // would have claimed 160 per segment — the AC this pins.
    const counter = screen.getByText(`${n(bangla.length)} characters · ${n(1)} SMS`);
    expect(counter.getAttribute('aria-live')).toBe('polite');

    // Push past 70 code units → concatenated at 67 per segment.
    await user.paste(bangla);
    expect(screen.getByText(`${n(bangla.length * 2)} characters · ${n(2)} SMS`)).toBeTruthy();
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route in place with the shared `AccessDeniedState` copy, replacing
  // this route's own hand-rolled "You cannot send fee reminders" text.
  it('shows the forbidden message to a TEACHER on direct navigation', async () => {
    render('TEACHER');

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Search students' })).toBeNull();
  });

  it('is axe clean with a preview on screen', async () => {
    server.use(...referenceHandlers(), previewHandler());

    const user = userEvent.setup();
    const { container } = render();
    await pickStudent(user);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('Dues reminder for your child.');
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText('Dear Rahima Begum, Arif Hossain has dues.');

    await expect(container).toHaveNoViolations();
  });
});
