import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, examFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

type State = 'DRAFT' | 'SUBMITTED';

const row = (section: string, subject: string, id: string, state: State) => ({
  section_id: `sec-${id}`,
  section_name: section,
  subject_id: `subj-${id}`,
  subject_name: subject,
  subject_name_bn: null,
  state,
});

function mockExam(
  outstanding: ReturnType<typeof row>[],
  exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' }),
) {
  const counts = {
    DRAFT: outstanding.filter((r) => r.state === 'DRAFT').length,
    SUBMITTED: outstanding.filter((r) => r.state === 'SUBMITTED').length,
  };
  server.use(
    http.get('/api/v1/exams', () =>
      HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
    ),
    http.get(`/api/v1/exams/${exam.id}/marks/progress`, () =>
      HttpResponse.json({ counts, outstanding, grids: outstanding }),
    ),
  );
  return exam;
}

// The sidebar also has an "Enter marks" link; the rows' links point into an exam.
const rowLinks = (name: string) =>
  screen
    .queryAllByRole('link', { name })
    .filter((a) => a.getAttribute('href')?.startsWith('/marks/exam-1'));
const findRowLinks = (name: string) =>
  waitFor(() => {
    const links = rowLinks(name);
    expect(links).not.toHaveLength(0);
    return links;
  });

const render = (role: string) =>
  renderWithRouter(routeTree, {
    initialEntries: ['/marks'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

describe('/marks', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  it('lists a draft with "Enter marks" linking into the entry page, and a submitted one with "View marks"', async () => {
    mockExam([row('Six - B', 'Math', '2', 'SUBMITTED'), row('Six - A', 'Math', '1', 'DRAFT')]);
    render('TEACHER');

    await screen.findByRole('heading', { name: 'Enter marks' });
    const enterLinks = await findRowLinks('Enter marks');
    expect(enterLinks).toHaveLength(1);
    expect(enterLinks[0]!.getAttribute('href')).toBe('/marks/exam-1/sec-1/subj-1');
    const viewLinks = rowLinks('View marks');
    expect(viewLinks).toHaveLength(1);
    expect(viewLinks[0]!.getAttribute('href')).toBe('/marks/exam-1/sec-2/subj-2');
    // Each row carries its own status badge.
    const draftRow = within(enterLinks[0]!.closest('tr, li')!);
    const doneRow = within(viewLinks[0]!.closest('tr, li')!);
    expect(draftRow.getByText('Not submitted')).toBeTruthy();
    expect(draftRow.queryByText('Submitted')).toBeNull();
    expect(doneRow.getByText('Submitted')).toBeTruthy();
  });

  it('shows the exam picker (?) [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    mockExam([row('Six - A', 'Math', '1', 'DRAFT')]);
    render('TEACHER');
    await screen.findByRole('heading', { name: 'Enter marks' });
    await expectHelp('examsResults.marksEntry.field.exam');
  });

  it('labels the exam picker, names the class, and shows progress in the subtitle', async () => {
    const exam = mockExam([
      row('Six - A', 'Math', '1', 'DRAFT'),
      row('Six - B', 'Math', '2', 'SUBMITTED'),
    ]);
    render('TEACHER');

    const picker = await screen.findByLabelText('Exam');
    expect(picker.textContent).toContain(`${exam.name} · ${exam.class?.name}`);
    await screen.findByText(
      `${formatNumber(1, REGION_BD_BN)} of ${formatNumber(2, REGION_BD_BN)} marks lists submitted`,
    );
  });

  it('shows drafts above submitted rows and a total in the footer', async () => {
    mockExam([row('Six - B', 'Math', '2', 'SUBMITTED'), row('Six - A', 'Math', '1', 'DRAFT')]);
    render('TEACHER');

    await findRowLinks('Enter marks');
    // Draft (sec-1) before submitted (sec-2), whatever order the server sent.
    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
      .filter((h) => h?.startsWith('/marks/exam-1'));
    expect(hrefs).toEqual(['/marks/exam-1/sec-1/subj-1', '/marks/exam-1/sec-2/subj-2']);
    expect(screen.getByText(`Total ${formatNumber(2, REGION_BD_BN)}`)).toBeTruthy();
  });

  it('lists fully submitted grids even though outstanding is empty', async () => {
    const exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' });
    server.use(
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
      ),
      http.get('/api/v1/exams/exam-1/marks/progress', () =>
        HttpResponse.json({
          counts: { DRAFT: 0, SUBMITTED: 2 },
          outstanding: [],
          grids: [
            row('Six - A', 'Math', '1', 'SUBMITTED'),
            row('Six - B', 'Math', '2', 'SUBMITTED'),
          ],
        }),
      ),
    );
    render('ADMIN');
    const links = await findRowLinks('View marks');
    expect(links).toHaveLength(2);
    expect(screen.queryByText('No marks lists yet')).toBeNull();
  });

  it('the status filter hides the other group', async () => {
    const user = userEvent.setup();
    mockExam([row('Six - B', 'Math', '2', 'SUBMITTED'), row('Six - A', 'Math', '1', 'DRAFT')]);
    render('TEACHER');

    await findRowLinks('Enter marks');
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Not submitted' }));
    await screen.findByText(`Total ${formatNumber(1, REGION_BD_BN)}`);
    expect(rowLinks('View marks')).toHaveLength(0);
  });

  it('renders the search field only with EXAM_MANAGE', async () => {
    mockExam([row('Six - A', 'Math', '1', 'DRAFT')]);
    const first = render('TEACHER');
    await findRowLinks('Enter marks');
    expect(screen.queryByLabelText('Search')).toBeNull();
    first.unmount();

    mockExam([row('Six - A', 'Math', '1', 'DRAFT')]);
    render('ADMIN');
    await screen.findByLabelText('Search');
  });

  it('shows the empty state and no footer when there are no marks lists', async () => {
    mockExam([]);
    render('TEACHER');

    await screen.findByText('No marks lists yet');
    expect(screen.queryByText(/^Total/)).toBeNull();
  });

  it('shows "No exams yet" and no picker when there are no exams', async () => {
    server.use(
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 }),
      ),
    );
    render('TEACHER');

    await screen.findByText('No exams yet');
    expect(screen.queryByLabelText('Exam')).toBeNull();
  });

  it('shows the load error line when the progress request fails', async () => {
    const exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' });
    server.use(
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
      ),
      http.get('/api/v1/exams/exam-1/marks/progress', () =>
        HttpResponse.json({ message: 'boom' }, { status: 400 }),
      ),
    );
    render('TEACHER');

    await screen.findByText("Couldn't load marks lists.");
  });
});
