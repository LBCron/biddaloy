import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const summary = (id: string, file: string, supersedes: string | null) => ({
  id,
  uploaded_by_user_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  file_name: file,
  counts: { new: 3, changed: 2, unchanged: 0, error: 1 },
  supersedes_import_id: supersedes,
  created_at: '2026-11-01T10:00:00Z',
});

function renderList() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/attendance/imports'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/attendance/imports', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists uploads and marks the corrected one superseded', async () => {
    server.use(
      http.get('*/attendance/imports', () =>
        HttpResponse.json({
          items: [summary(B, 'fixed.xlsx', A), summary(A, 'first.xlsx', null)],
          total: 2,
          page: 1,
          limit: 25,
        }),
      ),
    );
    renderList();
    expect(await screen.findByText('first.xlsx')).toBeTruthy();
    expect(screen.getByText('fixed.xlsx')).toBeTruthy();
    expect(screen.getAllByText('Superseded')).toHaveLength(1);
    expect(screen.getAllByText('Current')).toHaveLength(1);
    // [review r2] The server sends no name (#3659): a plain label, never an id fragment.
    expect(screen.getAllByText('A staff member').length).toBeGreaterThan(0);
    expect(screen.queryByText('aaaaaaaa')).toBeNull();
  });

  it('shows the empty state', async () => {
    server.use(
      http.get('*/attendance/imports', () =>
        HttpResponse.json({ items: [], total: 0, page: 1, limit: 25 }),
      ),
    );
    renderList();
    expect(await screen.findByText('No sheets uploaded yet')).toBeTruthy();
  });
});
