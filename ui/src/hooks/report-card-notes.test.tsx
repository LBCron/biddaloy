import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  reportCardNotesKeys,
  useReportCardNotes,
  useSaveReportCardNotes,
} from './report-card-notes';

const opts = { tenantId: 'tenant-1' };

describe('useReportCardNotes', () => {
  it('sends the final result as the target query', async () => {
    let q: string | null = null;
    server.use(
      http.get('/api/v1/my-class/sections/s1/report-card-notes', ({ request }) => {
        q = new URL(request.url).searchParams.get('final_result_id');
        return HttpResponse.json({ rows: [], conduct_items: [], locked: false });
      }),
    );
    const { result } = renderHookWithProviders(
      () => useReportCardNotes('s1', { final_result_id: 'f1' }),
      opts,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(q).toBe('f1');
  });

  it('does not fetch without a section', () => {
    const { result } = renderHookWithProviders(
      () => useReportCardNotes(undefined, { exam_id: 'e1' }),
      opts,
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useSaveReportCardNotes', () => {
  it('PUTs the grid with the target, refreshes the notes, and never retries', async () => {
    let body: unknown;
    let exam: string | null = null;
    server.use(
      http.put('/api/v1/my-class/sections/s1/report-card-notes', async ({ request }) => {
        body = await request.json();
        exam = new URL(request.url).searchParams.get('exam_id');
        return HttpResponse.json({ changed: 1 });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(
      () => useSaveReportCardNotes('s1', { exam_id: 'e1' }),
      opts,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const notes = [{ student_id: 'st1', remark: 'Good', conduct: { discipline: 'A' } }];
    await result.current.mutateAsync({ notes });
    expect(body).toEqual({ notes });
    expect(exam).toBe('e1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: reportCardNotesKeys.all });
    // Student result, transcript and final-card views show the remark and conduct too.
    expect(invalidate).toHaveBeenCalledWith({ predicate: expect.any(Function) });
  });

  it('a 500 is sent once', async () => {
    let calls = 0;
    server.use(
      http.put('/api/v1/my-class/sections/s1/report-card-notes', () => {
        calls += 1;
        return HttpResponse.json({ message: 'x' }, { status: 500 });
      }),
    );
    const { result } = renderHookWithProviders(
      () => useSaveReportCardNotes('s1', { exam_id: 'e1' }),
      opts,
    );
    await expect(result.current.mutateAsync({ notes: [] })).rejects.toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
  });
});
