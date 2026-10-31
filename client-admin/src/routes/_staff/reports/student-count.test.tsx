import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const BANBEIS_ID = '11111111-1111-4111-8111-111111111111';

const entry = (id: string, key: string, systemKey: string | null) => ({
  id,
  key,
  name_en: key,
  name_bn: key,
  version_id: 'v1',
  system_template_key: systemKey,
});

/** The catalogue of a role that may run the BANBEIS report: it sits in a folder among others. */
const withBanbeis = [
  { folder: null, reports: [entry('other', 'my-copy', null)] },
  {
    folder: 'Students',
    reports: [entry(BANBEIS_ID, 'student-count-banbeis', 'student-count-banbeis')],
  },
];

function serve(catalogue: unknown) {
  server.use(
    http.get('/api/v1/reports/catalogue', () => HttpResponse.json(catalogue as never)),
    // The runner this page hands over to: an empty answer is enough here.
    http.post('/api/v1/reports/run', () =>
      HttpResponse.json({
        columns: [],
        rows: [],
        masked: [],
        suppressed: false,
        truncated: false,
        total_rows: 0,
        page: 1,
        page_size: 100,
        total_pages: 1,
        run_id: '33333333-3333-4333-8333-333333333333',
      }),
    ),
  );
}

function renderBookmark(role = 'ADMIN', entryPath = '/reports/student-count') {
  return renderWithRouter(routeTree, {
    initialEntries: [entryPath],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

/** `/reports/student-count` is a redirect to the ready BANBEIS report [8.15.50, D23]. */
describe('/reports/student-count', () => {
  afterEach(async () => {
    localStorage.clear();
    await cleanupTestState();
  });

  it('finds the BANBEIS report by its template key and replaces itself with the runner', async () => {
    serve(withBanbeis);
    const { router } = renderBookmark();

    await waitFor(() => expect(router.state.location.pathname).toBe(`/reports/${BANBEIS_ID}`));
    // "Replace", not "push": the history keeps one entry, so Back never lands on this redirect.
    expect(router.history.length).toBe(1);
  });

  it('says plainly that the report is not found for a role that cannot run it', async () => {
    serve([{ folder: null, reports: [entry('other', 'my-copy', null)] }]);
    const { router } = renderBookmark('TEACHER');

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Student count report not found for your role',
      }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/reports/student-count');
    expect(screen.getByRole('button', { name: 'All reports' })).toBeTruthy();
  });

  it('shows the same plain page in Bangla', async () => {
    serve([]);
    renderWithRouter(routeTree, {
      initialEntries: ['/reports/student-count'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'bn',
    });

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'আপনার ভূমিকার জন্য ছাত্রসংখ্যার রিপোর্ট পাওয়া যায়নি',
      }),
    ).toBeTruthy();
  });
});
