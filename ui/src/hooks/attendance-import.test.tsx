import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/errors';
import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import { attendanceKeys } from './attendance';
import {
  attendanceImportKeys,
  importFileErrorKey,
  useAttendanceImport,
  useAttendanceImports,
  useCommitAttendanceSheet,
  useDownloadAttendanceSheet,
  useValidateAttendanceSheet,
} from './attendance-import';

const file = () => new File(['x'], 'sheet.xlsx');

describe('useValidateAttendanceSheet', () => {
  it('returns rows and counts', async () => {
    const body = {
      staging_id: 'stg-1',
      rows: [],
      counts: { new: 1, changed: 0, unchanged: 0, error: 0 },
      overwrite_count: 0,
    };
    server.use(http.post('/api/v1/attendance/import/validate', () => HttpResponse.json(body)));
    const { result } = renderHookWithProviders(() => useValidateAttendanceSheet(), {
      tenantId: 't1',
    });
    const data = await result.current.mutateAsync(file());
    expect(data.staging_id).toBe('stg-1');
    expect(data.counts).toEqual(body.counts);
  });

  it('surfaces a 503 as an ApiError and a coded 400 as an i18n key', async () => {
    server.use(
      http.post('/api/v1/attendance/import/validate', () =>
        HttpResponse.json(apiErrorBody(503, 'unavailable', '/x'), { status: 503 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useValidateAttendanceSheet(), {
      tenantId: 't1',
    });
    await expect(result.current.mutateAsync(file())).rejects.toBeInstanceOf(ApiError);
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    expect((result.current.error as ApiError).statusCode).toBe(503);
    expect(importFileErrorKey(result.current.error)).toBeUndefined();
    expect(importFileErrorKey({ details: { code: 'IMPORT_FILE_UNREADABLE' } })).toBe('unreadable');
  });
});

describe('useCommitAttendanceSheet', () => {
  it('sends an Idempotency-Key, reuses it per staging id, and invalidates', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('/api/v1/attendance/import/commit', ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        return HttpResponse.json({ import_id: 'imp-1' }, { status: 201 });
      }),
    );
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(attendanceKeys.list({}), []);
    queryClient.setQueryData(attendanceImportKeys.list({ page: 1 }), {});
    const { result } = renderHookWithProviders(() => useCommitAttendanceSheet(), {
      tenantId: 't1',
      queryClient,
    });
    const input = { staging_id: '11111111-1111-4111-8111-111111111111' };
    await result.current.mutateAsync(input);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(queryClient.getQueryState(attendanceKeys.list({}))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(attendanceImportKeys.list({ page: 1 }))?.isInvalidated).toBe(
      true,
    );
  });
});

describe('useDownloadAttendanceSheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // [review] The plain filename= has Bangla turned into `_`; the real name is in filename*.
  it('saves the sheet under the UTF-8 file name', async () => {
    server.use(
      http.get('/api/v1/attendance/import/template', () =>
        HttpResponse.text('x', {
          headers: {
            'Content-Disposition': `attachment; filename="____.xlsx"; filename*=UTF-8''${encodeURIComponent('শ্রেণি ৫.xlsx')}`,
          },
        }),
      ),
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let saved = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved = this.download;
    });
    const { result } = renderHookWithProviders(() => useDownloadAttendanceSheet(), {
      tenantId: 't1',
    });
    await result.current.mutateAsync({ sectionIds: ['s1'], date: '2026-11-06' });
    expect(saved).toBe('শ্রেণি ৫.xlsx');
  });
});

describe('import list and detail queries', () => {
  it('key the detail per id', async () => {
    server.use(
      http.get('/api/v1/attendance/imports', () =>
        HttpResponse.json({ items: [], total: 0, page: 1, limit: 20 }),
      ),
      http.get('/api/v1/attendance/imports/:id', ({ params }) =>
        HttpResponse.json({ id: params.id, rows: [] }),
      ),
    );
    const queryClient = createTestQueryClient();
    const list = renderHookWithProviders(() => useAttendanceImports(1), {
      tenantId: 't1',
      queryClient,
    });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const a = renderHookWithProviders(() => useAttendanceImport('a'), {
      tenantId: 't1',
      queryClient,
    });
    const b = renderHookWithProviders(() => useAttendanceImport('b'), {
      tenantId: 't1',
      queryClient,
    });
    await waitFor(() => expect(a.result.current.data?.id).toBe('a'));
    await waitFor(() => expect(b.result.current.data?.id).toBe('b'));
    expect(queryClient.getQueryData(attendanceImportKeys.detail('a'))).toBeDefined();
  });
});
