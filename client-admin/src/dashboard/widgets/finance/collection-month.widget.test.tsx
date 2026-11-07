import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget from './collection-month.widget';

const URL = '/api/v1/dashboard/widgets/collection-month';

const BASE = {
  month: '2026-10',
  as_of: '2026-10-07',
  received: 882000,
  billed_for_month: 1210000,
  received_pct: 73,
  last_month_same_point: {
    as_of: '2026-09-07',
    received: 790000,
    billed_for_month: 1215000,
    received_pct: 65,
  },
  last_year_same_point: null,
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

describe('collection-month widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('full (bn): amount, meter with marker, ahead sentence, no last year, dues link', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('৳৮,৮২,০০০.০০')).toBeTruthy();
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('73');
    expect(meter.getAttribute('aria-valuetext')).toContain('৬৫%');
    expect(screen.getByText('গত মাসের এই সময়ের চেয়ে ৮ এগিয়ে।')).toBeTruthy();
  });

  it('full (en): sentence, lastYearNone, link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('8 ahead of the same time last month.')).toBeTruthy();
    expect(screen.getByText('Same time last year: —')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View dues' }).getAttribute('href')).toBe('/fees/dues');
  });

  it('last year present shows its amount', async () => {
    serve({ ...BASE, last_year_same_point: { ...BASE.last_month_same_point, received: 700000 } });
    renderWidget('full');
    expect(await screen.findByText(/Same time last year: .*7,00,000|700,000/)).toBeTruthy();
  });

  it('behind shows the behind sentence; tile trend is bad', async () => {
    serve({ ...BASE, received_pct: 60 });
    const { unmount } = renderWidget('full');
    expect(await screen.findByText('5 behind the same time last month.')).toBeTruthy();
    unmount();
    renderWidget('tile');
    expect(await screen.findByText('60%')).toBeTruthy();
    expect(screen.getByText('5 vs last month').parentElement?.className).toContain(
      'text-status-overdue-fg',
    );
    expect(screen.getByText("This month's collection")).toBeTruthy();
  });

  it('table toggle shows four figure rows', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('8 ahead of the same time last month.');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getByText('Billed')).toBeTruthy();
  });

  it('compact: title, pct and delta in the header', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('73%')).toBeTruthy();
    expect(screen.getByText("This month's collection")).toBeTruthy();
    expect(screen.getByText('8 vs last month')).toBeTruthy();
  });

  it('empty when nothing is billed → generate link', async () => {
    serve({ ...BASE, billed_for_month: 0, received_pct: null });
    renderWidget('full');
    expect(await screen.findByText('No fees billed this month yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Generate fees' }).getAttribute('href')).toBe(
      '/fees/generate',
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

  it.each([
    [50, 'Needs action'],
    [60, 'Behind'],
    [65, 'On track'],
    [73, 'Ahead'],
  ])('signal at %s pct received: %s', async (pct, label) => {
    serve({ ...BASE, received_pct: pct });
    renderWidget('full');
    expect(await screen.findByText(label, { selector: '.sr-only' })).toBeTruthy();
  });

  it('shows no signal when nothing is billed', async () => {
    serve({ ...BASE, billed_for_month: 0, received_pct: null });
    renderWidget('full');
    await screen.findByText('No fees billed this month yet.');
    expect(document.querySelector('.sr-only')).toBeNull();
  });
});
