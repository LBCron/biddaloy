import { File as NodeFile } from 'node:buffer';

import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [81.3.2] The upload page. Only page-specific behaviour is asserted: the three-step strip,
 * the review, the error mapping and the Save footer. Drop zone, expiry and commit plumbing are
 * covered by `bulk-upload-preview.test.tsx`.
 *
 * Files come from node:buffer's `File`; jsdom's Blob hangs MSW's XHR body serialisation.
 */
const E = 'exam-1';
const S = 'sec-1';
const SUB = 'subj-1';
const GRID_URL = `/api/v1/exams/${E}/marks`;
const VALIDATE_URL = `${GRID_URL}/sheet/validate`;
const COMMIT_URL = `${GRID_URL}/sheet/commit`;

const emptyGrid = {
  exam_id: E,
  section_id: S,
  subject_id: SUB,
  state: 'DRAFT' as const,
  submitted_by: null,
  submitted_at: null,
  students: [],
  components: [],
  cells: [],
  derived: {},
};

const change = (row: number, name: string, old: string | null, next: string) => ({
  row,
  student_id: `st-${row}`,
  roll: row,
  student_name: name,
  component_id: 'c1',
  component_name: 'Written',
  old,
  old_status: old === null ? null : 'PRESENT',
  new: next,
  new_status: 'PRESENT',
});

const cleanBody = {
  staging_id: 'stage-1',
  expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  summary: { rows: 3, new: 1, changed: 1, unchanged: 1, absent: 0, exempt: 0, errors: 0 },
  changes: [change(2, 'Rafi Ahmed', null, '90'), change(3, 'Nila Khan', '78', '85')],
  errors: [],
};

function renderPage() {
  server.use(http.get(GRID_URL, () => HttpResponse.json(emptyGrid)));
  return renderWithRouter(routeTree, {
    initialEntries: [`/marks/${E}/${S}/${SUB}/import`],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

async function upload() {
  const user = userEvent.setup({ applyAccept: false });
  await user.click(await screen.findByRole('button', { name: 'Choose file' }));
  await user.upload(
    screen.getByLabelText('Choose file'),
    new NodeFile(['x'], 'sheet.xlsx', { type: 'application/octet-stream' }) as unknown as File,
  );
}

const apiError = (status: number, message: string, details?: Record<string, unknown>) =>
  HttpResponse.json(
    {
      statusCode: status,
      message,
      timestamp: '2026-11-05T00:00:00Z',
      path: COMMIT_URL,
      requestId: 'r1',
      ...(details ? { details } : {}),
    },
    { status },
  );

describe('/marks/$examId/$sectionId/$subjectId/import', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanupTestState();
  });

  it('shows the three steps, then what will change, and saves only on Save', async () => {
    let commitBody: unknown;
    server.use(
      http.post(VALIDATE_URL, () => HttpResponse.json(cleanBody, { status: 201 })),
      http.post(COMMIT_URL, async ({ request }) => {
        commitBody = await request.json();
        return HttpResponse.json({ saved: 2 }, { status: 201 });
      }),
    );
    renderPage();
    await screen.findByText('2. Fill in the marks');
    expect(screen.getByText('3. Upload the sheet')).toBeTruthy();

    await upload();
    await screen.findByText('1 new');
    expect(screen.getByText('1 changed')).toBeTruthy();
    expect(screen.getByText(/Written: empty → 90/)).toBeTruthy();
    expect(screen.getByText(/Written: 78 → 85/)).toBeTruthy();
    expect(commitBody).toBeUndefined();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save 2' }));
    await screen.findByText('2 marks saved');
    expect(commitBody).toEqual({ staging_id: 'stage-1', section_id: S, subject_id: SUB });
  });

  it('puts a row error in plain words and never offers Save', async () => {
    let committed = false;
    server.use(
      http.post(VALIDATE_URL, () =>
        HttpResponse.json(
          {
            staging_id: null,
            expires_at: null,
            summary: { rows: 3, new: 0, changed: 0, unchanged: 2, absent: 0, exempt: 0, errors: 1 },
            changes: [],
            errors: [{ row: 4, roll: 9, component_name: 'Written', code: 'ABOVE_FULL_MARKS' }],
          },
          { status: 201 },
        ),
      ),
      http.post(COMMIT_URL, () => {
        committed = true;
        return HttpResponse.json({ saved: 0 }, { status: 201 });
      }),
    );
    renderPage();
    await upload();

    await screen.findByText('Above full marks');
    expect(screen.queryByText('ABOVE_FULL_MARKS')).toBeNull();
    expect(screen.getByText('1 errors')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Save/ }).hasAttribute('disabled')).toBe(true);
    expect(committed).toBe(false);
  });

  it('D7: row errors next to staged cells keep Save on, with the count and the error table', async () => {
    let commitBody: unknown;
    server.use(
      http.post(VALIDATE_URL, () =>
        HttpResponse.json(
          {
            staging_id: 'stage-2',
            expires_at: '2030-01-01T00:00:00Z',
            summary: { rows: 3, new: 2, changed: 0, unchanged: 0, absent: 0, exempt: 0, errors: 1 },
            changes: [],
            errors: [{ row: 4, roll: 9, component_name: 'Written', code: 'ABOVE_FULL_MARKS' }],
          },
          { status: 201 },
        ),
      ),
      http.post(COMMIT_URL, async ({ request }) => {
        commitBody = await request.json();
        return HttpResponse.json({ saved: 2 }, { status: 201 });
      }),
    );
    renderPage();
    await upload();

    await screen.findByText('Above full marks');
    expect(screen.getByText('1 errors')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save 2' });
    expect(save.hasAttribute('disabled')).toBe(false);

    await userEvent.setup().click(save);
    await screen.findByText('2 marks saved');
    expect(commitBody).toMatchObject({ staging_id: 'stage-2' });
  });

  it('says a sheet from another exam or section is the wrong sheet', async () => {
    server.use(
      http.post(VALIDATE_URL, () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'Bad Request',
            timestamp: '2026-11-05T00:00:00Z',
            path: VALIDATE_URL,
            requestId: 'r1',
            details: { code: 'WRONG_SHEET' },
          },
          { status: 400 },
        ),
      ),
    );
    renderPage();
    await upload();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('This sheet belongs to another exam or section');
  });

  // The real `details.code` values the server sends (#3584): the generic import codes carry an
  // `IMPORT_FILE_` prefix, so a match on the bare names never hit and the server English showed.
  it.each([
    [
      400,
      'IMPORT_FILE_UNREADABLE',
      'We could not read this file. Download a fresh sheet and try again',
    ],
    [
      400,
      'IMPORT_FILE_UNSUPPORTED_TYPE',
      'This file type is not supported. Upload the Excel (.xlsx) sheet you downloaded',
    ],
    [400, 'IMPORT_FILE_TOO_LARGE', 'This file is too big'],
    [400, 'IMPORT_FILE_TOO_MANY_ROWS', 'This sheet has too many rows'],
    [
      400,
      'IMPORT_FILE_NO_ROWS',
      'This sheet has no student rows. Download a fresh sheet and fill it in',
    ],
    [
      400,
      'DUPLICATE_COMPONENT',
      'This sheet has the same marks column twice. Download a fresh sheet and try again',
    ],
    [413, undefined, 'This file is too big'],
  ])(
    'a %i with code %s shows its own sentence, never the server text',
    async (status, code, text) => {
      server.use(
        http.post(VALIDATE_URL, () =>
          apiError(status, 'SERVER ENGLISH', code === undefined ? undefined : { code }),
        ),
      );
      renderPage();
      await upload();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(text);
    },
  );

  it('a 409 that is not GRID_SUBMITTED (exam published) gets the general sentence', async () => {
    server.use(
      http.post(VALIDATE_URL, () =>
        apiError(409, 'This exam is already published — its marks can no longer be edited.'),
      ),
    );
    renderPage();
    await upload();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^This sheet cannot be used right now/);
    expect(screen.queryByText(/is submitted\. Ask an admin/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to grid' })).toBeTruthy();
  });

  it('keeps Save off when the server staged nothing (staging_id empty)', async () => {
    server.use(
      http.post(VALIDATE_URL, () =>
        HttpResponse.json({ ...cleanBody, staging_id: '' }, { status: 201 }),
      ),
    );
    renderPage();
    await upload();
    await screen.findByText('1 new');
    expect(screen.getByRole('button', { name: /^Save/ }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the count on Save, and keeps it off with nothing new or changed', async () => {
    server.use(
      http.post(VALIDATE_URL, () =>
        HttpResponse.json(
          {
            ...cleanBody,
            summary: { rows: 3, new: 0, changed: 0, unchanged: 3, absent: 0, exempt: 0, errors: 0 },
            changes: [],
          },
          { status: 201 },
        ),
      ),
    );
    renderPage();
    await upload();
    await screen.findByText(/nothing to save/);
    expect(screen.getByRole('button', { name: 'Save 0' }).hasAttribute('disabled')).toBe(true);
  });

  it('409 on Save: a translated sentence, never the server text, and a way back to the grid', async () => {
    server.use(
      http.post(VALIDATE_URL, () => HttpResponse.json(cleanBody, { status: 201 })),
      http.post(COMMIT_URL, () =>
        apiError(409, 'SERVER ENGLISH: list is submitted', { code: 'GRID_SUBMITTED' }),
      ),
    );
    renderPage();
    await upload();
    await screen.findByText('1 new');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save 2' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'This marks list is submitted. Ask an admin to reopen it before uploading a sheet.',
    );
    expect(screen.queryByText(/SERVER ENGLISH/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to grid' })).toBeTruthy();
  });

  it('409 on validate gets the same sentence and link', async () => {
    server.use(
      http.post(VALIDATE_URL, () => apiError(409, 'SERVER ENGLISH', { code: 'GRID_SUBMITTED' })),
    );
    renderPage();
    await upload();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/is submitted/);
    expect(screen.getByRole('button', { name: 'Back to grid' })).toBeTruthy();
  });

  it('503 on Save: a translated sentence (Redis down)', async () => {
    server.use(
      http.post(VALIDATE_URL, () => HttpResponse.json(cleanBody, { status: 201 })),
      http.post(COMMIT_URL, () => apiError(503, 'SERVER ENGLISH: redis')),
    );
    renderPage();
    await upload();
    await screen.findByText('1 new');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save 2' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Uploading is not available right now. Please try again in a few minutes.',
    );
  });

  it('410 on Save: says the review expired and offers another upload', async () => {
    server.use(
      http.post(VALIDATE_URL, () => HttpResponse.json(cleanBody, { status: 201 })),
      http.post(COMMIT_URL, () => apiError(410, 'SERVER ENGLISH: gone')),
    );
    renderPage();
    await upload();
    await screen.findByText('1 new');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save 2' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/SERVER ENGLISH/);
    expect(screen.getByRole('button', { name: /another/i })).toBeTruthy();
  });

  it('asks before leaving with an unsaved review (Cancel, then Keep editing)', async () => {
    server.use(http.post(VALIDATE_URL, () => HttpResponse.json(cleanBody, { status: 201 })));
    renderPage();
    await upload();
    await screen.findByText('1 new');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByText('Discard your changes?');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(screen.getByText('1 new')).toBeTruthy();
  });

  it('Esc with an unsaved review asks first', async () => {
    server.use(http.post(VALIDATE_URL, () => HttpResponse.json(cleanBody, { status: 201 })));
    renderPage();
    await upload();
    await screen.findByText('1 new');
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    await screen.findByText('Discard your changes?');
  });

  it('after Save, Close lands on the grid and loads it fresh', async () => {
    // The commit hook invalidates the grid and progress queries (covered in hooks/exams.test.tsx);
    // here: the page hands over to the grid, which fetches it.
    let gridHits = 0;
    server.use(
      http.get(GRID_URL, () => {
        gridHits += 1;
        return HttpResponse.json(emptyGrid);
      }),
      http.post(VALIDATE_URL, () => HttpResponse.json(cleanBody, { status: 201 })),
      http.post(COMMIT_URL, () => HttpResponse.json({ saved: 2 }, { status: 201 })),
    );
    renderWithRouter(routeTree, {
      initialEntries: [`/marks/${E}/${S}/${SUB}/import`],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });
    await upload();
    await screen.findByText('1 new');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save 2' }));
    await screen.findByText('2 marks saved');
    // The footer's primary Close is the last one (the shell also has a header Close).
    await user.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(gridHits).toBeGreaterThan(0));
  });

  it('the first step downloads the sheet', async () => {
    const hit = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
    );
    server.use(
      http.get(`${GRID_URL}/sheet`, () => {
        hit();
        return new HttpResponse(new Uint8Array([1]), {
          headers: { 'content-disposition': 'attachment; filename="m.xlsx"' },
        });
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '1. Download the sheet' }));
    await waitFor(() => expect(hit).toHaveBeenCalledTimes(1));
  });

  it('shows an error toast when the sheet download fails', async () => {
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    try {
      server.use(
        http.get(`${GRID_URL}/sheet`, () =>
          HttpResponse.json({ message: 'boom' }, { status: 500 }),
        ),
      );
      renderPage();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: '1. Download the sheet' }));
      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith('Something went wrong. Please try again.'),
      );
    } finally {
      toastSpy.mockRestore();
    }
  });
});
