import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget from './attendance-today.widget';

const URL = '/api/v1/dashboard/widgets/attendance-today';

const series = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, '0')}`,
  percentage: i === 3 ? null : 86.8 + (i % 6),
}));
const BASE = {
  date: '2026-10-07',
  is_working_day: true,
  percentage: 91.4,
  counts: { present: 820, late: 14, absent: 79, leave: 6, unmarked: 31 },
  sections_total: 24,
  pending_sections: [{ section_id: 's1', class_name: '7', section_name: 'B' }],
  week_ago_percentage: 89.4,
  series,
};

function renderWidget(variant: 'full' | 'compact' | 'tile', locale = 'en') {
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

describe('attendance-today widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('full: value, week sentence, range summary, pending link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('91.4%')).toBeTruthy();
    expect(screen.getByText('2 higher than last week.')).toBeTruthy();
    expect(screen.getByText(/Lowest in 30 days 86\.8%, highest 91\.8%/)).toBeTruthy();
    const link = screen.getByRole('link', { name: '1 section left, view' });
    expect(link.getAttribute('href')).toBe('/attendance');
  });

  it('table toggle lists 30 rows and a null day shows "No register"', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('91.4%');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(31);
    expect(screen.getByText('No register')).toBeTruthy();
    expect(screen.getByText('1st September, 2026')).toBeTruthy();
  });

  it('bn: Bangla digits', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('৯১.৪%')).toBeTruthy();
  });

  it('compact: header has title, value, sentence; body hidden until expanded', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('91.4%')).toBeTruthy();
    expect(screen.getByText("Today's attendance")).toBeTruthy();
    expect(screen.getByText('2 higher than last week.')).toBeTruthy();
    expect(screen.queryByText('30 days ago')).toBeNull();
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('30 days ago')).toBeTruthy();
  });

  it('tile: label, value and sparkline only', async () => {
    serve(BASE);
    renderWidget('tile');
    expect(await screen.findByText('91.4%')).toBeTruthy();
    expect(screen.getByText("Today's attendance")).toBeTruthy();
    expect(screen.getByRole('img', { name: /Attendance over 30 days/ })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('zero pending shows "every section is marked"', async () => {
    serve({ ...BASE, pending_sections: [] });
    renderWidget('full');
    expect(await screen.findByText('Every section is marked')).toBeTruthy();
  });

  it('non-working day shows closedToday and no value', async () => {
    serve({ ...BASE, is_working_day: false, percentage: null });
    renderWidget('full');
    expect(await screen.findByText('No school today.')).toBeTruthy();
    expect(screen.queryByText('91.4%')).toBeNull();
  });

  it('empty when nothing is marked yet', async () => {
    serve({
      ...BASE,
      percentage: null,
      counts: { present: 0, late: 0, absent: 0, leave: 0, unmarked: 855 },
    });
    renderWidget('full');
    expect(await screen.findByText('No attendance taken yet today.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Take attendance' }).getAttribute('href')).toBe(
      '/attendance',
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

  it('signal: low attendance shows watch text', async () => {
    serve({ ...BASE, percentage: 60 });
    renderWidget('full');
    await screen.findByText('60.0%');
    expect(screen.getByText('Keep an eye on this')).toBeTruthy();
  });

  it('signal: healthy attendance shows none', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('91.4%');
    expect(screen.queryByText('Keep an eye on this')).toBeNull();
  });
});
