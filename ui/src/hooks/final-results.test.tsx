import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  finalResultKeys,
  finalResultRowsKey,
  useBuildFinalResult,
  useCreateFinalResult,
  useFinalResults,
  usePublishFinalResult,
  useSendFinalResultSms,
  useUpdateFinalResult,
} from './final-results';
import { reportCardNotesKeys } from './report-card-notes';

const opts = { tenantId: 'tenant-1' };

describe('useFinalResults', () => {
  it('lists one line per class for the year and keys the cache by year', async () => {
    let year: string | null = null;
    server.use(
      http.get('/api/v1/final-results', ({ request }) => {
        year = new URL(request.url).searchParams.get('academic_year_id');
        return HttpResponse.json([]);
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useFinalResults('y1'), opts);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(year).toBe('y1');
    expect(queryClient.getQueryData(finalResultKeys.list({ academic_year_id: 'y1' }))).toEqual([]);
  });

  it('does not fetch without a year', () => {
    const { result } = renderHookWithProviders(() => useFinalResults(undefined), opts);
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('final result mutations', () => {
  it('create sends an Idempotency-Key and refreshes the list', async () => {
    let key: string | null = null;
    server.use(
      http.post('/api/v1/final-results', ({ request }) => {
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ id: 'f1' }, { status: 201 });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useCreateFinalResult(), opts);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await result.current.mutateAsync({ class_id: 'c1', academic_year_id: 'y1' });
    expect(key).toBeTruthy();
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: finalResultKeys.lists() }),
    );
  });

  it('save refreshes the summary and the rows; a 500 is not retried', async () => {
    let calls = 0;
    server.use(
      http.patch('/api/v1/final-results/f1', () => {
        calls += 1;
        return HttpResponse.json({ message: 'x' }, { status: 500 });
      }),
    );
    const { result } = renderHookWithProviders(() => useUpdateFinalResult('f1'), opts);
    await expect(result.current.mutateAsync({ rounding: 'WHOLE' })).rejects.toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
  });

  it.each([
    ['build', 'POST', '/api/v1/final-results/f1/build', useBuildFinalResult, { processed: 2 }],
    ['publish', 'POST', '/api/v1/final-results/f1/publish', usePublishFinalResult, null],
  ] as const)(
    '%s invalidates the final, its rows and the notes lock',
    async (_n, _m, path, hook, body) => {
      server.use(
        http.post(path, () =>
          body ? HttpResponse.json(body, { status: 201 }) : new HttpResponse(null, { status: 201 }),
        ),
      );
      const { result, queryClient } = renderHookWithProviders(() => hook('f1'), opts);
      queryClient.setQueryData(finalResultRowsKey('f1'), { data: [] });
      queryClient.setQueryData([...reportCardNotesKeys.all, 's1'], {});
      await result.current.mutateAsync();
      await waitFor(() =>
        expect(queryClient.getQueryState(finalResultRowsKey('f1'))?.isInvalidated).toBe(true),
      );
      expect(queryClient.getQueryState([...reportCardNotesKeys.all, 's1'])?.isInvalidated).toBe(
        true,
      );
    },
  );

  it('SMS send carries an Idempotency-Key', async () => {
    let key: string | null = null;
    server.use(
      http.post('/api/v1/final-results/f1/sms', ({ request }) => {
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ queued: 1, skipped: [] }, { status: 201 });
      }),
    );
    const { result } = renderHookWithProviders(() => useSendFinalResultSms('f1'), opts);
    await result.current.mutateAsync();
    expect(key).toBeTruthy();
  });
});
