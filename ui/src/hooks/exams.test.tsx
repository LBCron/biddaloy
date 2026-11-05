import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  examKeys,
  examProgressQueryOptions,
  markGridKey,
  studentResultCardKey,
  useCommitMarksSheet,
  useDeleteExam,
  useDownloadMarksSheet,
  usePublishResults,
  useValidateMarksSheet,
} from './exams';

describe('useDeleteExam', () => {
  it('DELETEs the exam by id and invalidates the exams list', async () => {
    let calledPath: string | undefined;
    server.use(
      http.delete('/api/v1/exams/:id', ({ params }) => {
        calledPath = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result, queryClient } = renderHookWithProviders(() => useDeleteExam(), {
      tenantId: 'tenant-1',
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    queryClient.setQueryData(examKeys.detail('e1'), { id: 'e1' });

    await result.current.mutateAsync('e1');

    expect(calledPath).toBe('e1');
    expect(queryClient.getQueryData(examKeys.detail('e1'))).toBeUndefined();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: examKeys.lists() }));
  });
});

describe('usePublishResults', () => {
  it('marks the staff report card stale, so it never prints old results [#2922]', async () => {
    server.use(
      http.post('/api/v1/exams/:id/results/publish', () => new HttpResponse(null, { status: 204 })),
    );
    const { result, queryClient } = renderHookWithProviders(() => usePublishResults('e1'), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(studentResultCardKey('s1', 'e1'), { exam_name: 'Old' });

    await result.current.mutateAsync();

    await waitFor(() =>
      expect(queryClient.getQueryState(studentResultCardKey('s1', 'e1'))?.isInvalidated).toBe(true),
    );
  });
});

describe('marks sheet hooks [81.2.2]', () => {
  const sheetUrl = '/api/v1/exams/e1/marks/sheet';

  it('validate maps errors to table rows and keeps counts + changes', async () => {
    let query: string | undefined;
    server.use(
      http.post(`${sheetUrl}/validate`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({
          staging_id: null,
          expires_at: null,
          summary: { rows: 2, new: 0, changed: 0, unchanged: 0, absent: 0, exempt: 0, errors: 1 },
          changes: [],
          errors: [{ row: 3, roll: 7, component_name: 'MCQ', code: 'ABOVE_FULL_MARKS' }],
        });
      }),
    );
    const { result } = renderHookWithProviders(() => useValidateMarksSheet('e1', 'sec1', 'sub1'), {
      tenantId: 'tenant-1',
    });
    const preview = await result.current.mutateAsync({
      file: new File(['x'], 'm.xlsx'),
    });
    expect(query).toContain('section_id=sec1');
    expect(query).toContain('subject_id=sub1');
    expect(preview.hard_error_count).toBe(1);
    expect(preview.errors[0]).toMatchObject({
      row: 3,
      column: 'MCQ',
      code: 'ABOVE_FULL_MARKS',
      severity: 'error',
      value: '7',
    });
    expect(preview.summary.summary.errors).toBe(1);
  });

  it('commit sends an Idempotency-Key, does not retry, and refreshes the grid + progress', async () => {
    let key: string | null = null;
    let calls = 0;
    server.use(
      http.post(`${sheetUrl}/commit`, ({ request }) => {
        calls += 1;
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ saved: 4 });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(
      () => useCommitMarksSheet('e1', 'sec1', 'sub1'),
      { tenantId: 'tenant-1' },
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const out = await result.current.mutateAsync('11111111-1111-4111-8111-111111111111');
    expect(out).toEqual({ saved: 4 });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls).toBe(1);
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: markGridKey('e1', 'sec1', 'sub1'),
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: examProgressQueryOptions('e1').queryKey,
    });
  });

  it('commit failure is not retried [Rule 25]', async () => {
    let calls = 0;
    server.use(
      http.post(`${sheetUrl}/commit`, () => {
        calls += 1;
        return HttpResponse.json({ message: 'nope' }, { status: 500 });
      }),
    );
    const { result } = renderHookWithProviders(() => useCommitMarksSheet('e1', 'sec1', 'sub1'), {
      tenantId: 'tenant-1',
    });
    await expect(
      result.current.mutateAsync('11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  it('download saves the file under the Content-Disposition name', async () => {
    server.use(
      http.get(sheetUrl, () =>
        HttpResponse.arrayBuffer(new ArrayBuffer(4), {
          headers: { 'Content-Disposition': 'attachment; filename="Mid_A_Math.xlsx"' },
        }),
      ),
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    let name = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      name = this.download;
    });
    const { result } = renderHookWithProviders(() => useDownloadMarksSheet('e1', 'sec1', 'sub1'), {
      tenantId: 'tenant-1',
    });
    await result.current.mutateAsync();
    expect(name).toBe('Mid_A_Math.xlsx');
    click.mockRestore();
  });
});
