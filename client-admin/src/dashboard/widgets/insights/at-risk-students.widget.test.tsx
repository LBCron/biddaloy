import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget from './at-risk-students.widget';

const URL = '/api/v1/dashboard/widgets/at-risk-students';

const student = (i: number, signals: unknown[]) => ({
  student_id: `stu-${i}`,
  full_name: `Student ${i}`,
  class_name: '8',
  section_name: 'A',
  signals,
});
const FIRST = student(0, [
  { kind: 'ABSENT_STREAK', value: 4 },
  { kind: 'OVERDUE', value: 65 },
  { kind: 'FAILED_SUBJECTS', value: 1, subjects: [{ name_en: 'Mathematics', name_bn: 'গণিত' }] },
]);
const OTHER = (i: number) =>
  student(i, [
    { kind: 'LOW_ATTENDANCE', value: 70 },
    { kind: 'OVERDUE', value: 70 },
  ]);
const BASE = {
  state: 'READY',
  computed_at: '2026-10-07T18:30:04Z',
  stale: false,
  thresholds: { absentStreakDays: 3, monthlyAttendancePct: 75, failedSubjects: 1, overdueDays: 60 },
  total: 12,
  week_ago_total: 9,
  new_this_week: 3,
  students: [FIRST, ...Array.from({ length: 11 }, (_, i) => OTHER(i + 1))],
};

function renderWidget(variant: 'full' | 'compact' | 'tile', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="L" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'EXECUTIVE',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));
const dataRows = () => screen.getAllByRole('row').slice(1);

describe('at-risk-students widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('full (bn): count in Bangla digits', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('১২ জন')).toBeTruthy();
  });

  it('full (en): 5 rows, chips, week sentence and rule line', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('12 students')).toBeTruthy();
    expect(screen.getByText(/3 more than last week/)).toBeTruthy();
    expect(dataRows()).toHaveLength(5);
    const first = within(dataRows()[0]!);
    expect(first.getByText('Student 0')).toBeTruthy();
    expect(first.getByText('8, A')).toBeTruthy();
    expect(first.getByText('Absent 4 days in a row')).toBeTruthy();
    expect(first.getByText('65 days overdue')).toBeTruthy();
    expect(first.getByText('Failed Mathematics')).toBeTruthy();
    expect(screen.getByText('Listed when any 2 signals match.')).toBeTruthy();
    expect(screen.queryByText('stu-0')).toBeNull();
    expect(screen.queryByText('OVERDUE')).toBeNull();
  });

  it('See all shows every row, Show fewer returns, focus stays on the button', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('12 students');
    await userEvent.click(screen.getByRole('button', { name: 'See all 12' }));
    expect(dataRows()).toHaveLength(12);
    const fewer = screen.getByRole('button', { name: 'Show fewer' });
    expect(fewer.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(fewer);
    await userEvent.click(fewer);
    expect(dataRows()).toHaveLength(5);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'See all 12' }));
  });

  it('an unknown signal kind renders nothing', async () => {
    serve({
      ...BASE,
      total: 1,
      students: [
        student(0, [
          { kind: 'MYSTERY', value: 1 },
          { kind: 'OVERDUE', value: 70 },
        ]),
      ],
    });
    renderWidget('full');
    await screen.findByText('Student 0');
    expect(screen.queryByText('MYSTERY')).toBeNull();
    expect(screen.getByText('70 days overdue')).toBeTruthy();
  });

  it('COMPUTING shows the computing text and no table', async () => {
    serve({ ...BASE, state: 'COMPUTING', students: [], total: 0 });
    renderWidget('full');
    expect(
      await screen.findByText('The list is being prepared. Check back in a minute.'),
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('stale shows the warning badge', async () => {
    serve({ ...BASE, stale: true });
    renderWidget('full');
    expect(await screen.findByText('These figures may be out of date.')).toBeTruthy();
  });

  it('compact: count and trend in the header, list in the body', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('12 students')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('tile: label, count and a bad trend when up', async () => {
    serve(BASE);
    renderWidget('tile');
    expect(await screen.findByText('12')).toBeTruthy();
    expect(screen.getByText('At-risk students')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/3 more than last week/).parentElement?.className).toContain(
      'text-status-overdue-fg',
    );
  });

  it('empty links to the dashboard settings', async () => {
    serve({ ...BASE, total: 0, students: [], week_ago_total: 0 });
    renderWidget('full');
    expect(await screen.findByText('No student matches 2 signals right now.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Change thresholds' }).getAttribute('href')).toBe(
      '/settings',
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

  it('signal: students at risk show needs-action text', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByRole('table');
    expect(screen.getByText('Needs action')).toBeTruthy();
  });

  it('signal: computing shows none', async () => {
    serve({ ...BASE, state: 'COMPUTING', students: [], total: 0 });
    renderWidget('full');
    // Wait for the data render (the heading is already there while loading).
    await screen.findByText('The list is being prepared. Check back in a minute.');
    expect(document.querySelector('[data-signal]')).toBeNull();
    expect(screen.queryByText('Needs action')).toBeNull();
  });

  it('tile carries the signal too (phone key numbers, #3594)', async () => {
    serve(BASE);
    renderWidget('tile');
    const marker = await waitFor(() => {
      const el = document.querySelector('[data-signal]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(marker.getAttribute('data-signal')).toBe('critical');
    expect(marker.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(marker.querySelector('.sr-only')!.textContent).toBe('Needs action');
  });
});
