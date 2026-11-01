import { ExamStatus } from '@biddaloy/shared';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import {
  classSectionFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

const MERIT_ROW = {
  student_id: 'stu-1',
  roll_number: 1,
  full_name: 'Rahim Uddin',
  section_id: 'sec-1',
  section_name: 'Six - A',
  total_marks: 450,
  gpa: 4.5,
  grade: 'A',
  position: 1,
  section_position: 1,
  is_fail: false,
};

const DEFAULTED_ROW = {
  ...MERIT_ROW,
  student_id: 'stu-2',
  roll_number: 2,
  full_name: 'Karim Sheikh',
  is_fail: true,
  failed_subjects: [{ subject_id: 'subj-1', name: 'Math' }],
  absent_subjects: [{ subject_id: 'subj-2', name: 'Physics' }],
};

const PASS_FAIL_BODY = {
  status: ExamStatus.PROCESSED,
  subjects: [
    {
      subject_id: 'subj-1',
      subject_name: 'Math',
      appeared: 30,
      passed: 25,
      failed: 5,
      absent: 0,
      pass_pct: 83.3,
      highest: 98,
      average: 72.5,
      grade_distribution: { A: 10, B: 15, F: 5 },
    },
  ],
  overall: {
    subject_id: null,
    subject_name: 'OVERALL_FROM_SERVER',
    appeared: 30,
    passed: 25,
    failed: 5,
    absent: 0,
    pass_pct: 83.3,
    highest: 98,
    average: 72.5,
    grade_distribution: { A: 10, B: 15, F: 5 },
  },
};

const PASS_FAIL_COMPONENT_BODY = {
  status: ExamStatus.PROCESSED,
  rows: [
    {
      subject_id: 'subj-1',
      subject_name: 'Math',
      component_id: 'comp-1',
      component_name: 'Written',
      sequence: 1,
      appeared: 30,
      absent: 0,
      below_pass: 5,
      highest: 98,
      average: 72.5,
    },
  ],
};

function mockExam(overrides: Parameters<typeof examFactory>[0] = {}) {
  const exam = examFactory({
    id: 'exam-1',
    name: 'Half Yearly 2026',
    status: ExamStatus.PROCESSED,
    ...overrides,
  });
  const section = classSectionFactory({ id: 'sec-1', class: exam.class, section_name: 'A' });
  server.use(
    http.get('/api/v1/exams', () =>
      HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
    ),
    http.get(`/api/v1/classes/${exam.class_id}/sections`, () => HttpResponse.json([section])),
    http.get(`/api/v1/exams/${exam.id}/analysis/merit`, () =>
      HttpResponse.json({ status: exam.status, rows: [MERIT_ROW] }),
    ),
    http.get(`/api/v1/exams/${exam.id}/analysis/defaulted`, () =>
      HttpResponse.json({ status: exam.status, rows: [DEFAULTED_ROW] }),
    ),
    http.get(`/api/v1/exams/${exam.id}/analysis/pass-fail`, () =>
      HttpResponse.json(PASS_FAIL_BODY),
    ),
    http.get(`/api/v1/exams/${exam.id}/analysis/pass-fail/components`, () =>
      HttpResponse.json(PASS_FAIL_COMPONENT_BODY),
    ),
  );
  return exam;
}

const MANY_MERIT = Array.from({ length: 60 }, (_, i) => ({
  ...MERIT_ROW,
  student_id: `stu-${i + 1}`,
  roll_number: i + 1,
  full_name: `Student ${String(i + 1).padStart(2, '0')}`,
  position: i + 1,
  section_position: i + 1,
}));

const render = (url: string, role = 'ADMIN') =>
  renderWithRouter(routeTree, {
    initialEntries: [url],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

describe('/analysis', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  // [44.4 / #3013] The (?) beside the print and CSV actions resolves the guide entry.
  it('shows the (?) beside the print and CSV actions when a handbook URL is set', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    const exam = mockExam();
    render(`/analysis?examId=${exam.id}&tab=pass-fail`);
    // By id: the page-level (?) carries the same "Help: <page title>" name.
    await waitFor(() =>
      expect(
        document.querySelector('[data-help-id="examsResults.analysis.action.print"]'),
      ).not.toBeNull(),
    );
  });

  it('shows the by-part (?) on the pass/fail tab [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    const exam = mockExam();
    render(`/analysis?examId=${exam.id}&tab=pass-fail`);
    await expectHelp('examsResults.analysis.field.byPart');
  });

  it('switching tabs updates the URL', async () => {
    const user = userEvent.setup();
    const exam = mockExam();
    const { router } = render(`/analysis?examId=${exam.id}&tab=merit`);

    const failedTab = await screen.findByRole('tab', { name: 'Failed or absent' });
    expect(screen.getByRole('tab', { name: 'Merit list' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Pass/fail by subject' })).toBeTruthy();
    await user.click(failedTab);

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ tab: 'defaulted' });
    });
  });

  it('tab list uses the scrolling line variant and stays out of print', async () => {
    const exam = mockExam();
    render(`/analysis?examId=${exam.id}&tab=merit`);

    const tablist = await screen.findByRole('tablist');
    expect(tablist.getAttribute('data-variant')).toBe('line');
    expect(tablist.className).toContain('print:hidden');
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3);
  });

  it('merit pages 25 rows at a time and prints every row', async () => {
    const exam = mockExam();
    server.use(
      http.get(`/api/v1/exams/${exam.id}/analysis/merit`, () =>
        HttpResponse.json({ status: exam.status, rows: MANY_MERIT }),
      ),
    );
    const user = userEvent.setup();
    render(`/analysis?examId=${exam.id}&tab=merit`);

    await screen.findByText('Student 01');
    const area = within(document.getElementById('analysis-print-area')!);
    expect(area.getAllByText(/^Student \d\d$/)).toHaveLength(25);
    expect(screen.getByRole('button', { name: /next/i })).toBeTruthy();

    let rowsAtPrint = 0;
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint')); // a real browser fires it
      rowsAtPrint = area.getAllByText(/^Student \d\d$/).length;
    };
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(rowsAtPrint).toBe(60);

    // afterprint brings the pager back.
    window.dispatchEvent(new Event('afterprint'));
    await waitFor(() => expect(area.getAllByText(/^Student \d\d$/)).toHaveLength(25));
  });

  it('Ctrl/Cmd+P (beforeprint) also renders every row, afterprint pages again [2697]', async () => {
    const exam = mockExam();
    server.use(
      http.get(`/api/v1/exams/${exam.id}/analysis/merit`, () =>
        HttpResponse.json({ status: exam.status, rows: MANY_MERIT }),
      ),
    );
    render(`/analysis?examId=${exam.id}&tab=merit`);

    await screen.findByText('Student 01');
    const area = within(document.getElementById('analysis-print-area')!);
    window.dispatchEvent(new Event('beforeprint'));
    expect(area.getAllByText(/^Student \d\d$/)).toHaveLength(60);
    window.dispatchEvent(new Event('afterprint'));
    await waitFor(() => expect(area.getAllByText(/^Student \d\d$/)).toHaveLength(25));
  });

  it('labels both pickers and names the class in the exam option', async () => {
    const exam = mockExam();
    render(`/analysis?examId=${exam.id}&tab=merit`);

    const examPicker = await screen.findByLabelText('Exam');
    expect(examPicker.textContent).toContain(`${exam.name} · ${exam.class.name}`);
    expect(screen.getByLabelText('Section')).toBeTruthy();
  });

  it('shows Print and Download CSV once in the header, not inside the tab', async () => {
    const exam = mockExam();
    render(`/analysis?examId=${exam.id}&tab=merit`);

    await screen.findByText('Rahim Uddin');
    expect(screen.getAllByRole('button', { name: 'Print' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Download CSV' })).toHaveLength(1);
    const area = document.getElementById('analysis-print-area')!;
    expect(within(area).queryByRole('button', { name: 'Print' })).toBeNull();
  });

  it('merit shows a Pass badge, tenant numerals and a total', async () => {
    const exam = mockExam();
    render(`/analysis?examId=${exam.id}&tab=merit`);

    await screen.findByText('Rahim Uddin');
    const area = within(document.getElementById('analysis-print-area')!);
    expect(area.getByText('Pass')).toBeTruthy();
    expect(area.getByText(formatNumber(4.5, REGION_BD_BN, { decimals: 2 }))).toBeTruthy();
    expect(area.getByText(formatNumber(450, REGION_BD_BN))).toBeTruthy();
    const one = formatNumber(1, REGION_BD_BN);
    expect(screen.getByText(`Showing ${one}–${one} of ${one}`)).toBeTruthy();
  });

  it('merit shows section position when a section is chosen', async () => {
    const exam = mockExam();
    render(`/analysis?examId=${exam.id}&sectionId=sec-1&tab=merit`);

    await screen.findByText('Section position');
  });

  it('defaulted reasons render', async () => {
    const exam = mockExam();
    render(`/analysis?examId=${exam.id}&tab=defaulted`);

    await screen.findByText(/Failed: Math/);
    await screen.findByText(/Absent: Physics/);
  });

  it('the by-part toggle swaps the table', async () => {
    const user = userEvent.setup();
    const exam = mockExam();
    render(`/analysis?examId=${exam.id}&tab=pass-fail`);

    await screen.findByText('Math');
    expect(screen.queryByText('Written')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'By part' }));

    await screen.findByText('Written');
  });

  it('shows the translated overall row, never the server word, in tenant numerals', async () => {
    const exam = mockExam();
    render(`/analysis?examId=${exam.id}&tab=pass-fail`);

    await screen.findByText('Overall');
    expect(screen.queryByText('OVERALL_FROM_SERVER')).toBeNull();
    expect(
      screen.getAllByText(`${formatNumber(83.3, REGION_BD_BN, { decimals: 1 })}%`).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(`A: ${formatNumber(10, REGION_BD_BN)}`)).toHaveLength(2);
    // "Total n" counts subjects, not the overall row.
    expect(screen.getByText(`Total ${formatNumber(1, REGION_BD_BN)}`)).toBeTruthy();
  });

  it('shows the not-processed state without Print/CSV, and the exam link only with EXAM_MANAGE', async () => {
    const exam = mockExam({ status: ExamStatus.DRAFT });
    const admin = render(`/analysis?examId=${exam.id}&tab=merit`);

    await screen.findByText('Results are not ready yet');
    expect(screen.getByRole('button', { name: 'Open the exam' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
    admin.unmount();

    mockExam({ status: ExamStatus.DRAFT });
    render(`/analysis?examId=${exam.id}&tab=merit`, 'TEACHER');
    await screen.findByText('Results are not ready yet');
    expect(screen.queryByRole('button', { name: 'Open the exam' })).toBeNull();
  });

  // #1833: a teacher's picker lists only the sections they are assigned to (Epic 75 D2).
  it('TEACHER: the section picker offers only assigned sections', async () => {
    const user = userEvent.setup();
    const exam = mockExam();
    server.use(
      http.get(`/api/v1/classes/${exam.class_id}/sections`, () =>
        HttpResponse.json([
          classSectionFactory({ id: 'sec-1', class: exam.class, section_name: 'Mine' }),
          classSectionFactory({ id: 'sec-2', class: exam.class, section_name: 'Theirs' }),
        ]),
      ),
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([{ section_id: 'sec-1', section_name: 'Mine' }]),
      ),
    );
    render(`/analysis?examId=${exam.id}&tab=merit`, 'TEACHER');
    await user.click(await screen.findByRole('combobox', { name: 'Section' }));
    await screen.findByRole('option', { name: 'Mine' });
    expect(screen.queryByRole('option', { name: 'Theirs' })).toBeNull();
  });

  it('SUPER_ADMIN and ADMIN: the picker lists every section and never calls my-sections', async () => {
    const user = userEvent.setup();
    const exam = mockExam();
    let called = false;
    server.use(
      http.get(`/api/v1/classes/${exam.class_id}/sections`, () =>
        HttpResponse.json([
          classSectionFactory({ id: 'sec-1', class: exam.class, section_name: 'Mine' }),
          classSectionFactory({ id: 'sec-2', class: exam.class, section_name: 'Theirs' }),
        ]),
      ),
      http.get('/api/v1/attendance/my-sections', () => {
        called = true;
        return HttpResponse.json([]);
      }),
    );
    render(`/analysis?examId=${exam.id}&tab=merit`, 'SUPER_ADMIN');
    await user.click(await screen.findByRole('combobox', { name: 'Section' }));
    await screen.findByRole('option', { name: 'Theirs' });
    expect(called).toBe(false);
  });
});
