import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const ID = '11111111-1111-4111-8111-111111111111';
const SECTION = '33333333-3333-4333-8333-333333333333';
const RECORD = '44444444-4444-4444-8444-444444444444';

const detail = {
  id: ID,
  uploaded_by_user_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  file_name: 'week1.xlsx',
  counts: { new: 1, changed: 1, unchanged: 0, error: 1 },
  supersedes_import_id: null,
  created_at: '2026-11-01T10:00:00Z',
  rows: [
    {
      date: '2026-11-01',
      section_id: SECTION,
      roll: 4,
      before: 'ABSENT',
      after: 'PRESENT',
      outcome: 'CHANGED',
      record_id: RECORD,
      current: 'LATE',
    },
    {
      date: '2026-11-01',
      section_id: SECTION,
      roll: 9,
      before: null,
      after: null,
      outcome: 'ERROR',
      record_id: null,
      code: 'BAD_STATUS',
      current: null,
    },
  ],
};

function renderDetail() {
  server.use(
    http.get(`*/attendance/imports/${ID}`, () => HttpResponse.json(detail)),
    http.get('*/attendance/imports', () =>
      HttpResponse.json({ items: [], total: 0, page: 1, limit: 25 }),
    ),
    http.get(`*/attendance/records/${RECORD}/history`, () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
    ),
  );
  return renderWithRouter(routeTree, {
    initialEntries: [`/attendance/imports/${ID}`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/attendance/imports/$importId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows file, corrected-file link, and open-register links', async () => {
    renderDetail();
    expect(await screen.findByRole('heading', { name: /week1\.xlsx/ })).toBeTruthy();
    const corrected = screen.getAllByRole('link', { name: 'Upload corrected file' })[0];
    expect(corrected?.getAttribute('href')).toContain(`supersedes=${ID}`);
    const register = screen.getAllByRole('link', { name: 'Open register' })[0];
    expect(register?.getAttribute('href')).toContain(`/attendance/${SECTION}`);
    expect(register?.getAttribute('href')).toContain('date=2026-11-01');
  });

  it('filters to errors and opens record history for a mark changed later', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByRole('heading', { name: /week1\.xlsx/ });
    await user.click(screen.getAllByRole('button', { name: /Changed later/ })[0]!);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Errors' }));
    expect(screen.queryByRole('button', { name: /Changed later/ })).toBeNull();
    expect(within(document.body).getAllByText(/not understood/).length).toBeGreaterThan(0);
  });
});
