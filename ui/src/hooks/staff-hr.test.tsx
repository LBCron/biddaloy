import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setActiveRole, setActiveTenant } from '../api/auth-state';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  downloadStaffDocument,
  useCreateStaffHrRecord,
  useDesignations,
  usePromoteStaff,
  useStaffDesignationHistory,
  useStaffHrRecord,
  useUpdateStaffHrRecord,
  type StaffDesignationHistory,
  type StaffDocument,
  type StaffHrRecord,
} from './staff-hr';
import { userKeys } from './users';

const hrRecord: StaffHrRecord = {
  id: 'hr-1',
  user_id: 'user-1',
  index_no: null,
  salary_code: null,
  mpo_date: null,
  salary_scale: null,
  department: 'Science',
  blood_group: null,
  name_bn: null,
  religion: null,
  card_no: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const historyRow: StaffDesignationHistory = {
  id: 'hist-1',
  user_id: 'user-1',
  designation_id: 'designation-1',
  effective_date: '2026-01-01',
  end_date: null,
  status: 'REGULAR',
  notes: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('useStaffHrRecord', () => {
  it('filters by user_id and resolves the one record', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/staff-hr-records', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json([hrRecord]);
      }),
    );

    const { result } = renderHookWithProviders(() => useStaffHrRecord('user-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(params!.get('user_id')).toBe('user-1');
    expect(result.current.data?.id).toBe('hr-1');
  });

  it('resolves null when no record exists yet', async () => {
    server.use(http.get('/api/v1/staff-hr-records', () => HttpResponse.json([])));

    const { result } = renderHookWithProviders(() => useStaffHrRecord('user-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useStaffDesignationHistory', () => {
  it('resolves the full history list', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records/user-1/designation-history', () =>
        HttpResponse.json([historyRow]),
      ),
    );

    const { result } = renderHookWithProviders(() => useStaffDesignationHistory('user-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([historyRow]);
  });
});

describe('useDesignations', () => {
  it('resolves the tenant designation list', async () => {
    server.use(
      http.get('/api/v1/designations', () =>
        HttpResponse.json([
          { id: 'd-1', title_en: 'Accountant', title_bn: null, is_teaching: false },
        ]),
      ),
    );

    const { result } = renderHookWithProviders(() => useDesignations(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.title_en).toBe('Accountant');
  });
});

describe('useCreateStaffHrRecord / useUpdateStaffHrRecord', () => {
  it('POSTs a new record', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/v1/staff-hr-records', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(hrRecord, { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(() => useCreateStaffHrRecord(), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ user_id: 'user-1', department: 'Science' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ user_id: 'user-1', department: 'Science' });
  });

  it('PATCHes an existing record', async () => {
    let body: unknown = null;
    server.use(
      http.patch('/api/v1/staff-hr-records/hr-1', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...hrRecord, department: 'Math' });
      }),
    );

    const { result } = renderHookWithProviders(() => useUpdateStaffHrRecord('hr-1', 'user-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ department: 'Math' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ department: 'Math' });
  });
});

describe('usePromoteStaff', () => {
  it('POSTs the promotion body to :userId/promote', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/v1/staff-hr-records/user-1/promote', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(historyRow, { status: 201 });
      }),
    );

    const { result, queryClient } = renderHookWithProviders(() => usePromoteStaff('user-1'), {
      tenantId: 'tenant-1',
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    result.current.mutate({ designation_id: 'designation-1', effective_date: '2026-06-01' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ designation_id: 'designation-1', effective_date: '2026-06-01' });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: userKeys.lists() }),
    );
  });

  it('surfaces a 409 (promotion already in progress) as an error', async () => {
    server.use(
      http.post('/api/v1/staff-hr-records/user-1/promote', () =>
        HttpResponse.json({ statusCode: 409, message: 'in progress' }, { status: 409 }),
      ),
    );

    const { result } = renderHookWithProviders(() => usePromoteStaff('user-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ designation_id: 'designation-1', effective_date: '2026-06-01' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

const staffDocument: StaffDocument = {
  id: 'doc-1',
  staff_user_id: 'user-1',
  document_type: 'NID',
  original_filename: 'fallback-name.pdf',
  content_type: 'application/pdf',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('downloadStaffDocument', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockDownload(contentDisposition?: string) {
    server.use(
      http.get('/api/v1/staff-documents/download/doc-1', () =>
        HttpResponse.text('file bytes', {
          headers: contentDisposition ? { 'Content-Disposition': contentDisposition } : {},
        }),
      ),
    );
  }

  function stubAnchor() {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  }

  it('uses the UTF-8 encoded filename when present', async () => {
    mockDownload("attachment; filename*=UTF-8''nid-card.pdf");
    stubAnchor();
    let downloadName = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'download', 'set').mockImplementation((value) => {
      downloadName = value;
    });
    setActiveTenant('tenant-1');
    setActiveRole('ADMIN');

    await downloadStaffDocument(staffDocument);

    expect(downloadName).toBe('nid-card.pdf');
  });

  it('falls back to the plain filename= parameter when no UTF-8 one is present', async () => {
    mockDownload('attachment; filename="plain-name.pdf"');
    stubAnchor();
    let downloadName = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'download', 'set').mockImplementation((value) => {
      downloadName = value;
    });
    setActiveTenant('tenant-1');
    setActiveRole('ADMIN');

    await downloadStaffDocument(staffDocument);

    expect(downloadName).toBe('plain-name.pdf');
  });

  it("falls back to the document's own filename when there is no header at all", async () => {
    mockDownload(undefined);
    stubAnchor();
    let downloadName = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'download', 'set').mockImplementation((value) => {
      downloadName = value;
    });
    setActiveTenant('tenant-1');
    setActiveRole('ADMIN');

    await downloadStaffDocument(staffDocument);

    expect(downloadName).toBe('fallback-name.pdf');
  });

  it("falls back to the document's own filename when the UTF-8 filename is malformed percent-encoding", async () => {
    mockDownload("attachment; filename*=UTF-8''%E0%A6%");
    stubAnchor();
    let downloadName = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'download', 'set').mockImplementation((value) => {
      downloadName = value;
    });
    setActiveTenant('tenant-1');
    setActiveRole('ADMIN');

    await downloadStaffDocument(staffDocument);

    expect(downloadName).toBe('fallback-name.pdf');
  });
});
