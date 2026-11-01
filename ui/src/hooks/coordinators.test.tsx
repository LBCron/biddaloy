import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useAssignCoordinators, useCoordinators, useRemoveCoordinator } from './coordinators';

/** [83.2.5] MSW tests for the coordinator hooks. */
const row = {
  id: 'c1',
  teacher_id: 't1',
  teacher_name: 'Rahim Uddin',
  class_id: 'k6',
  class_name: 'Class 6',
  subject_id: null,
  subject_name: null,
  assigned_by_name: 'Head Admin',
  created_at: '2026-10-01T04:00:00.000Z',
};

describe('useCoordinators', () => {
  it('lists by classId', async () => {
    let query = '';
    server.use(
      http.get('/api/v1/coordinators', ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json([row]);
      }),
    );
    const { result } = renderHookWithProviders(() => useCoordinators({ classId: 'k6' }), {
      tenantId: 't1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(query).toBe('?classId=k6');
    expect(result.current.data).toEqual([row]);
  });
});

describe('useAssignCoordinators', () => {
  it('posts {teacherId, classIds, subjectId} with an Idempotency-Key', async () => {
    let body: unknown;
    let key: string | null = null;
    server.use(
      http.post('/api/v1/coordinators', async ({ request }) => {
        body = await request.json();
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json([row], { status: 201 });
      }),
    );
    const { result } = renderHookWithProviders(() => useAssignCoordinators(), { tenantId: 't1' });
    result.current.mutate({ teacherId: 't1', classIds: ['k6', 'k7'], subjectId: 'm1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ teacherId: 't1', classIds: ['k6', 'k7'], subjectId: 'm1' });
    expect(key).toBeTruthy();
  });

  it('does not retry a 500 (Rule 25)', async () => {
    let calls = 0;
    server.use(
      http.post('/api/v1/coordinators', () => {
        calls += 1;
        return HttpResponse.json(apiErrorBody(500, 'boom', '/api/v1/coordinators'), {
          status: 500,
        });
      }),
    );
    const { result } = renderHookWithProviders(() => useAssignCoordinators(), { tenantId: 't1' });
    result.current.mutate({ teacherId: 't1', classIds: ['k6'] });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });
});

describe('useRemoveCoordinator', () => {
  it('deletes the row by id', async () => {
    let path = '';
    server.use(
      http.delete('/api/v1/coordinators/:id', ({ request }) => {
        path = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHookWithProviders(() => useRemoveCoordinator(), { tenantId: 't1' });
    result.current.mutate('c1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe('/api/v1/coordinators/c1');
  });
});
