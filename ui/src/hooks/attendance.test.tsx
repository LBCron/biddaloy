/**
 * [9.6] `useSubmitRegister` is 8.12's offline mutation queue's first real
 * caller — these tests exercise the online/offline/no-response/conflict
 * contract described on the hook itself. `enqueueMutation` is mocked so
 * each case asserts *whether* it was called and with what, rather than
 * standing up a real Dexie/tenant for a unit test.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { onlineManager } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/errors';
import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  attendanceKeys,
  registerMatrixKey,
  sectionRegisterKey,
  useCorrectRecord,
  useMySections,
  useRecordHistory,
  useSaveRegisterMatrix,
  useSectionPeriods,
  useSectionRegister,
  useSubjectSummary,
  useSubmitRegister,
  type PutRegisterInput,
  type PutRegisterMatrixInput,
} from './attendance';

const { enqueueMutationMock } = vi.hoisted(() => ({ enqueueMutationMock: vi.fn() }));

vi.mock('../api/mutation-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/mutation-queue')>();
  return { ...actual, enqueueMutation: enqueueMutationMock };
});

function buildInput(): PutRegisterInput {
  return {
    date: '2026-09-04',
    base_version: 0,
    client_request_id: crypto.randomUUID(),
    entries: [{ student_id: 'student-1', status: AttendanceStatus.PRESENT }],
  };
}

const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
  // TanStack reads its own onlineManager, not navigator.onLine; set both.
  onlineManager.setOnline(value);
}

beforeEach(() => {
  enqueueMutationMock.mockReset();
  enqueueMutationMock.mockResolvedValue({ seq: 1 });
  setOnline(true);
});

afterEach(() => {
  onlineManager.setOnline(true);
  if (originalOnLine) Object.defineProperty(window.navigator, 'onLine', originalOnLine);
});

describe('useMySections', () => {
  it("resolves the teacher's server-scoped section list", async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          {
            section_id: 'section-1',
            section_name: 'A',
            class_name: 'Class 5',
            student_count: 40,
            today: null,
          },
        ]),
      ),
    );
    const { result } = renderHookWithProviders(() => useMySections(), { tenantId: 'tenant-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.section_name).toBe('A');
  });
});

describe('useSectionRegister', () => {
  it('resolves the register for a section/date', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json({
          section: { id: 'section-1', section_name: 'A', class_name: 'Class 5' },
          session: {
            id: null,
            date: '2026-09-04',
            period_no: null,
            state: 'DRAFT',
            version: 0,
            marked_by_user_id: null,
            marked_at: null,
            finalized_at: null,
          },
          editable: true,
          reason_required: false,
          non_working_day: false,
          policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: false },
          students: [],
        }),
      ),
    );
    const { result } = renderHookWithProviders(
      () => useSectionRegister('section-1', '2026-09-04'),
      { tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.section.section_name).toBe('A');
  });
});

describe('useSubmitRegister', () => {
  it('online: sends PUT and resolves { queued: false, register }', async () => {
    server.use(
      http.put('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json({
          section: { id: 'section-1', section_name: 'A', class_name: 'Class 5' },
          session: {
            id: 'session-1',
            date: '2026-09-04',
            period_no: null,
            state: 'DRAFT',
            version: 1,
            marked_by_user_id: 'user-1',
            marked_at: '2026-09-04T00:00:00.000Z',
            finalized_at: null,
          },
          editable: true,
          reason_required: false,
          non_working_day: false,
          policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: false },
          students: [],
        }),
      ),
    );
    const { result } = renderHookWithProviders(() => useSubmitRegister('section-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(buildInput());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      queued: false,
      register: expect.objectContaining({ session: expect.objectContaining({ version: 1 }) }),
    });
    expect(enqueueMutationMock).not.toHaveBeenCalled();
  });

  it('offline (navigator.onLine = false): enqueues instead of sending', async () => {
    setOnline(false);
    const { result } = renderHookWithProviders(() => useSubmitRegister('section-1'), {
      tenantId: 'tenant-1',
    });
    const input = buildInput();
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ queued: true });
    expect(enqueueMutationMock).toHaveBeenCalledWith({
      entity: 'attendance',
      method: 'put',
      path: '/attendance/sections/section-1/register',
      body: input,
    });
  });

  it('online but no-response network error: enqueues instead of throwing', async () => {
    server.use(
      http.put('/api/v1/attendance/sections/section-1/register', () => HttpResponse.error()),
    );
    const { result } = renderHookWithProviders(() => useSubmitRegister('section-1'), {
      tenantId: 'tenant-1',
    });
    const input = buildInput();
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ queued: true });
    expect(enqueueMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'attendance', method: 'put' }),
    );
  });

  it('409 conflict: propagates to the caller, never queued', async () => {
    server.use(
      http.put('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          apiErrorBody(
            409,
            'This register changed since you last loaded it',
            '/attendance/sections/section-1/register',
          ),
          { status: 409 },
        ),
      ),
    );
    const { result } = renderHookWithProviders(() => useSubmitRegister('section-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(buildInput());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(enqueueMutationMock).not.toHaveBeenCalled();
  });

  it('enqueueMutation throwing QueueUnavailableError propagates, not swallowed', async () => {
    setOnline(false);
    const { QueueUnavailableError } = await import('../api/mutation-queue');
    enqueueMutationMock.mockRejectedValueOnce(new QueueUnavailableError('no tenant is active'));
    const { result } = renderHookWithProviders(() => useSubmitRegister('section-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(buildInput());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(QueueUnavailableError);
  });
});

// [9.7] PATCH /attendance/records/:recordId, GET .../history
describe('useRecordHistory', () => {
  it('resolves the paginated history envelope for a record', async () => {
    server.use(
      http.get('/api/v1/attendance/records/record-1/history', () =>
        HttpResponse.json({
          data: [
            {
              id: 'audit-1',
              tenant_id: 'tenant-1',
              action: 'UPDATE',
              entity_type: 'AttendanceRecord',
              entity_id: 'record-1',
              performed_by_user_id: 'user-1',
              performed_by_name: null,
              old_values: { status: 'ABSENT' },
              new_values: { status: 'PRESENT', reason: 'Slip submitted late' },
              ip_address: null,
              user_agent: null,
              created_at: '2026-09-04T10:14:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useRecordHistory('record-1'), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0]?.new_values?.reason).toBe('Slip submitted late');
  });

  it('stays disabled when recordId is undefined — never fires /records/undefined/history', () => {
    const { result } = renderHookWithProviders(() => useRecordHistory(undefined), {
      tenantId: 'tenant-1',
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
  });
});

describe('useCorrectRecord', () => {
  it('PATCHes the record and never calls enqueueMutation — corrections are never queued', async () => {
    server.use(
      http.patch('/api/v1/attendance/records/record-1', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({
          status: 'PRESENT',
          reason: 'Slip submitted late',
        });
        return HttpResponse.json({
          section: { id: 'section-1', section_name: 'A', class_name: 'Class 5' },
          session: {
            id: 'session-1',
            date: '2026-09-04',
            period_no: null,
            state: 'DRAFT',
            version: 2,
            marked_by_user_id: 'user-2',
            marked_at: '2026-09-04T00:00:00.000Z',
            finalized_at: null,
          },
          editable: false,
          reason_required: true,
          non_working_day: false,
          policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: false },
          students: [],
        });
      }),
    );

    const { result, queryClient } = renderHookWithProviders(
      () => useCorrectRecord('section-1', '2026-09-04'),
      { tenantId: 'tenant-1' },
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    result.current.mutate({
      recordId: 'record-1',
      status: AttendanceStatus.PRESENT,
      reason: 'Slip submitted late',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(enqueueMutationMock).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: sectionRegisterKey('section-1', '2026-09-04', undefined),
    });
    // The whole branch, not just this record's own history page — a
    // correction also changes student days/summaries, section summaries,
    // register matrices and low-attendance flags, and (since
    // `recordHistoryKey` defaults to page 1) any *later* history page too.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: attendanceKeys.all });
  });

  it('surfaces a 422 (reason too short) as a thrown ApiError, never queued', async () => {
    server.use(
      http.patch('/api/v1/attendance/records/record-1', () =>
        HttpResponse.json(
          apiErrorBody(
            422,
            'A reason of at least 3 characters is required',
            '/attendance/records/record-1',
          ),
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useCorrectRecord('section-1', '2026-09-04'), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({ recordId: 'record-1', status: AttendanceStatus.PRESENT, reason: 'no' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(enqueueMutationMock).not.toHaveBeenCalled();
  });
});

describe('[41.3.1] period / subject-summary / month-save hooks', () => {
  it('useSectionPeriods calls /periods with ?date=', async () => {
    let url = '';
    server.use(
      http.get('/api/v1/attendance/sections/section-1/periods', ({ request }) => {
        url = request.url;
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHookWithProviders(() => useSectionPeriods('section-1', '2026-09-04'), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(new URL(url).searchParams.get('date')).toBe('2026-09-04');
  });

  it('useSubjectSummary calls /subject-summary with from and to', async () => {
    let url = '';
    server.use(
      http.get('/api/v1/attendance/sections/section-1/subject-summary', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ subjects: [], rows: [] });
      }),
    );
    const { result } = renderHookWithProviders(
      () => useSubjectSummary('section-1', '2026-09-01', '2026-09-30'),
      { tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = new URL(url).searchParams;
    expect([params.get('from'), params.get('to')]).toEqual(['2026-09-01', '2026-09-30']);
  });

  const matrixInput = (): PutRegisterMatrixInput => ({
    client_request_id: crypto.randomUUID(),
    days: [
      {
        date: '2026-09-04',
        base_version: 1,
        entries: [{ student_id: 'student-1', status: AttendanceStatus.ABSENT }],
      },
    ],
  });

  it('useSaveRegisterMatrix PUTs, invalidates the whole attendance branch, never queues', async () => {
    server.use(
      http.put('/api/v1/attendance/sections/section-1/register-matrix', () =>
        HttpResponse.json({ saved_dates: ['2026-09-04'], versions: { '2026-09-04': 2 } }),
      ),
    );
    const queryClient = createTestQueryClient();
    // A month save rewrites day registers: the matrix AND the daily roster
    // (whose stale base_version would otherwise 409 the next submit) go stale.
    const matrixKey = registerMatrixKey('section-1', '2026-09');
    const dayKey = sectionRegisterKey('section-1', '2026-09-04');
    queryClient.setQueryData(matrixKey, {});
    queryClient.setQueryData(dayKey, {});
    const { result } = renderHookWithProviders(() => useSaveRegisterMatrix('section-1'), {
      tenantId: 'tenant-1',
      queryClient,
    });
    result.current.mutate(matrixInput());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryState(matrixKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(dayKey)?.isInvalidated).toBe(true);
    expect(enqueueMutationMock).not.toHaveBeenCalled();
  });

  it('useSaveRegisterMatrix 409 reaches the caller with details.dates, not queued', async () => {
    server.use(
      http.put('/api/v1/attendance/sections/section-1/register-matrix', () =>
        HttpResponse.json(
          {
            ...apiErrorBody(409, 'Changed', '/attendance/sections/section-1/register-matrix'),
            details: { dates: ['2026-09-04'] },
          },
          { status: 409 },
        ),
      ),
    );
    const { result } = renderHookWithProviders(() => useSaveRegisterMatrix('section-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(matrixInput());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).details?.dates).toEqual(['2026-09-04']);
    expect(enqueueMutationMock).not.toHaveBeenCalled();
  });
});

describe('[76.4.01] attendance-source fields pass through', () => {
  it('my-sections carries scanned_but_absent', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          {
            section_id: 's1',
            section_name: 'A',
            class_name: 'C5',
            student_count: 1,
            today: {
              state: 'DRAFT',
              present: 0,
              absent: 1,
              late: 0,
              leave: 0,
              unmarked: 0,
              scanned_but_absent: 1,
              marked_at: null,
            },
          },
        ]),
      ),
    );
    const { result } = renderHookWithProviders(() => useMySections(), { tenantId: 't1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.today?.scanned_but_absent).toBe(1);
  });

  it('register carries can_write, write_reason, first_period_today and scanned_at', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/s1/register', () =>
        HttpResponse.json({
          editable: false,
          period_attendance_enabled: true,
          can_write: false,
          write_reason: 'FIRST_PERIOD_ONLY',
          first_period_today: false,
          students: [{ student_id: 'x', scanned_at: '2026-09-04T03:00:00Z' }],
        }),
      ),
    );
    const { result } = renderHookWithProviders(() => useSectionRegister('s1', '2026-09-04'), {
      tenantId: 't1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data;
    expect(data?.can_write).toBe(false);
    expect(data?.write_reason).toBe('FIRST_PERIOD_ONLY');
    expect(data?.first_period_today).toBe(false);
    expect(data?.period_attendance_enabled).toBe(true);
    expect(data?.students[0]?.scanned_at).toBe('2026-09-04T03:00:00Z');
  });
});
