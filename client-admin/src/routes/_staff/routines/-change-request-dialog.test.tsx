import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../../help/test-utils';

import { ChangeRequestDialog } from './-change-request-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('ChangeRequestDialog', () => {
  it('submits a note as the whole payload', async () => {
    let posted: unknown = null;
    server.use(
      http.post('/api/v1/routines/slots/slot-1/change-requests', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'cr-1', state: 'OPEN' });
      }),
    );
    const onDone = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <ChangeRequestDialog
        open
        onOpenChange={vi.fn()}
        routineId="routine-1"
        slotId="slot-1"
        onDone={onDone}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send/i })).toHaveProperty('disabled', true),
    );

    await user.type(
      screen.getByLabelText('What needs to change'),
      'This clashes with my other class.',
    );
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(posted).toEqual({ note: 'This clashes with my other class.' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('clicking cancel closes the dialog without submitting', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <ChangeRequestDialog
        open
        onOpenChange={onOpenChange}
        routineId="routine-1"
        slotId="slot-1"
        onDone={vi.fn()}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await user.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not call onDone when the server refuses the request, and the dialog stays open with the note intact', async () => {
    let attempts = 0;
    server.use(
      http.post('/api/v1/routines/slots/slot-1/change-requests', () => {
        attempts += 1;
        return HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 });
      }),
    );
    const onDone = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <ChangeRequestDialog
        open
        onOpenChange={vi.fn()}
        routineId="routine-1"
        slotId="slot-1"
        onDone={onDone}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    const textarea = screen.getByLabelText('What needs to change');
    await user.type(textarea, 'Some note text.');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(attempts).toBe(1));
    expect(onDone).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe('Some note text.');
  });

  it('does not submit when the note is only whitespace', async () => {
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <ChangeRequestDialog
        open
        onOpenChange={vi.fn()}
        routineId="routine-1"
        slotId="slot-1"
        onDone={vi.fn()}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await user.type(screen.getByLabelText('What needs to change'), '   ');
    expect(screen.getByRole('button', { name: /send/i })).toHaveProperty('disabled', true);
  });

  it('names the period in the description and has an outline Cancel', async () => {
    const { localeReady } = renderWithProviders(
      <ChangeRequestDialog
        open
        onOpenChange={vi.fn()}
        routineId="routine-1"
        slotId="slot-1"
        slotLabel="Mon · Period 1 · Math"
        onDone={vi.fn()}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    expect(await screen.findByText(/Mon · Period 1 · Math — tell the routine/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBe(
      'outline',
    );
  });

  it('draws a (?) beside the dialog title', async () => {
    const { localeReady } = renderWithProviders(
      withHelp(
        <ChangeRequestDialog
          open
          onOpenChange={vi.fn()}
          routineId="routine-1"
          slotId="slot-1"
          onDone={vi.fn()}
        />,
      ),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await expectHelp('academics.routineReview.action.requestChange');
  });
});
