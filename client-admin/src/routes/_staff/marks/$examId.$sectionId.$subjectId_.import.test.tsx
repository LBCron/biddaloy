import { File as NodeFile } from 'node:buffer';

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
    await user.click(screen.getByRole('button', { name: 'Save' }));
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
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    expect(committed).toBe(false);
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
});
