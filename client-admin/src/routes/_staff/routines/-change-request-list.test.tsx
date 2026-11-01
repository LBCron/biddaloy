import type { RoutineChangeRequest } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { expectHelp, withHelp } from '../../../help/test-utils';

import { ChangeRequestList } from './-change-request-list';

afterEach(async () => {
  await cleanupTestState();
});

const SLOT = { when: 'Mon · Period 1', what: '8:00 AM · Math', section: 'Class 6 – A' };

const REQUEST = {
  id: 'cr-1',
  routine_slot_id: 'slot-1',
  requested_by: 'user-1',
  note: 'Please move this period.',
  state: 'OPEN' as const,
  resolved_by: null,
  resolved_at: null,
  resolution_note: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as RoutineChangeRequest;

describe('ChangeRequestList', () => {
  it('accepting never edits the routine — only PATCHes the change request', async () => {
    let routinePatched = false;
    let patchedBody: unknown = null;
    server.use(
      http.patch('/api/v1/routines/change-requests/cr-1', async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json({ ...REQUEST, state: 'ACCEPTED' });
      }),
      http.patch('/api/v1/routines/slots/slot-1', () => {
        routinePatched = true;
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <ChangeRequestList
        routineId="routine-1"
        requests={[REQUEST]}
        describeSlot={() => SLOT}
        requesterLabel={() => 'Ms Nahar'}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await waitFor(() => expect(screen.getByText('Mon · Period 1')).toBeTruthy());
    expect(screen.getByText('Class 6 – A')).toBeTruthy();
    expect(screen.getByText('Ms Nahar')).toBeTruthy();
    // No textarea until a dialog is opened.
    expect(screen.queryByRole('textbox')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await user.click(await screen.findByRole('button', { name: 'Accept', hidden: false }));
    await waitFor(() => expect(patchedBody).toEqual({ state: 'ACCEPTED' }));
    expect(routinePatched).toBe(false);
  });

  it('confirming with a note sends it as the resolution note; reject likewise', async () => {
    let patchedBody: unknown = null;
    server.use(
      http.patch('/api/v1/routines/change-requests/cr-1', async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json({ ...REQUEST, state: 'REJECTED' });
      }),
    );
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <ChangeRequestList
        routineId="routine-1"
        requests={[REQUEST]}
        describeSlot={() => SLOT}
        requesterLabel={() => 'Ms Nahar'}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('heading', { name: 'Reject this request?' })).toBeTruthy();
    await user.type(screen.getByLabelText('Note for the teacher (optional)'), ' Not possible. ');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(patchedBody).toEqual({ state: 'REJECTED', resolution_note: 'Not possible.' }),
    );
  });

  it('shows an empty state with no open requests', async () => {
    const { localeReady } = renderWithProviders(
      <ChangeRequestList
        routineId="routine-1"
        requests={[{ ...REQUEST, state: 'ACCEPTED' }]}
        describeSlot={() => SLOT}
        requesterLabel={() => 'Ms Nahar'}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    expect(screen.getByRole('heading', { name: 'No open requests' })).toBeTruthy();
  });

  it('draws a (?) beside the accept/reject dialog title', async () => {
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      withHelp(
        <ChangeRequestList
          routineId="routine-1"
          requests={[REQUEST]}
          describeSlot={() => SLOT}
          requesterLabel={() => 'Ms Nahar'}
        />,
      ),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    await expectHelp('academics.routineReview.action.resolveRequest');
  });
});
