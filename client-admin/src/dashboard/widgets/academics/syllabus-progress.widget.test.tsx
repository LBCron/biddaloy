import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget from './syllabus-progress.widget';

const URL = '/api/v1/dashboard/widgets/syllabus-progress';

const cls = (id: string, name: string, done: number, percentage: number) => ({
  class_id: id,
  class_name: name,
  done,
  in_progress: 2,
  total: 100,
  percentage,
});

const BASE = {
  classes: [cls('c6', '6', 80, 80), cls('c8', '8', 41, 41), cls('c9', '9', 65, 65)],
  overall: { done: 181, total: 300, percentage: 60 },
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

describe('syllabus-progress widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('full: average from overall, least-covered class, one bar per class, no pace marker, noPace line, link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('60%')).toBeTruthy();
    expect(screen.getByText('60% covered on average')).toBeTruthy();
    expect(screen.getByText('Class 8 has covered the least (41%).')).toBeTruthy();
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
    expect(screen.queryByTestId('bar-target')).toBeNull();
    expect(screen.queryByText(/^(Behind|On track)$/)).toBeNull();
    expect(
      screen.getByText('Comparison with the expected pace comes with study plans.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View syllabus' }).getAttribute('href')).toBe(
      '/academics/syllabus',
    );
  });

  it('with a plan: expected marker, behind class highlighted with its gap, "N classes behind"', async () => {
    serve({
      classes: [
        { ...cls('c6', '6', 80, 80), expected_percentage: 60 },
        { ...cls('c8', '8', 41, 41), expected_percentage: 60 },
        { ...cls('c9', '9', 65, 65), expected_percentage: null },
      ],
      overall: BASE.overall,
      behind_count: 1,
    });
    renderWidget('full');
    expect(await screen.findByText('1 class is behind the plan.')).toBeTruthy();
    expect(screen.getByText('Behind')).toBeTruthy();
    expect(screen.getAllByTestId('bar-target').length).toBeGreaterThan(0);
    expect(screen.getByText('19% behind')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '8' }).getAttribute('aria-valuetext')).toContain(
      'Average expected by today: 60%',
    );
    expect(
      screen.queryByText('Comparison with the expected pace comes with study plans.'),
    ).toBeNull();
  });

  it('with a plan and nobody behind: on-pace line', async () => {
    serve({
      classes: [{ ...cls('c6', '6', 80, 80), expected_percentage: 60 }],
      overall: BASE.overall,
      behind_count: 0,
    });
    renderWidget('full');
    expect(await screen.findByText('No class is behind the plan.')).toBeTruthy();
    expect(screen.getByText('On track')).toBeTruthy();
  });

  it('table toggle lists every class', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('60%');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getByText('Covered')).toBeTruthy();
  });

  it('compact: average and least covered, no bars', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText(/60% covered on average/)).toBeTruthy();
    expect(screen.getByText(/Class 8 has covered the least/)).toBeTruthy();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('empty: no topics → reason and add link', async () => {
    serve({ classes: [], overall: { done: 0, total: 0, percentage: 0 } });
    renderWidget('full');
    expect(await screen.findByText('No syllabus topics yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add syllabus' }).getAttribute('href')).toBe(
      '/academics/syllabus',
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
    expect(await screen.findByText('৬০%')).toBeTruthy();
  });
});
