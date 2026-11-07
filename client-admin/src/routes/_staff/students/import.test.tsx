import { File as NodeFile } from 'node:buffer';

import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { TEMPLATE_HEADERS } from './-import/template';

/**
 * [14.9.2]'s validate-then-confirm student import page. Replaces the old
 * write-on-upload flow ([8.11.7]) with `BulkUploadPreview` (#587):
 * `POST /students/bulk-upload/validate` stages the accepted rows and shows
 * a preview; nothing is created until `POST /students/bulk-upload/commit`
 * fires from clicking Confirm.
 *
 * Tests that only exercised `BulkUploadPreview`'s own plumbing — aria-live
 * wording during upload, blocking a second pick mid-flight, the error
 * table's CSV export mechanics — are not duplicated here; they're covered
 * by `bulk-upload-preview.test.tsx` and `bulk-import-error-table.test.tsx`.
 * This file focuses on what's specific to `/students/import`: the template/
 * reference sections, the student-shaped summary and preview table, and the
 * done-state invite-guardians flow.
 *
 * Files are constructed with node:buffer's `File`, not jsdom's — jsdom
 * 30's Blob hangs MSW's XHR body serialization (the request never
 * resolves). Node's File duck-types everything `userEvent.upload` and
 * axios read.
 */
function makeFile(name: string, content = 'a,b', type = 'text/csv'): File {
  return new NodeFile([content], name, { type }) as File;
}

function captureDownloads(): { blob: () => Blob | undefined } {
  let captured: Blob | undefined;
  URL.createObjectURL = (blob: Blob) => {
    captured = blob;
    return 'blob:capture';
  };
  URL.revokeObjectURL = () => {};
  return { blob: () => captured };
}

function restoreDownloads(): void {
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
}

function renderImportPage(role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/students/import'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

async function uploadFile(file: File) {
  const user = userEvent.setup({ applyAccept: false });
  await user.click(await screen.findByRole('button', { name: 'Choose file' }));
  const input = screen.getByLabelText('Choose file');
  await user.upload(input, file);
}

function validateHandler(body: object, status = 201) {
  return http.post('/api/v1/students/bulk-upload/validate', () =>
    HttpResponse.json(body, { status }),
  );
}

const cleanPreviewBody = {
  staging_id: 'stage-clean',
  expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  rows_to_create: 3,
  preview: [
    {
      row: 2,
      student_name: 'Karim Rahman',
      class: 'Class 5',
      section: 'A',
      guardian1_phone: '+8801711111111',
    },
    {
      row: 3,
      student_name: 'Rahim Uddin',
      class: 'Class 5',
      section: 'A',
      guardian1_phone: '+8801711111112',
    },
    {
      row: 4,
      student_name: 'Fatema Begum',
      class: 'Class 5',
      section: 'B',
      guardian1_phone: '+8801711111113',
    },
  ],
  errors: [],
  hard_error_count: 0,
};

describe('/students/import', () => {
  afterEach(async () => {
    restoreDownloads();
    await cleanupTestState();
  });

  it('offers a downloadable template with the 13 exact headers, BOM-prefixed', async () => {
    const downloads = captureDownloads();
    renderImportPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Download template' }));

    await waitFor(() => expect(downloads.blob()).toBeDefined());
    const bytes = new Uint8Array(await downloads.blob()!.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    const headerLine = csv.split('\r\n')[0];
    expect(headerLine).toBe(TEMPLATE_HEADERS.map((h) => `"${h}"`).join(','));
    expect(TEMPLATE_HEADERS).toHaveLength(14);
  });

  it('shows the page in a full-page frame with Close, and a disabled primary before upload', async () => {
    const { router } = renderImportPage();
    expect(await screen.findByRole('heading', { name: 'Import students' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import' }).hasAttribute('disabled')).toBe(true);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('keeps the column guide collapsed, with 14 labelled rows and the exact header names', async () => {
    renderImportPage();
    const toggle = await screen.findByText('What goes in each column');
    const details = toggle.closest('details')!;
    expect(details.open).toBe(false);
    const rows = within(details).getAllByRole('listitem');
    expect(rows).toHaveLength(14);
    expect(within(details).getByText('Student name')).toBeTruthy();
    expect(within(details).getByText('student_name')).toBeTruthy();
    expect(within(details).getByText(/Bangladeshi mobile number/)).toBeTruthy();
    expect(within(details).getAllByText('Required')).toHaveLength(5);
  });

  it('rejects a file over 5 MB client-side and fires no validate request', async () => {
    let requests = 0;
    server.use(
      http.post('/api/v1/students/bulk-upload/validate', () => {
        requests += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    renderImportPage();
    const big = 'x'.repeat(5 * 1024 * 1024 + 1);
    await uploadFile(makeFile('students.csv', big));

    await screen.findByText('This file is too large — choose a smaller file');
    expect(requests).toBe(0);
  });

  it('shows the accepted-row count, a preview table, and disables Confirm when the file has errors', async () => {
    server.use(
      validateHandler({
        staging_id: 'stage-errors',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        rows_to_create: 1,
        preview: [
          {
            row: 2,
            student_name: 'Karim Rahman',
            class: 'Class 5',
            section: 'A',
            guardian1_phone: '+8801711111111',
          },
        ],
        // `BulkImportErrorDto`: column/message/severity. The commit-side
        // `field`/`reason` shape used here before did not match what the
        // server returns from `validate`, so this assertion passed against a
        // contract the real endpoint never sends.
        errors: [
          {
            row: 3,
            column: 'guardian1_phone',
            value: '০১৭১২৩৪৫৬৭',
            message: 'Invalid phone format: guardian1_phone',
            severity: 'error',
          },
        ],
        hard_error_count: 1,
      }),
    );
    renderImportPage();
    await uploadFile(makeFile('students.csv'));

    await screen.findByText(`${formatNumber(1, REGION_BD_EN)} student will be created.`);
    const previewTable = await screen.findByRole('table', { name: /First [\d০-৯]+ rows?/ });
    expect(within(previewTable).getByText('Karim Rahman')).toBeTruthy();
    // Phones go through formatPhone, never the raw international form.
    expect(within(previewTable).queryByText('+8801711111111')).toBeNull();

    // The row error surfaces through the shared BulkImportErrorTable.
    expect(await screen.findByText('০১৭১২৩৪৫৬৭')).toBeTruthy();

    // The primary lives in the footer, disabled while a hard error stands.
    const confirmButton = screen.getByRole('button', { name: /^Import .+ student/ });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('shows the trial seat-limit error in the app language, not the server text', async () => {
    const n = (value: number) => formatNumber(value, REGION_BD_EN);
    server.use(
      validateHandler({
        ...cleanPreviewBody,
        // `bulk-upload.service.ts` adds this row-0 error when the file does not fit.
        errors: [
          {
            row: 0,
            column: null,
            message: 'Seat limit reached: 9 of 10 seats in use, and this file adds 3',
            severity: 'error',
          },
        ],
        hard_error_count: 1,
        seats: { used: 9, limit: 10, new_rows: 3 },
      }),
    );
    renderImportPage();
    await uploadFile(makeFile('students.csv'));

    expect(
      await screen.findByText(
        `You have ${n(9)} of ${n(10)} students. ${n(3)} more will not fit. Contact us to add more students.`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Seat limit reached/)).toBeNull();
  });

  it('does not create any student until Confirm is clicked, then shows the done summary', async () => {
    let commitCalled = false;
    server.use(
      validateHandler(cleanPreviewBody),
      http.post('/api/v1/students/bulk-upload/commit', () => {
        commitCalled = true;
        return HttpResponse.json(
          {
            total_rows: 3,
            success_count: 3,
            error_count: 0,
            created_student_ids: ['a', 'b', 'c'],
            errors: [],
          },
          { status: 201 },
        );
      }),
    );
    renderImportPage();
    await uploadFile(makeFile('students.csv'));

    await screen.findByText(`${formatNumber(3, REGION_BD_EN)} students will be created.`);
    // Preview shown, nothing committed yet.
    expect(commitCalled).toBe(false);

    const user = userEvent.setup();
    const importButton = screen.getByRole('button', { name: /^Import .+ students$/ });
    expect(importButton.hasAttribute('disabled')).toBe(false);
    await user.click(importButton);

    await screen.findByText(`All ${formatNumber(3, REGION_BD_EN)} students were imported.`);
    expect(commitCalled).toBe(true);
    // The invite-guardians checkbox only appears once students exist.
    expect(screen.getByLabelText("Invite the imported students' guardians now")).toBeTruthy();
    // The footer primary turns into the way back to the list.
    expect(screen.getByRole('button', { name: 'Go to the student list' })).toBeTruthy();
  });

  it('surfaces a whole-request 400 from validate as a failed state', async () => {
    server.use(
      validateHandler(
        apiErrorBody(
          400,
          'Missing required columns: roll, section',
          '/api/v1/students/bulk-upload/validate',
        ),
        400,
      ),
    );
    renderImportPage();
    await uploadFile(makeFile('students.csv'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Missing required columns: roll, section');
  });

  it('[#3042] shows our own text for a whole-file code, never the server sentence', async () => {
    server.use(
      validateHandler(
        {
          ...apiErrorBody(400, 'Server English sentence', '/api/v1/students/bulk-upload/validate'),
          details: { code: 'IMPORT_FILE_MISSING_COLUMNS' },
        },
        400,
      ),
    );
    renderImportPage();
    await uploadFile(makeFile('students.csv'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Some columns are missing. Use the sample file's columns.");
    expect(alert.textContent).not.toContain('Server English sentence');
  });

  // [8.11.8] The server route admits ACCOUNTANT and EXECUTIVE, so the page
  // must open for them too — it used to be ADMIN-only, which hid a feature
  // those roles could actually use.
  for (const role of ['ACCOUNTANT', 'EXECUTIVE']) {
    it(`opens the import page for ${role}, which the server route admits`, async () => {
      renderImportPage(role);
      await screen.findByRole('button', { name: 'Download template' });
      expect(screen.queryByText("You don't have permission to view this.")).toBeNull();
    });
  }

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route in place with the shared `AccessDeniedState` copy.
  it('shows the forbidden copy to a role without the bulk-upload permission (TEACHER)', async () => {
    renderImportPage('TEACHER');
    await screen.findByText("You don't have access to this page.");
  });

  // [14.13.2]: the migrate-in entry point is UX-gated on BACKUP_MANAGE,
  // same permission the server enforces on `/settings`'s restore wizard.
  it('shows the migrate-a-whole-school link for ADMIN, who holds BACKUP_MANAGE', async () => {
    renderImportPage('ADMIN');
    await screen.findByRole('button', { name: 'Download template' });
    expect(await screen.findByText('Migrating a whole school?')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Use the full workbook template' });
    expect(link.getAttribute('href')).toBe('/settings');
  });

  it('hides the migrate-a-whole-school link for a role without BACKUP_MANAGE (ACCOUNTANT)', async () => {
    renderImportPage('ACCOUNTANT');
    await screen.findByRole('button', { name: 'Download template' });
    expect(screen.queryByText('Migrating a whole school?')).toBeNull();
  });

  it('is axe clean with the error report shown', async () => {
    server.use(
      validateHandler({
        staging_id: 'stage-axe',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        rows_to_create: 1,
        preview: [
          {
            row: 2,
            student_name: 'Karim Rahman',
            class: 'Class 5',
            section: 'A',
            guardian1_phone: '+8801711111111',
          },
        ],
        errors: [
          {
            row: 2,
            column: 'roll',
            value: '5',
            message: 'Duplicate roll number 5',
            severity: 'error',
          },
        ],
        hard_error_count: 1,
      }),
    );
    const { container } = renderImportPage();
    await uploadFile(makeFile('students.csv'));
    await screen.findByText(`${formatNumber(1, REGION_BD_EN)} student will be created.`);
    await expect(container).toHaveNoViolations();
  });
});
