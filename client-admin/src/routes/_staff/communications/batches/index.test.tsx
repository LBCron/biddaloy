/**
 * [8.11.9]'s Reminder History list — real route tree, MSW-backed. The
 * page itself is a thin `ListShell` over `GET /reminder/bulk`; what's
 * worth pinning is the row content (name links to detail, counts,
 * `StatusBadge domain="reminderBatch"`), the empty/error states, and
 * the role gate.
 */
import {
  cleanupTestState,
  communicationHandlers,
  errorHandler,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../../help/test-utils';
import { routeTree } from '../../../../routeTree.gen';

function render(role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/communications/batches'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

describe('/communications/batches', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  it('shows the status filter (?) [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    server.use(
      http.get('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }),
      ),
    );
    render();
    await screen.findAllByRole('button', { name: /^Help:/ });
    await expectHelp('communications.reminderHistory.field.status');
  });

  it('lists batches with status badges and a View action per row', async () => {
    server.use(
      http.get('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json({
          data: [
            {
              id: 'batch-1',
              batch_name: 'August dues reminder',
              status: 'PARTIALLY_FAILED',
              total_recipients: 50,
              successful_count: 48,
              failed_count: 2,
              created_at: '2026-08-20T09:00:00.000Z',
            },
            {
              id: 'batch-2',
              batch_name: 'July dues reminder',
              status: 'PROCESSING',
              total_recipients: 10,
              successful_count: 0,
              failed_count: 0,
              created_at: '2026-07-20T09:00:00.000Z',
            },
          ],
          total: 2,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      ),
    );
    render();

    // The name is plain text; the row's own "View" action links to the detail page.
    const row = (await screen.findByText('August dues reminder')).closest('tr');
    expect(row).toBeTruthy();
    const link = within(row as HTMLElement).getByRole<HTMLAnchorElement>('link', {
      name: 'View',
    });
    expect(link.getAttribute('href')).toBe('/communications/batches/batch-1');
    expect(screen.queryByRole('link', { name: 'August dues reminder' })).toBeNull();
    // Status text comes from `StatusBadge domain="reminderBatch"`.
    expect(screen.getByText('Partially failed')).toBeTruthy();
    expect(screen.getByText('Processing')).toBeTruthy();
    // Counts render as their own columns.
    expect(screen.getByText('48')).toBeTruthy();
  });

  it('shows the empty state when no batches exist yet, with no second copy of the header action', async () => {
    server.use(communicationHandlers.listBulkRemindersEmpty);
    render();

    expect(await screen.findByText('No reminder rounds yet.')).toBeTruthy();
    expect(
      screen.getByText('Rounds appear here after you send reminders to many students at once.'),
    ).toBeTruthy();
    // The header's primary is the only "Remind many at once" on the page.
    expect(screen.getAllByRole('button', { name: 'Remind many at once' })).toHaveLength(1);
  });

  it('has one h1, asks for 25 rows and opens the bulk wizard from the header action', async () => {
    let limit: string | null = null;
    server.use(
      http.get('/api/v1/communications/reminder/bulk', ({ request }) => {
        limit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 });
      }),
    );
    render();
    const user = userEvent.setup();

    expect(
      await screen.findAllByRole('heading', { level: 1, name: 'Reminder History' }),
    ).toHaveLength(1);
    await waitFor(() => expect(limit).toBe('25'));

    await user.click(screen.getByRole('button', { name: 'Remind many at once' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bulk Fee Reminders' }),
    ).toBeTruthy();
  });

  it('shows the error state when the list cannot load', async () => {
    // 404 rather than 500: `shouldRetryQuery` retries 5xx twice with
    // backoff, which only slows the test without changing the UI state.
    server.use(errorHandler('get', '/api/v1/communications/reminder/bulk', 404));
    render();

    expect(await screen.findByText('Could not load reminder rounds.')).toBeTruthy();
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route in place with the shared `AccessDeniedState` copy, replacing
  // this route's own hand-rolled "You cannot view reminder history" text.
  it('refuses a TEACHER with the forbidden explanation', async () => {
    render('TEACHER');

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('is axe clean with rows on screen', async () => {
    const { container } = render();

    await screen.findByText('August dues reminder');
    await expect(container).toHaveNoViolations();
  });

  // [8.14.10]: FilterBar migration — typing into the search field writes
  // `search` to the URL and forwards it to the request.
  it('typing in the search box writes search to the URL and the request', async () => {
    let lastSearch: string | null = null;
    server.use(
      http.get('/api/v1/communications/reminder/bulk', ({ request }) => {
        lastSearch = new URL(request.url).searchParams.get('search');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      }),
    );

    const { router } = render();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Search' }), 'August');

    await waitFor(() => expect(lastSearch).toBe('August'), { timeout: 1000 });
    expect(router.state.location.search).toMatchObject({ search: 'August' });
  });

  // [8.14.10]: the Status filter is a real FilterBar `select`, not a
  // hand-rolled one — picking a value writes `status` to the URL/request.
  it('picking a status filters the request', async () => {
    let lastStatus: string | null = null;
    server.use(
      http.get('/api/v1/communications/reminder/bulk', ({ request }) => {
        lastStatus = new URL(request.url).searchParams.get('status');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      }),
    );

    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Completed' }));

    await waitFor(() => expect(lastStatus).toBe('COMPLETED'));
  });

  // [8.14.10]: FilterBar migration — the rows-per-page control changes
  // `limit` and resets `page` in one URL update.
  it('changing rows per page writes limit and resets page', async () => {
    // The page-size select lives in the footer, which only shows while there are rows.
    server.use(
      http.get('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json({
          data: [
            {
              id: 'batch-1',
              batch_name: 'August dues reminder',
              status: 'COMPLETED',
              total_recipients: 5,
              successful_count: 5,
              failed_count: 0,
              created_at: '2026-08-20T09:00:00.000Z',
            },
          ],
          total: 1,
          page: 2,
          limit: 20,
          totalPages: 1,
        }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/communications/batches?page=2'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Reminder rounds' });
    await user.click(await screen.findByRole('combobox', { name: 'Rows per page' }));
    // Option labels render in the tenant's own region digits (Bengali
    // numerals here), independent of the `en` UI locale — same reasoning
    // `invoices/index.test.tsx` documents for its own page-size test.
    await user.click(await screen.findByRole('option', { name: '50' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ limit: 50, page: 1 }));
  });

  // [8.14.10]: `sorting`/`onSortingChange` used to be wired but never
  // reflected in the actual query — clicking a sortable header now
  // threads `sort`/`order` through to the request.
  it('clicking the Name column header writes sort/order to the URL', async () => {
    server.use(
      http.get('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json({
          data: [
            {
              id: 'batch-1',
              batch_name: 'August dues reminder',
              status: 'COMPLETED',
              total_recipients: 5,
              successful_count: 5,
              failed_count: 0,
              created_at: '2026-08-20T09:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        }),
      ),
    );

    const { router } = render();
    const user = userEvent.setup();
    await screen.findByText('August dues reminder');
    await user.click(screen.getByRole('button', { name: 'Name' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ sort: 'name', order: 'desc' }),
    );
  });
});
