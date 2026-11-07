import { TooltipProvider } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RosterMarker, useArrivalBells } from './-roster-marker';

const STUDENTS = [
  { student_id: 'st-1', full_name: 'Rahim Uddin', roll_number: 1 },
  { student_id: 'st-2', full_name: 'Karim Ali', roll_number: 2 },
] as never;

const base = {
  students: STUDENTS,
  draft: {},
  onStatusChange: vi.fn(),
  onMinutesLateChange: vi.fn(),
  onAllPresent: vi.fn(),
  onSubmit: vi.fn(),
};

const LABEL = 'Guardian waits for the arrival notice';

/** The register page's wiring: the hook feeds the bell set into one RosterMarker. */
function WithBells({ enabled }: { enabled: boolean }) {
  const subscribed = useArrivalBells('section-1', enabled);
  return <RosterMarker {...base} arrivalSubscribed={subscribed} />;
}

describe('RosterMarker arrival bell', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('shows the bell only for students in the subscribed set', async () => {
    renderWithProviders(<RosterMarker {...base} arrivalSubscribed={new Set(['st-1'])} />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });
    expect(await screen.findAllByLabelText(LABEL)).toHaveLength(1);
    const row = screen.getByText('Rahim Uddin').closest('li');
    expect(row?.querySelector(`[aria-label="${LABEL}"]`)).toBeTruthy();
    expect(
      screen.getByText('Karim Ali').closest('li')?.querySelector(`[aria-label="${LABEL}"]`),
    ).toBeNull();
  });

  it('renders no bell and makes no request when the prop is absent', async () => {
    const hit = vi.fn();
    server.use(
      http.get('/api/v1/attendance/arrival-subscriptions', () => {
        hit();
        return HttpResponse.json([]);
      }),
    );
    renderWithProviders(<WithBells enabled={false} />, { tenantId: 'tenant-1', locale: 'en' });
    await screen.findByText('Rahim Uddin');
    expect(screen.queryByLabelText(LABEL)).toBeNull();
    expect(hit).not.toHaveBeenCalled();
  });

  it('fetches ACTIVE subscriptions for the section and bells those students', async () => {
    let query = '';
    server.use(
      http.get('/api/v1/attendance/arrival-subscriptions', ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json([{ student_id: 'st-2', status: 'ACTIVE' }]);
      }),
    );
    renderWithProviders(<WithBells enabled />, { tenantId: 'tenant-1', locale: 'en' });
    await waitFor(() => expect(screen.getAllByLabelText(LABEL)).toHaveLength(1));
    expect(query).toContain('sectionId=section-1');
    expect(query).toContain('status=ACTIVE');
    expect(
      screen.getByText('Karim Ali').closest('li')?.querySelector(`[aria-label="${LABEL}"]`),
    ).toBeTruthy();
  });
});

describe('RosterMarker mark badges [76.5.03]', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows a scanned badge and a from-sheet badge on their own rows only', async () => {
    const students = [
      {
        student_id: 'st-1',
        full_name: 'Rahim Uddin',
        roll_number: 1,
        scanned_at: '2026-09-04T01:55:00Z',
      },
      { student_id: 'st-2', full_name: 'Karim Ali', roll_number: 2, source: 'IMPORT' },
      { student_id: 'st-3', full_name: 'Salma Khatun', roll_number: 3 },
    ] as never;
    renderWithProviders(
      <TooltipProvider>
        <RosterMarker {...base} students={students} />
      </TooltipProvider>,
      {
        tenantId: 'tenant-1',
        locale: 'en',
      },
    );
    const row = (n: string) => screen.getByText(n).closest('li')!;
    await screen.findByText('Rahim Uddin');
    expect(row('Rahim Uddin').textContent).toMatch(/Scanned/);
    expect(row('Karim Ali').textContent).toMatch(/From sheet/);
    expect(row('Salma Khatun').textContent).not.toMatch(/Scanned|From sheet/);
  });

  it('Shift+A calls onRestAbsent, Shift+P calls onAllPresent', async () => {
    const onRestAbsent = vi.fn();
    const onAllPresent = vi.fn();
    renderWithProviders(
      <TooltipProvider>
        <RosterMarker {...base} onAllPresent={onAllPresent} onRestAbsent={onRestAbsent} />
      </TooltipProvider>,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    const user = userEvent.setup();
    const rows = await screen.findAllByRole('button', { name: /Rahim Uddin/ });
    await user.click(rows[0]!);
    await user.keyboard('{Shift>}a{/Shift}');
    expect(onRestAbsent).toHaveBeenCalledTimes(1);
    expect(onAllPresent).not.toHaveBeenCalled();
    await user.keyboard('{Shift>}p{/Shift}');
    expect(onAllPresent).toHaveBeenCalledTimes(1);
  });
});
