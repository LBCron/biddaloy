import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useCoordinationOverview, useNotifyCoordinatedTeachers } from './coordination';

/** [83.3.4] MSW tests for the My coordination hooks. */
describe('useCoordinationOverview', () => {
  it('sends the date when given, none when not', async () => {
    const seen: string[] = [];
    server.use(
      http.get('/api/v1/coordination/overview', ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ date: '2026-10-20', classes: [] });
      }),
    );
    const dated = renderHookWithProviders(() => useCoordinationOverview('2026-10-20'), {
      tenantId: 't1',
    });
    await waitFor(() => expect(dated.result.current.isSuccess).toBe(true));
    const today = renderHookWithProviders(() => useCoordinationOverview(), { tenantId: 't1' });
    await waitFor(() => expect(today.result.current.isSuccess).toBe(true));
    expect(seen).toEqual(['?date=2026-10-20', '']);
  });
});

describe('useNotifyCoordinatedTeachers', () => {
  it('posts {userIds, message} with an Idempotency-Key, once on a 500', async () => {
    let body: unknown;
    let key: string | null = null;
    let calls = 0;
    server.use(
      http.post('/api/v1/coordination/alerts', async ({ request }) => {
        calls += 1;
        body = await request.json();
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json(apiErrorBody(500, 'boom', '/api/v1/coordination/alerts'), {
          status: 500,
        });
      }),
    );
    const { result } = renderHookWithProviders(() => useNotifyCoordinatedTeachers(), {
      tenantId: 't1',
    });
    result.current.mutate({ userIds: ['u1', 'u2'], message: 'Marks by Thursday.' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(body).toEqual({ userIds: ['u1', 'u2'], message: 'Marks by Thursday.' });
    expect(key).toBeTruthy();
    expect(calls).toBe(1);
  });
});
