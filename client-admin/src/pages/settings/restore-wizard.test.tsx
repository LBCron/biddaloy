import { File as NodeFile } from 'node:buffer';

import type { PreviewResult, RestoreSummary, WorkbookJob } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RestoreWizard } from './restore-wizard';

/**
 * [613, corrected 14.11.5] RTL coverage against the *real* server DTOs
 * (`ValidateResponseDto`, `RequestRestoreDto`/`RequestRestoreResponseDto`,
 * `WorkbookJobDto`) — the original build here was tested against an
 * invented shape (a `summary`-wrapped validate response, `school_name` on
 * it, `type`/`file_size_bytes`/`error_message` on the job), which is why it
 * passed while the real API would have crashed the page. See
 * `ui/src/hooks/backup.ts`'s header comment for the full DTO shapes.
 *
 * The default MSW school-profile fixture's name is "Ananta School"
 * (`ui/src/test/msw/handlers/schools.ts`) — the confirmation gate here
 * checks against that, never against the uploaded workbook's
 * `meta.source_school_name`.
 *
 * `BulkUploadPreview`'s own plumbing (aria-live wording, the countdown,
 * the error table's CSV export) is covered by `bulk-upload-preview.test.tsx`
 * and not duplicated here — same split `students/import.test.tsx` uses.
 *
 * Files use `node:buffer`'s `File`, not jsdom's — jsdom 30's Blob hangs
 * MSW's XHR body serialization for a multipart upload (see
 * `import.test.tsx`'s own comment on this).
 */
const SCHOOL_NAME = 'Ananta School';

function makeFile(name = 'backup.xlsx'): File {
  return new NodeFile(['content'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }) as File;
}

function validateSummary(overrides: Partial<RestoreSummary> = {}): RestoreSummary {
  return {
    meta: {
      schema_version: 1,
      kind: 'BACKUP',
      exported_at: new Date().toISOString(),
      app_version: '1.0.0',
      source_school_name: 'Some Other School Entirely',
      source_school_slug: 'some-other-school-entirely',
    },
    totals: { creates: 12, updates: 3, unchanged: 100, deletes: 5 },
    is_empty_tenant: false,
    tabs: [
      { name: 'students', present: true, creates: 12, updates: 3, unchanged: 100, deletes: 5 },
    ],
    warnings: [],
    ...overrides,
  };
}

/** `POST /backup/validate` returns the *flat* `ValidateResponseDto` — no
 * `summary` wrapper. `useValidateBackup` reshapes it into
 * `PreviewResult<RestoreSummary>` client-side, so the mock here must send
 * the flat shape, same as the real server. */
function mockValidate(result: PreviewResult<RestoreSummary>) {
  server.use(
    http.post('/api/v1/backup/validate', () =>
      HttpResponse.json({
        staging_id: result.staging_id,
        expires_at: result.expires_at,
        errors: result.errors,
        hard_error_count: result.hard_error_count,
        meta: result.summary.meta,
        tabs: result.summary.tabs,
        totals: result.summary.totals,
        warnings: result.summary.warnings,
        is_empty_tenant: result.summary.is_empty_tenant,
      }),
    ),
  );
}

function mockRestore(response: { job_id: string; snapshot_job_id: string }) {
  server.use(
    http.post('/api/v1/backup/restore', () => HttpResponse.json(response, { status: 202 })),
  );
}

function mockJob(job: WorkbookJob) {
  server.use(http.get(`/api/v1/backup/jobs/${job.id}`, () => HttpResponse.json(job)));
}

function baseJob(overrides: Partial<WorkbookJob> = {}): WorkbookJob {
  return {
    id: 'job-restore-1',
    kind: 'RESTORE',
    status: 'RUNNING',
    source: 'MANUAL',
    requested_by: { id: 'user-1', full_name: 'Rahim Uddin' },
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
    ...overrides,
  };
}

async function renderAndUpload() {
  const result = renderWithProviders(<RestoreWizard />, {
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  await result.localeReady;

  const user = userEvent.setup();
  const input = await screen.findByLabelText('Choose file');
  await user.upload(input, makeFile());
  return { ...result, user };
}

afterEach(async () => {
  await cleanupTestState();
});

describe('RestoreWizard', () => {
  // [14.13.2]: "Download blank template" is UX-gated on BACKUP_MANAGE, same
  // permission the server enforces on this route — same pattern as
  // `students/import.test.tsx`'s migrate-in link coverage.
  it('shows the "Download blank template" button for ADMIN, who holds BACKUP_MANAGE, and it triggers the download helper with the current locale', async () => {
    let requestedLang: string | null = null;
    server.use(
      http.get('/api/v1/backup/template', ({ request }) => {
        requestedLang = new URL(request.url).searchParams.get('lang');
        return HttpResponse.text('workbook-bytes');
      }),
    );
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = renderWithProviders(<RestoreWizard />, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await result.localeReady;

    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Download blank template' });
    await user.click(button);

    await waitFor(() => expect(requestedLang).toBe('en'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
  });

  it('shows its own "Restore from a backup" heading unless hideTitle is set', async () => {
    const first = renderWithProviders(<RestoreWizard hideTitle />, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await first.localeReady;
    await screen.findByRole('button', { name: 'Download blank template' });
    expect(screen.queryByRole('heading', { name: 'Restore from a backup' })).toBeNull();
    first.unmount();

    const second = renderWithProviders(<RestoreWizard />, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await second.localeReady;
    expect(await screen.findByRole('heading', { name: 'Restore from a backup' })).toBeTruthy();
  });

  it('hides the "Download blank template" button for a role without BACKUP_MANAGE (ACCOUNTANT)', async () => {
    const result = renderWithProviders(<RestoreWizard />, {
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });
    await result.localeReady;

    await screen.findByText('Restore from a backup');
    expect(screen.queryByRole('button', { name: 'Download blank template' })).toBeNull();
  });

  // #3174: a refused file shows our own sentence per details.code, never the server's English text.
  it.each([
    ['NOT_XLSX', /not a valid \.xlsx workbook/],
    ['TOO_LARGE', /too large to read/],
    ['MISSING_META', /cannot be identified as a backup/],
    ['UNSUPPORTED_VERSION', /different version of the app/],
    ['VALIDATE_BUSY', /Another file is being checked/],
  ])('maps the workbook refusal %s to a translated sentence', async (code, sentence) => {
    server.use(
      http.post('/api/v1/backup/validate', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'Server English text',
            requestId: 'req-1',
            details: { code },
          },
          { status: code === 'VALIDATE_BUSY' ? 429 : 400 },
        ),
      ),
    );
    await renderAndUpload();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(sentence);
    expect(alert.textContent).not.toContain('Server English text');
  });

  it('maps a bare 413 from the upload limit (no details.code) to the too-large sentence', async () => {
    server.use(
      http.post('/api/v1/backup/validate', () =>
        HttpResponse.json(
          { statusCode: 413, message: 'File too large', requestId: 'req-1' },
          { status: 413 },
        ),
      ),
    );
    await renderAndUpload();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/too large to read/);
    expect(alert.textContent).not.toContain('File too large');
  });

  it('Confirm stays disabled until the session school name is typed, and enables on an exact match', async () => {
    mockValidate({
      staging_id: 'staging-1',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });
    const { user } = await renderAndUpload();

    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(true));

    const input = screen.getByPlaceholderText("Type the school's name to confirm");

    // The workbook's own `meta.source_school_name` ("Some Other School
    // Entirely") must NOT satisfy the gate — only the session's real school
    // name (`SCHOOL_NAME`, from `useSchoolProfile()`) does.
    await user.type(input, 'Some Other School Entirely');
    expect(confirmButton.hasAttribute('disabled')).toBe(true);

    await user.clear(input);
    await user.type(input, SCHOOL_NAME);
    await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(false));
  });

  // Restored from 7150675f (the fail-closed gate fix), rewritten for the
  // gate's real source: the expected name now comes from
  // `useSchoolProfile()`, not from the validate response, so the blank case
  // is a blank *profile* name. Without the `expectedSchoolName !== ''` guard
  // in `RestoreConfirmSlot`, `'' === ''.trim()` would unlock a full-tenant
  // destructive restore with an untouched confirmation box.
  it.each([
    ['blank', ''],
    ['whitespace-only', '   '],
  ])(
    'keeps Confirm disabled when the school profile name is %s (gate fails closed)',
    async (_label, profileName) => {
      server.use(
        http.get('/api/v1/schools/me/profile', () =>
          HttpResponse.json({
            name: profileName,
            name_bn: null,
            address: null,
            phone: null,
            email: null,
            registration_id: null,
            logo_url: null,
          }),
        ),
      );
      mockValidate({
        staging_id: 'staging-blank-name',
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        errors: [],
        hard_error_count: 0,
        summary: validateSummary(),
      });

      const { user } = await renderAndUpload();

      const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
      const input = screen.getByPlaceholderText("Type the school's name to confirm");

      // An empty box against an empty expected name.
      await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(true));

      // And typing the blank name verbatim must not unlock it either.
      await user.type(input, profileName === '' ? ' ' : profileName);
      expect(confirmButton.hasAttribute('disabled')).toBe(true);
    },
  );

  it('hard_error_count > 0 disables Confirm no matter what is typed', async () => {
    mockValidate({
      staging_id: 'staging-2',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [{ row: 1, column: null, message: 'bad', severity: 'error' }],
      hard_error_count: 1,
      summary: validateSummary(),
    });
    const { user } = await renderAndUpload();

    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, SCHOOL_NAME);

    expect(confirmButton.hasAttribute('disabled')).toBe(true);
  });

  it('renders warnings from the top-level BulkImportErrorDto[] (has .message, not a bare string)', async () => {
    mockValidate({
      staging_id: 'staging-3',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary({
        warnings: [
          { row: 1, column: null, message: 'sheet guardians not present', severity: 'warning' },
        ],
      }),
    });
    await renderAndUpload();

    expect(await screen.findByText('sheet guardians not present')).toBeTruthy();
  });

  it('renders the per-tab diff from TabSummaryDto fields, with no per-tab error column', async () => {
    mockValidate({
      staging_id: 'staging-4',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });
    await renderAndUpload();

    expect(await screen.findByText('Students')).toBeTruthy();
    expect(screen.queryByText('Errors')).toBeNull();
  });

  it('shows the empty-tenant copy instead of the deletes line when is_empty_tenant is true', async () => {
    mockValidate({
      staging_id: 'staging-4b',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary({ is_empty_tenant: true, tabs: [] }),
    });
    await renderAndUpload();

    expect(
      await screen.findByText('This school has no data yet — the workbook will be imported as-is.'),
    ).toBeTruthy();
    expect(screen.queryByText(/records will be deleted/)).toBeNull();
  });

  it('progress polling renders DONE with per-tab counts and the snapshot download', async () => {
    mockValidate({
      staging_id: 'staging-5',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });
    mockRestore({ job_id: 'job-restore-1', snapshot_job_id: 'snapshot-1' });
    mockJob(
      baseJob({
        status: 'DONE',
        finished_at: new Date().toISOString(),
        snapshot_job_id: 'snapshot-1',
        row_counts: { students: 12 },
      }),
    );

    const { user } = await renderAndUpload();
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, SCHOOL_NAME);
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Restore complete')).toBeTruthy();
    expect(await screen.findByText('Students: 12 records')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Download the copy taken before the restore' }),
    ).toBeTruthy();
  });

  it('progress polling renders FAILED with the failed tab, reason, snapshot link and undo copy', async () => {
    mockValidate({
      staging_id: 'staging-6',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });
    mockRestore({ job_id: 'job-restore-2', snapshot_job_id: 'snapshot-2' });
    mockJob(
      baseJob({
        id: 'job-restore-2',
        status: 'FAILED',
        finished_at: new Date().toISOString(),
        failed_tab: 'guardians',
        error: 'Duplicate natural key',
        snapshot_job_id: 'snapshot-2',
      }),
    );

    const { user } = await renderAndUpload();
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, SCHOOL_NAME);
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('The restore stopped at Guardians')).toBeTruthy();
    expect(screen.getByText('Duplicate natural key')).toBeTruthy();
    expect(
      screen.getByText(
        'Parts before Guardians were applied — restore the copy taken before to go back.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Download the copy taken before the restore' }),
    ).toBeTruthy();
  });

  it('a job with no progress falls back to the indeterminate progress copy', async () => {
    mockValidate({
      staging_id: 'staging-7',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });
    mockRestore({ job_id: 'job-restore-3', snapshot_job_id: 'snapshot-3' });
    mockJob(baseJob({ id: 'job-restore-3', status: 'RUNNING', progress: null }));

    const { user } = await renderAndUpload();
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, SCHOOL_NAME);
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Working on it…')).toBeTruthy();
  });

  it('a running job with progress renders the tab/done/total copy', async () => {
    mockValidate({
      staging_id: 'staging-8',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });
    mockRestore({ job_id: 'job-restore-4', snapshot_job_id: 'snapshot-4' });
    mockJob(
      baseJob({
        id: 'job-restore-4',
        status: 'RUNNING',
        progress: { tab: 'students', done: 3, total: 17 },
      }),
    );

    const { user } = await renderAndUpload();
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, SCHOOL_NAME);
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Restoring Students (3 of 17)')).toBeTruthy();
  });

  it('the invitations checkbox defaults off and its value reaches the restore payload as invite_users', async () => {
    mockValidate({
      staging_id: 'staging-9',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });

    let capturedBody:
      { staging_id?: string; confirmation?: string; invite_users?: boolean } | undefined;
    server.use(
      http.post('/api/v1/backup/restore', async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json(
          { job_id: 'job-restore-5', snapshot_job_id: 'snapshot-5' },
          { status: 202 },
        );
      }),
    );
    mockJob(baseJob({ id: 'job-restore-5', status: 'RUNNING' }));

    const { user } = await renderAndUpload();
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Send invitations to restored users',
    });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');

    await user.click(checkbox);
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, SCHOOL_NAME);
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(capturedBody?.invite_users).toBe(true));
    expect(capturedBody?.staging_id).toBe('staging-9');
    expect(capturedBody?.confirmation).toBe(SCHOOL_NAME);
  });

  // [14.13.3 / item 8, money-tier review] The SUPER_ADMIN
  // provision-from-workbook props: `tenantId` targets a school that isn't
  // the caller's active tenant, `expectedSchoolName` replaces the
  // `useSchoolProfile()` fetch as the confirm-gate's expected value.
  describe('tenantId / expectedSchoolName props (SUPER_ADMIN provision-from-workbook)', () => {
    it('never fetches useSchoolProfile when tenantId is set, and gates Confirm on expectedSchoolName', async () => {
      let profileFetched = false;
      server.use(
        http.get('/api/v1/schools/me/profile', () => {
          profileFetched = true;
          return HttpResponse.json({
            name: 'Wrong Tenant School',
            name_bn: null,
            address: null,
            phone: null,
            email: null,
            registration_id: null,
            logo_url: null,
          });
        }),
      );
      mockValidate({
        staging_id: 'staging-10',
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        errors: [],
        hard_error_count: 0,
        summary: validateSummary(),
      });

      const result = renderWithProviders(
        <RestoreWizard tenantId="new-school-tenant" expectedSchoolName="New School" />,
        { tenantId: 'platform-tenant', role: 'SUPER_ADMIN', locale: 'en' },
      );
      await result.localeReady;

      const user = userEvent.setup();
      const input = await screen.findByLabelText('Choose file');
      await user.upload(input, makeFile());

      const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
      const nameInput = screen.getByPlaceholderText("Type the school's name to confirm");

      // The ambient tenant's profile name must not satisfy the gate.
      await user.type(nameInput, 'Wrong Tenant School');
      expect(confirmButton.hasAttribute('disabled')).toBe(true);

      // Only expectedSchoolName ("New School") does.
      await user.clear(nameInput);
      await user.type(nameInput, 'New School');
      await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(false));

      expect(profileFetched).toBe(false);
    });

    it('sends X-Tenant-ID for the target school on validate/restore, and on the template download', async () => {
      let requestedLang: string | null = null;
      let templateTenantHeader: string | null = null;
      server.use(
        http.get('/api/v1/backup/template', ({ request }) => {
          requestedLang = new URL(request.url).searchParams.get('lang');
          templateTenantHeader = request.headers.get('X-Tenant-ID');
          return HttpResponse.text('workbook-bytes');
        }),
      );
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      let validateTenantHeader: string | null = null;
      server.use(
        http.post('/api/v1/backup/validate', ({ request }) => {
          validateTenantHeader = request.headers.get('X-Tenant-ID');
          return HttpResponse.json({
            staging_id: 'staging-11',
            expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
            meta: validateSummary().meta,
            tabs: validateSummary().tabs,
            totals: validateSummary().totals,
            errors: [],
            warnings: [],
            hard_error_count: 0,
            is_empty_tenant: false,
          });
        }),
      );
      let restoreTenantHeader: string | null = null;
      server.use(
        http.post('/api/v1/backup/restore', ({ request }) => {
          restoreTenantHeader = request.headers.get('X-Tenant-ID');
          return HttpResponse.json(
            { job_id: 'job-restore-10', snapshot_job_id: 'snapshot-10' },
            { status: 202 },
          );
        }),
      );
      mockJob(baseJob({ id: 'job-restore-10', status: 'RUNNING' }));

      const result = renderWithProviders(
        <RestoreWizard tenantId="new-school-tenant" expectedSchoolName="New School" />,
        { tenantId: 'platform-tenant', role: 'SUPER_ADMIN', locale: 'en' },
      );
      await result.localeReady;

      const user = userEvent.setup();

      const templateButton = await screen.findByRole('button', { name: 'Download blank template' });
      await user.click(templateButton);
      await waitFor(() => expect(requestedLang).toBe('en'));
      expect(templateTenantHeader).toBe('new-school-tenant');

      const input = await screen.findByLabelText('Choose file');
      await user.upload(input, makeFile());
      await waitFor(() => expect(validateTenantHeader).toBe('new-school-tenant'));

      const nameInput = screen.getByPlaceholderText("Type the school's name to confirm");
      await user.type(nameInput, 'New School');
      await user.click(await screen.findByRole('button', { name: 'Confirm' }));

      await waitFor(() => expect(restoreTenantHeader).toBe('new-school-tenant'));
    });
  });
});
