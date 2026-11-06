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
    // [review r2] No uploader name from the server yet (#3659): a plain label, no id fragment.
    expect(screen.getAllByText('A staff member').length).toBeGreaterThan(0);
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

  // [review] Detail rows carry no section name; unmatched/duplicate rows share date/section/roll.
  it('uses a section-free sentence, a fallback for unknown codes, and no register link for blank rows', async () => {
    const blank = {
      date: '',
      section_id: '',
      roll: 7,
      before: null,
      after: null,
      outcome: 'ERROR',
      record_id: null,
      current: null,
    };
    server.use(
      http.get(`*/attendance/imports/${ID}`, () =>
        HttpResponse.json({
          ...detail,
          rows: [
            { ...blank, code: 'ROLL_NOT_IN_SECTION' },
            { ...blank, code: 'SOMETHING_NEW' },
          ],
        }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: [`/attendance/imports/${ID}`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByRole('heading', { name: /week1\.xlsx/ });
    expect(
      screen.getAllByText('This roll is not in that section — check the roll.').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText('This row could not be used — check it in the sheet.').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/rowError\./)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open register' })).toBeNull();
  });
});
