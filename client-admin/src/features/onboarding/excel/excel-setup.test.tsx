/** [13.5.2] Starter-file path: download, problems, preview, confirm, failure. */
import { File as NodeFile } from 'node:buffer';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExcelSetup } from './excel-setup';

const SCHOOL_NAME = 'Ananta School'; // default MSW school-profile fixture

function makeFile(): File {
  return new NodeFile(['content'], 'starter.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }) as File;
}

function mockValidate(
  over: {
    errors?: object[];
    hard_error_count?: number;
    kind?: string;
    classes?: { updates?: number; deletes?: number };
  } = {},
) {
  server.use(
    http.post('/api/v1/backup/validate', () =>
      HttpResponse.json({
        staging_id: 'staging-1',
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        meta: {
          schema_version: 1,
          kind: over.kind ?? 'TEMPLATE',
          exported_at: new Date().toISOString(),
          app_version: '1.0.0',
          source_school_name: 'x',
          source_school_slug: 'x',
        },
        tabs: [
          {
            name: 'classes',
            present: true,
            creates: 4,
            updates: over.classes?.updates ?? 0,
            unchanged: 0,
            deletes: over.classes?.deletes ?? 0,
          },
          { name: 'sections', present: true, creates: 8, updates: 0, unchanged: 0, deletes: 0 },
        ],
        totals: { creates: 12, updates: 0, unchanged: 0, deletes: 0 },
        errors: over.errors ?? [],
        warnings: [],
        hard_error_count: over.hard_error_count ?? 0,
        is_empty_tenant: true,
      }),
    ),
  );
}

function job(over: object) {
  return {
    id: 'job-1',
    kind: 'RESTORE',
    status: 'RUNNING',
    source: 'MANUAL',
    requested_by: { id: 'u', full_name: 'A' },
    size_bytes: null,
    row_counts: null,
    progress: null,
    failed_tab: null,
    snapshot_job_id: null,
    error: null,
    pinned: false,
    expires_at: null,
    created_at: new Date().toISOString(),
    finished_at: null,
    ...over,
  };
}

async function setup(onDone?: () => void) {
  const view = renderWithProviders(<ExcelSetup {...(onDone ? { onDone } : {})} />, {
    tenantId: 'tenant-1',
    accessToken: 'token',
    role: 'ADMIN',
    locale: 'en',
  });
  await view.localeReady;
  const user = userEvent.setup();
  return { user };
}

async function upload(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(await screen.findByLabelText('Choose file'), makeFile());
}

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupTestState();
});

describe('ExcelSetup', () => {
  it('shows a translated sentence, not the server text, when the file is refused (#3174)', async () => {
    server.use(
      http.post('/api/v1/backup/validate', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'Server English text',
            requestId: 'req-1',
            details: { code: 'NOT_XLSX' },
          },
          { status: 400 },
        ),
      ),
    );
    const { user } = await setup();
    await upload(user);
    const alert = await screen.findByRole('alert');
    // The starter wording speaks of the sample, not of a backup.
    expect(alert.textContent).toContain(
      'This is not a valid .xlsx file. Save the sample as .xlsx in Excel and upload it again.',
    );
    expect(alert.textContent).not.toContain('backup');
    expect(alert.textContent).not.toContain('Server English text');
  });

  it('maps a bare 413 from the upload limit to the sample too-large sentence', async () => {
    server.use(
      http.post('/api/v1/backup/validate', () =>
        HttpResponse.json(
          { statusCode: 413, message: 'File too large', requestId: 'req-1' },
          { status: 413 },
        ),
      ),
    );
    const { user } = await setup();
    await upload(user);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'This file is too large to read. Check that it is the sample file you filled in.',
    );
  });

  it('downloads the starter variant in the current language', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/backup/template', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.text('bytes');
      }),
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user } = await setup();
    await user.click(await screen.findByRole('button', { name: 'Download sample file' }));
    await waitFor(() => expect(params?.get('variant')).toBe('starter'));
    expect(params?.get('lang')).toBe('en');
  });

  it('with problems: shows the table and keeps "Create these" disabled', async () => {
    mockValidate({
      hard_error_count: 1,
      errors: [
        {
          row: 3,
          tab: 'classes',
          column: 'name',
          value: '',
          message: 'Name is required',
          severity: 'error',
        },
      ],
    });
    const { user } = await setup();
    await upload(user);
    expect(await screen.findByText('Name is required')).toBeTruthy();
    expect(screen.getByText(/1 problem found/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create these' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('refuses a file that is not the starter file', async () => {
    mockValidate({ kind: 'BACKUP' });
    const { user } = await setup();
    await upload(user);
    expect(await screen.findByText(/not the sample file/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create these' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  // The confirmation is sent for the user, so a starter file that would change or remove
  // existing rows must never reach "Create these".
  it.each([
    ['updates', { updates: 1 }],
    ['deletes', { deletes: 1 }],
  ])('refuses a starter file that %s existing rows and sends no restore', async (_, classes) => {
    mockValidate({ classes });
    let restoreCalled = false;
    server.use(
      http.post('/api/v1/backup/restore', () => {
        restoreCalled = true;
        return HttpResponse.json({ job_id: 'job-1', snapshot_job_id: 's' }, { status: 202 });
      }),
    );
    const { user } = await setup();
    await upload(user);
    expect(await screen.findByText(/not the sample file/)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Create these' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await user.click(confirm);
    expect(restoreCalled).toBe(false);
  });

  it('clean file: previews counts, writes nothing until confirm, then runs the job and calls onDone', async () => {
    mockValidate();
    let restoreBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/backup/restore', async ({ request }) => {
        restoreBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ job_id: 'job-1', snapshot_job_id: 's' }, { status: 202 });
      }),
      http.get('/api/v1/backup/jobs/job-1', () => HttpResponse.json(job({ status: 'DONE' }))),
    );
    const onDone = vi.fn();
    const { user } = await setup(onDone);
    await upload(user);
    expect(await screen.findByText('This is what will be created')).toBeTruthy();
    expect(screen.getByText('Sections')).toBeTruthy();
    expect(restoreBody).toBeUndefined();

    const confirm = screen.getByRole('button', { name: 'Create these' });
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
    await user.click(confirm);

    expect(await screen.findByText('Your school has been set up.')).toBeTruthy();
    expect(restoreBody).toMatchObject({ staging_id: 'staging-1', confirmation: SCHOOL_NAME });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('failure: shows the sentence, the sheets already created, and a retry', async () => {
    mockValidate();
    server.use(
      http.post('/api/v1/backup/restore', () =>
        HttpResponse.json({ job_id: 'job-1', snapshot_job_id: 's' }, { status: 202 }),
      ),
      http.get('/api/v1/backup/jobs/job-1', () =>
        HttpResponse.json(job({ status: 'FAILED', failed_tab: 'sections' })),
      ),
    );
    const onDone = vi.fn();
    const { user } = await setup(onDone);
    await upload(user);
    const confirm = await screen.findByRole('button', { name: 'Create these' });
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
    await user.click(confirm);

    expect(await screen.findByText("Couldn't restore this backup. Try again.")).toBeTruthy();
    expect(screen.getByText(/Already created: Classes/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
