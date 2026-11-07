import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget from './staff-today.widget';

const URL = '/api/v1/dashboard/widgets/staff-today';

const leave = (n: number, type = 'SICK') =>
  Array.from({ length: n }, (_, i) => ({
    staff_profile_id: `id-${i}`,
    full_name: `Teacher ${i + 1}`,
    leave_type: type,
    end_date: '2026-10-09',
  }));
const BASE = {
  date: '2026-10-07',
  staff_total: 45,
  present: 40,
  late: 2,
  absent: 0,
  leave: 3,
  unmarked: 0,
  absent_without_leave: 0,
  on_leave: leave(3),
};

function renderWidget(variant: 'full' | 'compact', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'EXECUTIVE',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('staff-today widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('full: 42/45 present, no-absent sentence, three rows, link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('42/45 present')).toBeTruthy();
    expect(screen.getByText('3 on leave, nobody absent without notice.')).toBeTruthy();
    expect(screen.getAllByText(/^Teacher \d$/)).toHaveLength(3);
    expect(screen.getAllByText('Sick')).toHaveLength(3);
    expect(screen.getAllByText('until 9th October, 2026')).toHaveLength(3);
    expect(screen.queryByText('SICK')).toBeNull();
    expect(screen.queryByText('id-0')).toBeNull();
    expect(screen.getByRole('link', { name: 'View staff attendance' }).getAttribute('href')).toBe(
      '/attendance/staff',
    );
  });

  it('absent_without_leave 2 uses the sentence with 2', async () => {
    serve({ ...BASE, absent: 2, absent_without_leave: 2 });
    renderWidget('full');
    expect(await screen.findByText('3 on leave, 2 absent without notice.')).toBeTruthy();
  });

  it('7 on leave: 5 rows on full, 3 in expanded compact', async () => {
    serve({ ...BASE, leave: 7, on_leave: leave(7) });
    const { unmount } = renderWidget('full');
    await screen.findByText('42/45 present');
    expect(screen.getAllByText('Sick')).toHaveLength(5);
    unmount();
    renderWidget('compact');
    await screen.findByText('42/45 present');
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getAllByText('Sick')).toHaveLength(3);
  });

  it('bn: Bangla digits', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('৪২/৪৫ উপস্থিত')).toBeTruthy();
  });

  it('empty when nobody is marked', async () => {
    serve({ ...BASE, present: 0, late: 0, leave: 0, unmarked: 45, on_leave: [] });
    renderWidget('full');
    expect(await screen.findByText('Staff attendance not taken yet today.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open staff attendance' }).getAttribute('href')).toBe(
      '/attendance/staff',
    );
  });

  it('error: Retry fires a second request', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json(
          { statusCode: 404, message: 'x', timestamp: '', path: '', requestId: '' },
          { status: 404 },
        );
      }),
    );
    renderWidget('full');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it('signal: absences show watch text', async () => {
    serve({ ...BASE, absent: 2, absent_without_leave: 2 });
    renderWidget('full');
    await screen.findByRole('link', { name: 'View staff attendance' });
    expect(screen.getByText('Keep an eye on this')).toBeTruthy();
  });

  it('signal: no absences shows none', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByRole('link', { name: 'View staff attendance' });
    expect(screen.queryByText('Keep an eye on this')).toBeNull();
  });
});
