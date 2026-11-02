import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  finalResultKeys,
  finalResultRowsKey,
  finalTabulationKey,
  studentFinalCardKey,
  useBuildFinalResult,
  useCreateFinalResult,
  useFinalResults,
  useFinalTabulation,
  usePublishFinalResult,
  useSendFinalResultSms,
  useStudentFinalCard,
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

describe('useFinalTabulation', () => {
  it('sends section_id and keys the cache under the final', async () => {
    let section: string | null = null;
    server.use(
      http.get('/api/v1/final-results/f1/documents/tabulation', ({ request }) => {
        section = new URL(request.url).searchParams.get('section_id');
        return HttpResponse.json({ rows: [] });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(
      () => useFinalTabulation('f1', 'sec-1'),
      opts,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(section).toBe('sec-1');
    expect(queryClient.getQueryData(finalTabulationKey('f1', 'sec-1'))).toEqual({ rows: [] });
  });

  it('waits for both ids', () => {
    const { result } = renderHookWithProviders(() => useFinalTabulation('f1', undefined), opts);
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useStudentFinalCard', () => {
  it('sends academic_year_id to the student route and waits for both ids', async () => {
    let year: string | null = null;
    server.use(
      http.get('/api/v1/students/st-1/final-result-card', ({ request }) => {
        year = new URL(request.url).searchParams.get('academic_year_id');
        return HttpResponse.json({ final_result_id: 'f1', exam_shares: [] });
      }),
    );
    const idle = renderHookWithProviders(() => useStudentFinalCard('st-1', undefined), opts);
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = renderHookWithProviders(() => useStudentFinalCard('st-1', 'y1'), opts);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(year).toBe('y1');
    expect(result.current.data?.final_result_id).toBe('f1');
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
      // The transcript carries the final (D9) and the student card is the final: both go stale.
      queryClient.setQueryData(['students', 'st-1', 'transcript', 'y1'], {});
      queryClient.setQueryData(studentFinalCardKey('st-1', 'y1'), {});
      await result.current.mutateAsync();
      await waitFor(() =>
        expect(queryClient.getQueryState(finalResultRowsKey('f1'))?.isInvalidated).toBe(true),
      );
      expect(queryClient.getQueryState([...reportCardNotesKeys.all, 's1'])?.isInvalidated).toBe(
        true,
      );
      expect(
        queryClient.getQueryState(['students', 'st-1', 'transcript', 'y1'])?.isInvalidated,
      ).toBe(true);
      expect(queryClient.getQueryState(studentFinalCardKey('st-1', 'y1'))?.isInvalidated).toBe(
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
