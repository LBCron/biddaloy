import '@biddaloy/ui/test';

import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { tenantTodayIso } from '@biddaloy/ui/utils';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget from './mark-entry-progress.widget';

const URL = '/api/v1/dashboard/widgets/mark-entry-progress';

// Counted from the school's today (Asia/Dhaka), as the widget does: the
// browser's date is a day behind it between 18:00 and 24:00 UTC.
const inDays = (n: number) => {
  const d = new Date(`${tenantTodayIso(REGION_BD_EN)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const cls = (id: string, name: string, submitted: number, percentage: number) => ({
  class_id: id,
  class_name: name,
  exam_id: 'exam-1',
  submitted,
  total: 50,
  percentage,
});

const BASE = {
  exam_name: 'Half Yearly',
  mark_entry_deadline: null as string | null,
  exam_ended_days_ago: null,
  overall: { submitted: 154, total: 200, percentage: 77 },
  classes: [
    cls('c6', '6', 45, 90),
    cls('c7', '7', 40, 80),
    cls('c8', '8', 21, 42),
    cls('c9', '9', 38, 76),
    cls('c10', '10', 10, 20),
  ],
  lowest_class_id: 'c10',
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

describe('mark-entry-progress widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('full: exam name, overall percent, furthest-behind class, 5 bars in order, link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('Half Yearly')).toBeTruthy();
    expect(screen.getByText('77%')).toBeTruthy();
    expect(screen.getByText(/Class 10 is furthest behind\./)).toBeTruthy();
    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual(['6', '7', '8', '9', '10']);
    const link = screen.getByRole('link', { name: "View class 10's missing subjects" });
    expect(link.getAttribute('href')).toBe('/marks');
  });

  it('highlights only the lowest class (semibold label)', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('Half Yearly');
    const label = (name: string) =>
      within(screen.getByRole('progressbar', { name }).closest('li')!).getByText(name, {
        selector: 'span.truncate',
      });
    expect(label('10').className).toContain('font-semibold');
    expect(label('6').className).not.toContain('font-semibold');
  });

  it('deadline 3 days ahead → "Last day in 3 days"', async () => {
    serve({ ...BASE, mark_entry_deadline: inDays(3) });
    renderWidget('full');
    expect(await screen.findByText(/Last day in 3 days/)).toBeTruthy();
  });

  it('past deadline → deadlinePassed', async () => {
    serve({ ...BASE, mark_entry_deadline: inDays(-2) });
    renderWidget('full');
    expect(await screen.findByText(/Deadline passed on/)).toBeTruthy();
  });

  it('signal: past deadline = needs action, 2 days left = watch, far/none = no signal, 100% = done', async () => {
    const run = async (body: object, text: string | null) => {
      serve(body);
      const { unmount } = renderWidget('full');
      await screen.findByText('Half Yearly');
      if (text) expect(await screen.findByText(text)).toBeTruthy();
      else
        expect(
          screen.queryByText(/Needs action|Deadline is near|Done|Past the deadline/),
        ).toBeNull();
      unmount();
      await cleanupTestState();
    };
    await run({ ...BASE, mark_entry_deadline: inDays(-1) }, 'Past the deadline');
    await run({ ...BASE, mark_entry_deadline: inDays(2) }, 'Deadline is near');
    await run({ ...BASE, mark_entry_deadline: inDays(10) }, null);
    await run(BASE, null);
    await run(
      {
        ...BASE,
        mark_entry_deadline: inDays(-1),
        overall: { submitted: 200, total: 200, percentage: 100 },
      },
      'Done',
    );
  });

  it('no deadline → no deadline text', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('Half Yearly');
    expect(screen.queryByText(/Last day in|Deadline passed/)).toBeNull();
  });

  it('table toggle lists every class', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('Half Yearly');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(6);
    expect(screen.getByText('Submitted')).toBeTruthy();
  });

  it('compact: compactValue and furthest-behind, no bars', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('77% submitted')).toBeTruthy();
    expect(screen.getByText(/Class 10 is furthest behind\./)).toBeTruthy();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('empty: no classes → empty reason and action link', async () => {
    serve({ ...BASE, exam_name: null, classes: [], lowest_class_id: null });
    renderWidget('full');
    expect(await screen.findByText('No exam is taking marks right now.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open mark entry' }).getAttribute('href')).toBe(
      '/marks',
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

  it('bn digits', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('৭৭%')).toBeTruthy();
    expect(screen.getByText(/10 শ্রেণি সবচেয়ে পিছিয়ে/)).toBeTruthy();
  });
});
