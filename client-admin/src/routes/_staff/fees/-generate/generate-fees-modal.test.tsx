import { getNotifications } from '@biddaloy/ui/api';
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { apiErrorBody, cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GenerateFeesModal } from './generate-fees-modal';

function approvalRequiredBody() {
  return HttpResponse.json(
    {
      statusCode: 403,
      message: 'Approval required',
      timestamp: new Date().toISOString(),
      path: '/fees/generate',
      requestId: 'req-1',
      details: { code: 'APPROVAL_REQUIRED' },
    },
    { status: 403 },
  );
}

// The default test RegionConfig is Bangla; pin English digits. ADMIN holds PROGRAM_READ.
async function renderModal(
  props: Partial<React.ComponentProps<typeof GenerateFeesModal>> = {},
  role = 'ADMIN',
) {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <GenerateFeesModal open onOpenChange={onOpenChange} {...props} />
    </RegionConfigProvider>,
    { tenantId: 'tenant-1', locale: 'en', role },
  );
  await view.localeReady;
  return { ...view, onOpenChange };
}

/** Deterministic academic year: 2026 is the current one, so the month defaults to January. */
function yearHandler() {
  return http.get('/api/v1/academic-years', () =>
    HttpResponse.json({
      data: [
        {
          id: 'year-2026',
          name: '2026',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          is_current: true,
        },
      ],
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
    }),
  );
}

describe('GenerateFeesModal', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the matched count after "Select all N matching"', async () => {
    server.use(
      http.get('/api/v1/students/ids', () =>
        HttpResponse.json({
          ids: Array.from({ length: 120 }, (_, i) => `student-${i}`),
          total: 120,
        }),
      ),
    );

    const user = userEvent.setup();
    await renderModal();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));

    await screen.findByText('120 selected');
  });

  it('disables Generate when no fee structures are selected', async () => {
    await renderModal();
    const generateButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Create bills',
    });
    expect(generateButton.disabled).toBe(true);
  });

  it('shows the duplicates step when the preview reports duplicates', async () => {
    server.use(
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['student-1'], total: 1 })),
      http.post('/api/v1/fees/generate/preview', () =>
        HttpResponse.json({
          students_total: 1,
          would_generate: 0,
          duplicates: [
            {
              student_id: 'student-1',
              fee_structure_id: 'fee-1',
              existing_bill_id: 'existing-1',
              paid_amount: 500,
            },
          ],
          inactive: [],
        }),
      ),
    );

    const user = userEvent.setup();
    await renderModal();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));

    // Select at least one fee structure so Generate is enabled.
    const feePicker = await screen.findByTestId('fee-picker');
    const feeCheckboxes = await within(feePicker).findAllByRole('checkbox');
    await user.click(feeCheckboxes[0]!);

    await user.click(screen.getByRole('button', { name: 'Create bills' }));

    await screen.findByText('Some bills for this period already exist');
    // The unknown student/fee never show as raw ids.
    expect(screen.queryByText(/student-1|fee-1/)).toBeNull();
  });

  it('counts bills from the preview for every duplicate action', async () => {
    server.use(
      http.get('/api/v1/students/ids', () =>
        HttpResponse.json({ ids: ['student-1', 'student-2', 'student-3'], total: 3 }),
      ),
      // 3 students x 1 fee: one new bill, one duplicate, one pair the fee doesn't apply to.
      http.post('/api/v1/fees/generate/preview', () =>
        HttpResponse.json({
          students_total: 3,
          would_generate: 1,
          duplicates: [
            {
              student_id: 'student-1',
              fee_structure_id: 'fee-1',
              existing_bill_id: 'existing-1',
              paid_amount: 0,
            },
          ],
          inactive: [],
        }),
      ),
    );

    const user = userEvent.setup();
    await renderModal();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));
    const feePicker = await screen.findByTestId('fee-picker');
    await user.click((await within(feePicker).findAllByRole('checkbox'))[0]!);
    expect(screen.getByText('3 bills will be created')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Create bills' }));
    await screen.findByText('Some bills for this period already exist');
    expect(screen.getByText('1 bill will be created')).toBeTruthy();

    await user.click(
      screen.getByRole('radio', { name: /Delete the old bill and create a new one/ }),
    );
    expect(screen.getByText('2 bills will be created')).toBeTruthy();
  });

  it('CREATE_ANYWAY triggers the approval flow: a 403 then a retried success', async () => {
    server.use(
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['student-1'], total: 1 })),
      http.post('/api/v1/fees/generate/preview', () =>
        HttpResponse.json({
          students_total: 1,
          would_generate: 0,
          duplicates: [
            {
              student_id: 'student-1',
              fee_structure_id: 'fee-1',
              existing_bill_id: 'existing-1',
              paid_amount: 500,
            },
          ],
          inactive: [],
        }),
      ),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json(
          { approval_token: 'tok-123', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        ),
      ),
    );

    let generateCalls = 0;
    server.use(
      http.post('/api/v1/fees/generate', () => {
        generateCalls += 1;
        if (generateCalls === 1) return approvalRequiredBody();
        return HttpResponse.json(
          {
            fee_generation_id: 'gen-1',
            student_count: 1,
            generated_count: 1,
            skipped_count: 0,
            removed_count: 0,
            inactive_skipped: [],
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    await renderModal();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));
    const feePicker = await screen.findByTestId('fee-picker');
    const feeCheckboxes = await within(feePicker).findAllByRole('checkbox');
    await user.click(feeCheckboxes[0]!);

    await user.click(screen.getByRole('button', { name: 'Create bills' }));
    await screen.findByText('Some bills for this period already exist');

    await user.click(screen.getByRole('radio', { name: /Create anyway/ }));
    await user.click(screen.getByRole('button', { name: 'Create bills' }));

    // 403 APPROVAL_REQUIRED opens the step-up modal.
    await user.type(await screen.findByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(generateCalls).toBe(2));
  });

  it('omits student_ids and shows the program-audience message for a program-only scope', async () => {
    let previewBody: unknown;
    server.use(
      http.get('/api/v1/programs', () =>
        HttpResponse.json([{ id: 'program-1', name: 'Hifz Program' }]),
      ),
      http.post('/api/v1/fees/generate/preview', async ({ request }) => {
        previewBody = await request.json();
        return HttpResponse.json({
          students_total: 5,
          would_generate: 5,
          duplicates: [],
          inactive: [],
        });
      }),
    );

    const user = userEvent.setup();
    await renderModal();

    // No students selected, only a program — footer must not claim "0
    // students" before the server has resolved anything.
    await user.click(await screen.findByRole('combobox', { name: 'Program' }));
    await user.click(await screen.findByRole('option', { name: 'Hifz Program' }));

    await screen.findByText('Billing all active students in the selected program.');

    const feePicker = await screen.findByTestId('fee-picker');
    const feeCheckboxes = await within(feePicker).findAllByRole('checkbox');
    await user.click(feeCheckboxes[0]!);

    await user.click(screen.getByRole('button', { name: 'Create bills' }));

    await waitFor(() => expect(previewBody).toBeTruthy());
    expect(previewBody).not.toHaveProperty('student_ids');
    expect((previewBody as { program_id: string }).program_id).toBe('program-1');
  });

  it('shows the generated/skipped toast and closes on success', async () => {
    server.use(
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['student-1'], total: 1 })),
      http.post('/api/v1/fees/generate/preview', () =>
        HttpResponse.json({
          students_total: 1,
          would_generate: 1,
          duplicates: [],
          inactive: [],
        }),
      ),
      http.post('/api/v1/fees/generate', () =>
        HttpResponse.json(
          {
            fee_generation_id: 'gen-2',
            student_count: 30,
            generated_count: 60,
            skipped_count: 2,
            removed_count: 0,
            inactive_skipped: [],
          },
          { status: 201 },
        ),
      ),
    );

    const user = userEvent.setup();
    const { onOpenChange } = await renderModal();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));
    const feePicker = await screen.findByTestId('fee-picker');
    const feeCheckboxes = await within(feePicker).findAllByRole('checkbox');
    await user.click(feeCheckboxes[0]!);

    await user.click(screen.getByRole('button', { name: 'Create bills' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(getNotifications()[0]?.message).toBe('Generated 60 bills for 30 students (2 skipped).');
  });

  it('renders a full-page form with a Close button, and nothing when closed', async () => {
    const { unmount } = await renderModal();

    expect(await screen.findByRole('heading', { level: 1, name: 'Create fee bills' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    unmount();

    const closed = renderWithProviders(<GenerateFeesModal open={false} onOpenChange={vi.fn()} />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });
    await closed.localeReady;
    expect(screen.queryByRole('heading', { name: 'Create fee bills' })).toBeNull();
  });

  it('sends the picked month as period_start and defaults the due date to 9 days later', async () => {
    let previewBody: Record<string, unknown> | undefined;
    server.use(
      yearHandler(),
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['student-1'], total: 1 })),
      http.post('/api/v1/fees/generate/preview', async ({ request }) => {
        previewBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          students_total: 1,
          would_generate: 0,
          duplicates: [
            {
              student_id: 'student-1',
              fee_structure_id: 'fee-1',
              existing_bill_id: 'existing-1',
              paid_amount: 500,
            },
          ],
          inactive: [],
        });
      }),
    );

    const user = userEvent.setup();
    await renderModal();

    // January 2026 is the default (the year's first month); pick October.
    await user.click(await screen.findByRole('button', { name: 'Month' }));
    await user.click(await screen.findByRole('button', { name: 'October' }));
    expect(screen.getByRole('button', { name: 'Month' }).textContent).toBe('October 2026');
    // Due date defaults to the 10th and shows in a readable form.
    expect(screen.getByRole('button', { name: /^Due date, / }).textContent).toBe(
      '10th October, 2026',
    );

    await user.click(await screen.findByRole('button', { name: /Select all/ }));
    const feeCheckboxes = await within(await screen.findByTestId('fee-picker')).findAllByRole(
      'checkbox',
    );
    await user.click(feeCheckboxes[0]!);
    await user.click(screen.getByRole('button', { name: 'Create bills' }));

    await waitFor(() => expect(previewBody).toBeTruthy());
    expect(previewBody).toMatchObject({ period_start: '2026-10-01', period_type: 'MONTH' });
  });

  it('asks before discarding once a fee is ticked, and Keep editing keeps the form', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = await renderModal();

    const feeCheckboxes = await within(await screen.findByTestId('fee-picker')).findAllByRole(
      'checkbox',
    );
    await user.click(feeCheckboxes[0]!);
    await user.click(screen.getByRole('button', { name: 'Close' }));

    const confirm = within(await screen.findByRole('alertdialog'));
    expect(confirm.getByText('Discard your changes?')).toBeTruthy();
    await user.click(confirm.getByRole('button', { name: 'Keep editing' }));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Create fee bills' })).toBeTruthy();
  });

  it('a preselected student shows "1 selected" and Close closes without a confirm', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = await renderModal({
      preselectedStudent: { id: 'student-1', name: 'Rahim Uddin' },
    });

    expect((await screen.findByTestId('selected-count-chip')).textContent).toBe('1 selected');

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows a translated sentence, never the server message, when generating fails', async () => {
    server.use(
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['student-1'], total: 1 })),
      http.post('/api/v1/fees/generate/preview', () =>
        HttpResponse.json(apiErrorBody(400, 'Internal thing', '/api/v1/fees/generate/preview'), {
          status: 400,
        }),
      ),
    );

    const user = userEvent.setup();
    await renderModal();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));
    const feeCheckboxes = await within(await screen.findByTestId('fee-picker')).findAllByRole(
      'checkbox',
    );
    await user.click(feeCheckboxes[0]!);
    await user.click(screen.getByRole('button', { name: 'Create bills' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("We couldn't confirm the result of this run.");
    expect(screen.queryByText(/Internal thing/)).toBeNull();
  });

  it('keeps the primary action disabled until a student and a fee are chosen', async () => {
    server.use(
      yearHandler(),
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['student-1'], total: 1 })),
    );
    const user = userEvent.setup();
    await renderModal();

    const submit = await screen.findByRole<HTMLButtonElement>('button', { name: 'Create bills' });
    expect(submit.disabled).toBe(true);

    await user.click(await screen.findByRole('button', { name: /Select all/ }));
    expect(submit.disabled).toBe(true);

    const feeCheckboxes = await within(await screen.findByTestId('fee-picker')).findAllByRole(
      'checkbox',
    );
    await user.click(feeCheckboxes[0]!);
    await waitFor(() => expect(submit.disabled).toBe(false));
  });

  it('moves the month into the academic year when the year is changed', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [
            {
              id: 'year-2026',
              name: '2026',
              start_date: '2026-01-01',
              end_date: '2026-12-31',
              is_current: true,
            },
            {
              id: 'year-2027',
              name: '2027',
              start_date: '2027-01-01',
              end_date: '2027-12-31',
              is_current: false,
            },
          ],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );

    const user = userEvent.setup();
    await renderModal();

    await screen.findByText('January 2026');
    await user.click(screen.getByRole('combobox', { name: /^Academic year/ }));
    await user.click(await screen.findByRole('option', { name: '2027' }));

    await screen.findByText('January 2027');
  });

  it('sends due_date and the chosen fee ids in the real generate request', async () => {
    let generateBody: Record<string, unknown> | undefined;
    server.use(
      yearHandler(),
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({
          data: [{ id: 'fee-1', name: 'Tuition', amount: 500, class_id: null }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['student-1'], total: 1 })),
      http.post('/api/v1/fees/generate/preview', () =>
        HttpResponse.json({ students_total: 1, would_generate: 1, duplicates: [], inactive: [] }),
      ),
      http.post('/api/v1/fees/generate', async ({ request }) => {
        generateBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            fee_generation_id: 'gen-1',
            student_count: 1,
            generated_count: 1,
            skipped_count: 0,
            removed_count: 0,
            inactive_skipped: [],
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    await renderModal();
    await user.click(await screen.findByRole('button', { name: /Select all/ }));
    await user.click(await screen.findByRole('checkbox', { name: /Tuition/ }));
    await user.click(screen.getByRole('button', { name: 'Create bills' }));

    await waitFor(() => expect(generateBody).toBeTruthy());
    expect(generateBody).toMatchObject({
      due_date: '2026-01-10',
      period_start: '2026-01-01',
      fee_structure_ids: ['fee-1'],
      student_ids: ['student-1'],
    });
  });

  it('footer Cancel asks before discarding a changed form, and closes at once when untouched', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = await renderModal();

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('footer Cancel after a change shows the discard dialog and Keep editing keeps the form', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = await renderModal();

    const feeCheckboxes = await within(await screen.findByTestId('fee-picker')).findAllByRole(
      'checkbox',
    );
    await user.click(feeCheckboxes[0]!);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const confirm = within(await screen.findByRole('alertdialog'));
    expect(confirm.getByText('Discard your changes?')).toBeTruthy();
    await user.click(confirm.getByRole('button', { name: 'Keep editing' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Discard changes',
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('counts a period edit as a change', async () => {
    const user = userEvent.setup();
    await renderModal();

    await user.click(await screen.findByRole('combobox', { name: 'Period type' }));
    await user.click(await screen.findByRole('option', { name: 'Week' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });
});
