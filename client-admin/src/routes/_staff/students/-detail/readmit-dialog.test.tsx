import { apiErrorBody, cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { ReadmitDialog } from './readmit-dialog';

async function renderDialog(onOpenChange = vi.fn()) {
  const view = renderWithProviders(
    <ReadmitDialog open onOpenChange={onOpenChange} studentId="s1" studentName="Karim" />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  await view.localeReady;
  return { user: userEvent.setup(), onOpenChange };
}

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The date picker is capped at today: tomorrow is disabled, today is pickable. The
 * `errors.dateFuture` branch in the dialog is therefore a defensive backstop. */
async function expectFutureDaysDisabled(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Date, / }));
  const cell = (iso: string) => document.querySelector<HTMLElement>(`[data-date="${iso}"]`);
  await waitFor(() => expect(cell(isoOffset(0))).not.toBeNull());
  expect(cell(isoOffset(0))?.getAttribute('aria-disabled')).toBeNull();
  const tomorrow = cell(isoOffset(1));
  if (tomorrow) expect(tomorrow.getAttribute('aria-disabled')).toBe('true');
}

describe('ReadmitDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('requires a class and section', async () => {
    const { user } = await renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Readmit' }));
    expect(await screen.findByText('Choose a class and section.')).toBeTruthy();
  });

  it('caps the date picker at today (no native date input, future days disabled)', async () => {
    const { user } = await renderDialog();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('input[type="date"]')).toBeNull();
    await expectFutureDaysDisabled(user);
  });

  it('is axe clean', async () => {
    await renderDialog();
    await screen.findByRole('dialog');
    await expect(document.body).toHaveNoViolations();
  });

  async function submitReadmitWith409(body: object) {
    await loadRouteNamespaces('trial'); // the student route loader does this in the app
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [{ id: 'y1', name: '2026', is_current: true }],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [{ id: 'c1', name: 'Class 5', academic_year_id: 'y1' }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes/c1/sections', () =>
        HttpResponse.json([{ id: 'sec1', section_name: 'A', capacity: 40, enrolled_count: 3 }]),
      ),
      http.post('/api/v1/students/s1/readmit', () => HttpResponse.json(body, { status: 409 })),
    );
    const { user } = await renderDialog();
    await user.click(await screen.findByLabelText('Class'));
    await user.click(await screen.findByRole('option', { name: 'Class 5' }));
    await user.click(screen.getByLabelText('Section'));
    await user.click(await screen.findByRole('option', { name: 'A' }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  }

  it('shows a server 409 inline', async () => {
    await submitReadmitWith409({ statusCode: 409, message: 'Student is already active' });
    // Translated line only, never the server message; the dialog stays open.
    expect(screen.queryByText('Student is already active')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows the seat-limit message, not the generic error, on SEAT_LIMIT_REACHED', async () => {
    await submitReadmitWith409({
      ...apiErrorBody(409, 'Seat limit reached', '/api/v1/students/s1/readmit'),
      details: { code: 'SEAT_LIMIT_REACHED', used: 50, limit: 50, requested: 1 },
    });
    expect(await screen.findByText('Student limit reached')).toBeTruthy();
    expect(screen.getByText(/You have 50 of 50 students/)).toBeTruthy();
    expect(screen.queryByText(/Could not save/)).toBeNull();
  });
});
