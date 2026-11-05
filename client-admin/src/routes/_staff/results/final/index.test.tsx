/**
 * [70.5.3] `/results/final`: a line per class with its status, Start for a class with none yet
 * (disabled with a reason while no exam of it is published), Open for the others.
 */
import { cleanupTestState, examFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

// The route-permission entries for these pages land with the nav/route-map ticket (#3421). Until then
// the closed-by-default gate would refuse them, so the same two entries are added here.
vi.mock('../../../../route-permissions', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../../route-permissions')>();
  const { Permission } = await import('@biddaloy/shared');
  return {
    ...mod,
    STAFF_ROUTE_PERMISSIONS: {
      ...mod.STAFF_ROUTE_PERMISSIONS,
      '/_staff/results/final/': Permission.RESULT_PROCESS,
      '/_staff/results/final/$finalResultId': Permission.RESULT_PROCESS,
    },
  };
});

type Row = {
  class: { id: string; name: string };
  final_result_id: string | null;
  status: string;
  published_at: string | null;
};

const row = (id: string, name: string, status: string, fr: string | null = null): Row => ({
  class: { id, name },
  final_result_id: fr,
  status,
  published_at: null,
});

function mock(rows: Row[], publishedClassIds: string[]) {
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [{ id: 'y1', name: '2026', is_current: true }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/final-results', () => HttpResponse.json(rows)),
    http.get('/api/v1/exams', () =>
      HttpResponse.json({
        data: publishedClassIds.map((cid) =>
          examFactory({ id: `e-${cid}`, class_id: cid, status: 'PUBLISHED' }),
        ),
        total: publishedClassIds.length,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

const render = () =>
  renderWithRouter(routeTree, {
    initialEntries: ['/results/final'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });

describe('/results/final', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows each class with its status and the right action', async () => {
    mock(
      [
        row('c6', 'Class 6', 'PUBLISHED', 'fr-6'),
        row('c7', 'Class 7', 'PROCESSED', 'fr-7'),
        row('c8', 'Class 8', 'NOT_SET_UP'),
      ],
      ['c8'],
    );
    render();

    await screen.findByText('Class 6');
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Built').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not set up').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Open' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Start' }).length).toBeGreaterThan(0);
  });

  it('says why Start is off when no exam of the class is published', async () => {
    mock([row('c8', 'Class 8', 'NOT_SET_UP')], []);
    render();

    await screen.findByText(/No exam result of this class is published yet/);
    const start = screen.getAllByRole('button', { name: 'Start' })[0] as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getAllByRole('link', { name: 'Go to results' }).length).toBeGreaterThan(0);
  });

  it('finds a published exam past the first page of exams', async () => {
    mock([row('c8', 'Class 8', 'NOT_SET_UP')], []);
    const pages: string[] = [];
    server.use(
      http.get('/api/v1/exams', ({ request }) => {
        const page = new URL(request.url).searchParams.get('page') ?? '1';
        pages.push(page);
        const data =
          page === '1'
            ? Array.from({ length: 100 }, (_, i) =>
                examFactory({ id: `d${i}`, class_id: 'c1', status: 'DRAFT' }),
              )
            : [examFactory({ id: 'p1', class_id: 'c8', status: 'PUBLISHED' })];
        return HttpResponse.json({
          data,
          total: 101,
          page: Number(page),
          limit: 100,
          totalPages: 2,
        });
      }),
    );
    render();

    await screen.findByText('Class 8');
    await waitFor(() => expect(pages).toEqual(['1', '2']));
    await waitFor(() =>
      expect(
        (screen.getAllByRole('button', { name: 'Start' })[0] as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(screen.queryByText(/No exam result of this class is published yet/)).toBeNull();
  });

  it('turns the other Start buttons off while one class is starting', async () => {
    mock([row('c8', 'Class 8', 'NOT_SET_UP'), row('c9', 'Class 9', 'NOT_SET_UP')], ['c8', 'c9']);
    server.use(
      http.post('/api/v1/final-results', async () => {
        await new Promise((r) => setTimeout(r, 400));
        return HttpResponse.json({ message: 'no' }, { status: 500 });
      }),
    );
    render();
    await screen.findByText('Class 8');
    await waitFor(() => {
      const b = screen.getAllByRole('button', { name: 'Start' })[0] as HTMLButtonElement;
      expect(b.disabled).toBe(false);
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'Start' })[0] as HTMLElement);
    await waitFor(() => {
      const others = screen
        .getAllByRole('button', { name: 'Start' })
        .filter((b) => b.getAttribute('aria-busy') !== 'true');
      expect(others.length).toBeGreaterThan(0);
      expect(others.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    });
  });

  it('shows the empty state when the year has no classes', async () => {
    mock([], []);
    render();
    await screen.findByText('No class has a final result set up yet');
  });

  it('Start creates the final result, then opens its page', async () => {
    mock([row('c8', 'Class 8', 'NOT_SET_UP')], ['c8']);
    let body: unknown;
    server.use(
      http.post('/api/v1/final-results', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'fr-8' }, { status: 201 });
      }),
      http.get('/api/v1/final-results/fr-8', () =>
        HttpResponse.json({
          id: 'fr-8',
          class: { id: 'c8', name: 'Class 8' },
          academic_year: { id: 'y1', name: '2026' },
          status: 'DRAFT',
          mode: 'WEIGHTED',
          best_of_count: null,
          rounding: 'WHOLE',
          fail_if_any_exam_fails: false,
          weights: [],
          published_at: null,
          counts: { students: 0, failed: 0 },
        }),
      ),
    );
    render();

    await screen.findByText('Class 8');
    await waitFor(() => {
      const b = screen.getAllByRole('button', { name: 'Start' })[0] as HTMLButtonElement;
      expect(b.disabled).toBe(false);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Start' })[0] as HTMLElement);

    await screen.findByRole('tab', { name: 'Setup' });
    expect(body).toEqual({ class_id: 'c8', academic_year_id: 'y1' });
  });
});
