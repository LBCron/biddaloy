import { File as NodeFile } from 'node:buffer';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [76.5.05] `/attendance/import`: pick + download, upload, review, save.
 * Nothing writes until "Save"; commit carries `Idempotency-Key`.
 */
const SECTION_ID = '11111111-1111-4111-8111-111111111111';
const IMPORT_ID = '22222222-2222-4222-8222-222222222222';
const STAGING_ID = '33333333-3333-4333-8333-333333333333';

function makeFile(name = 'sheet.xlsx'): File {
  return new NodeFile(['a,b'], name, { type: 'text/csv' }) as File;
}

function renderPage(search = '') {
  return renderWithRouter(routeTree, {
    initialEntries: [`/attendance/import${search}`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

const row = (n: number, outcome: string, extra: object = {}) => ({
  row: n,
  date: '2026-11-02',
  section_id: SECTION_ID,
  class_name: 'Class 5',
  section_name: 'A',
  roll: n,
  before: null,
  after: 'PRESENT',
  outcome,
  ...extra,
});

function preview(overrides: object = {}) {
  return {
    staging_id: STAGING_ID,
    rows: [row(2, 'NEW'), row(3, 'CHANGED', { before: 'ABSENT' })],
    counts: { new: 1, changed: 1, unchanged: 0, error: 0 },
    overwrite_count: 1,
    ...overrides,
  };
}

async function toReview(body: object = preview()) {
  server.use(http.post('/api/v1/attendance/import/validate', () => HttpResponse.json(body)));
  const user = userEvent.setup({ applyAccept: false });
  await user.click(await screen.findByRole('button', { name: 'Upload your filled sheet' }));
  await user.upload(await screen.findByLabelText('Choose file'), makeFile());
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  await screen.findByText('Review before saving');
  return user;
}

beforeEach(() => {
  server.use(
    http.get('/api/v1/attendance/my-sections', () =>
      HttpResponse.json([
        {
          section_id: SECTION_ID,
          section_name: 'A',
          class_id: 'c1',
          class_name: 'Class 5',
          student_count: 30,
          class_teacher_name: null,
          is_working_day: true,
          today: null,
        },
      ]),
    ),
  );
});

afterEach(cleanupTestState);

describe('/attendance/import', () => {
  it('shows the overwrite banner and the save count, then lands on the detail route', async () => {
    let key: string | null = null;
    let body: unknown;
    server.use(
      http.post('/api/v1/attendance/import/commit', async ({ request }) => {
        key = request.headers.get('Idempotency-Key');
        body = await request.json();
        return HttpResponse.json({ import_id: IMPORT_ID }, { status: 201 });
      }),
    );
    renderPage();
    const user = await toReview();

    expect(screen.getByText('1 recorded marks will change.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save 2 changes' }));

    // The detail route opened (its fetch is unmocked here, so it shows the load error).
    await screen.findByText('Could not load this upload.', {}, { timeout: 5000 });
    expect(key).toBeTruthy();
    expect(body).toEqual({ staging_id: STAGING_ID });
  });

  it('disables Save at zero valid rows', async () => {
    renderPage();
    await toReview(
      preview({
        staging_id: null,
        rows: [row(2, 'ERROR', { code: 'BAD_STATUS', after: null })],
        counts: { new: 0, changed: 0, unchanged: 0, error: 1 },
        overwrite_count: 0,
      }),
    );

    expect(screen.queryByText(/recorded marks will change/)).toBeNull();
    const save = screen.getByRole('button', { name: 'Save 0 changes' });
    expect(save.hasAttribute('disabled')).toBe(true);
  });

  it('returns to upload when the staged review has expired', async () => {
    server.use(
      http.post('/api/v1/attendance/import/commit', () =>
        HttpResponse.json(
          { statusCode: 410, message: 'gone', requestId: 'r', path: '/', timestamp: 't' },
          { status: 410 },
        ),
      ),
    );
    renderPage();
    const user = await toReview();

    await user.click(screen.getByRole('button', { name: 'Save 2 changes' }));

    expect(await screen.findByText('This review has expired')).toBeTruthy();
    expect(screen.getByText('Upload your filled sheet')).toBeTruthy();
  });

  it('?sectionId pre-ticks that section', async () => {
    renderPage(`?sectionId=${SECTION_ID}`);

    const box = await screen.findByRole('checkbox', { name: 'Class 5 – A' });
    await waitFor(() => expect(box.getAttribute('data-state')).toBe('checked'));
    expect(screen.getByRole('button', { name: 'Download sheet' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('?supersedes is forwarded on commit', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/attendance/import/commit', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ import_id: IMPORT_ID }, { status: 201 });
      }),
    );
    renderPage(`?supersedes=${IMPORT_ID}`);
    const user = await toReview();

    await user.click(screen.getByRole('button', { name: 'Save 2 changes' }));

    // The detail route opened (its fetch is unmocked here, so it shows the load error).
    await screen.findByText('Could not load this upload.', {}, { timeout: 5000 });
    expect(body).toEqual({ staging_id: STAGING_ID, supersedes_import_id: IMPORT_ID });
  });

  it('returns to upload on a 404 too (staged review is gone)', async () => {
    server.use(
      http.post('/api/v1/attendance/import/commit', () =>
        HttpResponse.json(
          { statusCode: 404, message: 'gone', requestId: 'r', path: '/', timestamp: 't' },
          { status: 404 },
        ),
      ),
    );
    renderPage();
    const user = await toReview();

    await user.click(screen.getByRole('button', { name: 'Save 2 changes' }));

    expect(await screen.findByText('This review has expired')).toBeTruthy();
  });

  it('keeps Save off until "skip the rows with errors" is ticked when some rows have errors', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/attendance/import/commit', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ import_id: IMPORT_ID }, { status: 201 });
      }),
    );
    renderPage();
    const user = await toReview(
      preview({
        rows: [row(2, 'NEW'), row(3, 'ERROR', { code: 'BAD_STATUS', after: null })],
        counts: { new: 1, changed: 0, unchanged: 0, error: 1 },
        overwrite_count: 0,
      }),
    );

    const save = screen.getByRole('button', { name: 'Save 1 changes' });
    expect(save.hasAttribute('disabled')).toBe(true);

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Save the correct rows and skip the rows with errors',
      }),
    );
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);

    // The detail route opened (its fetch is unmocked here, so it shows the load error).
    await screen.findByText('Could not load this upload.', {}, { timeout: 5000 });
    expect(body).toEqual({ staging_id: STAGING_ID });
  });

  it('?sectionId for a section the user may not write is not pre-ticked', async () => {
    renderPage('?sectionId=99999999-9999-4999-8999-999999999999');

    const box = await screen.findByRole('checkbox', { name: 'Class 5 – A' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Download sheet' }).hasAttribute('disabled')).toBe(
        true,
      ),
    );
    expect(box.getAttribute('data-state')).toBe('unchecked');
  });

  // [review] The step-2 Back button reads "Back", not the raw `actions.back` key.
  it('shows a translated Back on the upload step and returns to step 1', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Upload your filled sheet' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Choose what to fill in')).toBeTruthy();
    expect(screen.queryByText('actions.back')).toBeNull();
  });

  // [review] A 409 STALE uses up the stage: back to upload with its own sentence, not "Could not save".
  it('returns to upload with the marks-changed sentence on a 409 STALE', async () => {
    server.use(
      http.post('/api/v1/attendance/import/commit', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'x',
            requestId: 'r',
            path: '/',
            timestamp: 't',
            details: { code: 'ATTENDANCE_IMPORT_STALE' },
          },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    const user = await toReview();
    await user.click(screen.getByRole('button', { name: 'Save 2 changes' }));
    expect(
      await screen.findByText(/The register changed after you checked the sheet/),
    ).toBeTruthy();
    expect(screen.getByText('Upload the sheet again')).toBeTruthy();
    expect(screen.queryByText('Could not save. Nothing was changed.')).toBeNull();
  });

  it('returns to upload on the day gate 403 too', async () => {
    server.use(
      http.post('/api/v1/attendance/import/commit', () =>
        HttpResponse.json(
          { statusCode: 403, message: 'x', requestId: 'r', path: '/', timestamp: 't' },
          { status: 403 },
        ),
      ),
    );
    renderPage();
    const user = await toReview();
    await user.click(screen.getByRole('button', { name: 'Save 2 changes' }));
    expect(await screen.findByText(/You cannot save one of these days now/)).toBeTruthy();
  });

  // [review] With `supersedes`, a 404 may mean only "earlier upload not found" (checked before the
  // stage is used): stay on review, drop it, and let the next Save go without it. No auto-retry.
  it('drops a missing supersedes on 404 and the next Save goes without it', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('/api/v1/attendance/import/commit', async ({ request }) => {
        bodies.push(await request.json());
        if (bodies.length === 1) {
          return HttpResponse.json(
            { statusCode: 404, message: 'x', requestId: 'r', path: '/', timestamp: 't' },
            { status: 404 },
          );
        }
        return HttpResponse.json({ import_id: IMPORT_ID }, { status: 201 });
      }),
    );
    const { router } = renderPage(`?supersedes=${IMPORT_ID}`);
    const user = await toReview();
    await user.click(screen.getByRole('button', { name: 'Save 2 changes' }));
    expect(await screen.findByText(/The earlier upload was not found/)).toBeTruthy();
    expect(bodies).toHaveLength(1);
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('supersedes'));
    await user.click(screen.getByRole('button', { name: 'Save 2 changes' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ staging_id: STAGING_ID });
  });

  // [review] A failed section list says so and offers a retry, not just "Pick at least one section".
  it('shows a retry when the section list fails to load', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'x', requestId: 'r', path: '/', timestamp: 't' },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    expect(
      await screen.findByText('Could not load your sections.', {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('Pick at least one section.')).toBeNull();
  });
});
