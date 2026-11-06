import { AttendanceStatus } from '@biddaloy/shared';
import { toast } from '@biddaloy/ui/components';
import type { RegisterStudent } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorrectionDialog, type CorrectionDialogProps } from './-correction-dialog';

function student(overrides: Partial<RegisterStudent> = {}): RegisterStudent {
  return {
    student_id: 'student-1',
    roll_number: 1,
    full_name: 'Rahim Uddin',
    record_id: 'record-1',
    status: AttendanceStatus.ABSENT,
    minutes_late: null,
    remarks: null,
    source: 'TEACHER',
    correction_count: 1,
    suggested_status: null,
    scanned_at: null,
    ...overrides,
  };
}

function renderDialog(props: Partial<CorrectionDialogProps> = {}) {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <CorrectionDialog
      open
      onOpenChange={onOpenChange}
      sectionId="section-1"
      date="2026-09-04"
      student={student()}
      {...props}
    />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  return { ...view, onOpenChange };
}

describe('CorrectionDialog', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('keeps Save disabled until the status actually changes and the reason is long enough', async () => {
    renderDialog();
    const user = userEvent.setup();

    const save = await screen.findByRole<HTMLButtonElement>('button', { name: 'Save correction' });
    expect(save.disabled).toBe(true);

    // Reason alone, status unchanged (still ABSENT) — still disabled.
    await user.type(screen.getByLabelText('Why did this change?'), 'Slip submitted late');
    expect(save.disabled).toBe(true);

    // Now change the status too.
    await user.click(screen.getByRole('button', { name: /Mark Rahim Uddin Present/ }));
    expect(save.disabled).toBe(false);
  });

  it('blocks save on an empty/too-short reason even once the status changes', async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Mark Rahim Uddin Present/ }));
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save correction' }).disabled,
    ).toBe(true);

    await user.type(screen.getByLabelText('Why did this change?'), 'ok');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save correction' }).disabled,
    ).toBe(true);
  });

  it('shows the minutes-late input only when LATE is selected', async () => {
    renderDialog();
    const user = userEvent.setup();

    expect(screen.queryByLabelText('Minutes late')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Mark Rahim Uddin Late/ }));
    expect(await screen.findByLabelText('Minutes late')).toBeTruthy();
  });

  it('saves with { status, reason } and closes on success', async () => {
    let received: Record<string, unknown> | undefined;
    server.use(
      http.patch('/api/v1/attendance/records/record-1', async ({ request }) => {
        received = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          section: { id: 'section-1', section_name: 'A', class_name: 'Class 5' },
          session: {
            id: 'session-1',
            date: '2026-09-04',
            period_no: null,
            state: 'DRAFT',
            version: 3,
            marked_by_user_id: 'user-2',
            marked_at: '2026-09-04T00:00:00.000Z',
            finalized_at: null,
          },
          editable: false,
          reason_required: true,
          non_working_day: false,
          policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: false },
          students: [],
        });
      }),
    );

    const { onOpenChange } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Mark Rahim Uddin Present/ }));
    await user.type(screen.getByLabelText('Why did this change?'), 'Slip submitted late');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(received).toEqual({ status: 'PRESENT', reason: 'Slip submitted late' });
  });

  it('shows the translated error toast, never the server message, on a 500', async () => {
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    server.use(
      http.patch('/api/v1/attendance/records/record-1', () =>
        HttpResponse.json(
          {
            statusCode: 500,
            message: 'duplicate key value violates constraint',
            timestamp: new Date().toISOString(),
            path: '/attendance/records/record-1',
            requestId: 'req-1',
          },
          { status: 500 },
        ),
      ),
    );

    const { onOpenChange } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Mark Rahim Uddin Present/ }));
    await user.type(screen.getByLabelText('Why did this change?'), 'Slip submitted late');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Could not save correction'));
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('renders a 422 error inline on the reason field, not as a toast', async () => {
    server.use(
      http.patch('/api/v1/attendance/records/record-1', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'A reason of at least 3 characters is required',
            timestamp: new Date().toISOString(),
            path: '/attendance/records/record-1',
            requestId: 'req-1',
          },
          { status: 422 },
        ),
      ),
    );

    const { onOpenChange } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Mark Rahim Uddin Present/ }));
    await user.type(screen.getByLabelText('Why did this change?'), 'Slip submitted late');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(await screen.findByText('A reason of at least 3 characters is required')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
