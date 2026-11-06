import {
  apiErrorBody,
  cleanupTestState,
  renderWithProviders,
  server,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HrRecordTab } from './hr-record-tab';

afterEach(async () => {
  await cleanupTestState();
});

describe('HrRecordTab', () => {
  it('renders the job and promotion sections, expanded by default', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records', () =>
        HttpResponse.json([
          {
            id: 'hr-1',
            user_id: 'user-1',
            index_no: 'IDX-1',
            salary_code: null,
            mpo_date: null,
            salary_scale: null,
            department: 'Science',
            blood_group: null,
            religion: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ),
      http.get('/api/v1/staff-hr-records/user-1/designation-history', () =>
        HttpResponse.json([
          {
            id: 'hist-1',
            user_id: 'user-1',
            designation_id: 'designation-1',
            effective_date: '2026-01-01',
            end_date: null,
            status: 'REGULAR',
            notes: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ),
      http.get('/api/v1/designations', () =>
        HttpResponse.json([
          { id: 'designation-1', title_en: 'Assistant Teacher', title_bn: null, is_teaching: true },
        ]),
      ),
      http.get('/api/v1/staff-documents/user-1', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-1/family', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-1/address', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-1/experience', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-1/education', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-1/training', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-1/achievement', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-1/language', () => HttpResponse.json([])),
    );

    renderWithProviders(<HrRecordTab userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByText('Science')).toBeTruthy();
    expect(await screen.findByText('Assistant Teacher')).toBeTruthy();
    expect(await screen.findByText('Current')).toBeTruthy();

    // [23.10]/[23.11] gave every remaining stub a real implementation —
    // no "Coming soon" placeholder left anywhere in the tab.
    expect(screen.queryAllByText('Coming soon').length).toBe(0);
    expect((await screen.findAllByText('No rows yet')).length).toBe(7);
  });

  it('shows the job section empty state when the user has no HR record yet', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records', () => HttpResponse.json([])),
      http.get('/api/v1/staff-hr-records/user-2/designation-history', () => HttpResponse.json([])),
      http.get('/api/v1/designations', () => HttpResponse.json([])),
      http.get('/api/v1/staff-documents/user-2', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-2/family', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-2/address', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-2/experience', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-2/education', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-2/training', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-2/achievement', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-2/language', () => HttpResponse.json([])),
    );

    renderWithProviders(<HrRecordTab userId="user-2" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByText('No HR record yet')).toBeTruthy();
    expect(await screen.findByText('No promotions recorded yet')).toBeTruthy();
  });

  it('[76.5.07] saves the card number through the HR record PATCH, and shows a fixed 409 sentence', async () => {
    let patchBody: unknown;
    let conflict = false;
    server.use(
      http.get('/api/v1/staff-hr-records', () =>
        HttpResponse.json([{ id: 'hr-1', user_id: 'user-1', card_no: null }]),
      ),
      http.patch('/api/v1/staff-hr-records/hr-1', async ({ request }) => {
        patchBody = await request.json();
        return conflict
          ? HttpResponse.json(
              {
                ...apiErrorBody(409, 'x', '/api/v1/staff-hr-records/hr-1'),
                details: { code: 'CARD_NO_TAKEN' },
              },
              { status: 409 },
            )
          : HttpResponse.json({ id: 'hr-1', user_id: 'user-1', card_no: 'AB-1' });
      }),
      http.get('*/designation-history', () => HttpResponse.json([])),
      http.get('/api/v1/designations', () => HttpResponse.json([])),
      http.get('/api/v1/staff-documents/user-1', () => HttpResponse.json([])),
      http.get('/api/v1/staff/user-1/:kind', () => HttpResponse.json([])),
    );
    renderWithProviders(<HrRecordTab userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Card number');
    await user.type(input, 'AB-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toEqual({ card_no: 'AB-1' }));

    conflict = true;
    await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('This card number already belongs to another staff member.'),
    ).toBeTruthy();
  });
});
