import { toast } from '@biddaloy/ui/components';
import {
  apiErrorBody,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

/**
 * [19.9.1] Portal results — published-only (D19), multi-child switching
 * (reusing `fees.tsx`'s picker), Print rendering `ReportCard`. Exercised
 * through the real route tree, same reasoning `portal/fees.test.tsx`
 * documents for itself.
 */
describe('/portal/results', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function child(name: string, id: string, className: string, section: string, roll: number) {
    return studentFactory({
      id,
      full_name: name,
      roll_number: roll,
      class_section: classSectionFactory({
        section_name: section,
        class: classFactory({ name: className }),
      }),
    });
  }

  const fatima = child('Fatima Rahman', 'student-1', 'Class 8', 'B', 14);
  const imran = child('Imran Rahman', 'student-2', 'Class 3', 'A', 7);

  function resultRow(
    examId: string,
    name: string,
    published: boolean,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      exam_id: examId,
      exam_name: name,
      exam_kind: 'TERM',
      published,
      total_marks: 450,
      gpa: 5.0,
      grade: 'A+',
      position: 1,
      is_fail: false,
      ...overrides,
    };
  }

  function card(examName: string) {
    return {
      exam_name: examName,
      student: { full_name: 'Fatima Rahman', roll_number: 14 },
      result: { total_marks: 450, gpa: 5.0, grade: 'A+', position: 1, is_fail: false },
      subjects: [
        {
          subject_id: 'subj-1',
          subject_name: 'Mathematics',
          obtained: 90,
          grade: 'A+',
          gpa: 5.0,
          is_fail: false,
          is_fourth_subject: false,
          components: [{ name: 'Written', full_marks: 100, obtained: 90 }],
        },
      ],
      legend: [{ grade: 'A+', gpa: 5.0, comment: null }],
      issuer: {
        name: 'Test School',
        name_bn: null,
        address: null,
        phone: null,
        email: null,
        registration_id: null,
        logo_key: null,
      },
      logo_url: null,
    };
  }

  const cardRequests: string[] = [];

  const printLogs: unknown[] = [];

  function mockResults(options: {
    students: unknown[];
    results: Record<string, unknown[]>;
    cards?: Record<string, unknown>;
    /** Body of the family final-result-card route; absent = nothing published (404). */
    final?: unknown;
  }) {
    cardRequests.length = 0;
    printLogs.length = 0;
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(options.students)),
      http.get('/api/v1/students/:studentId/results', ({ params }) => {
        const id = params.studentId as string;
        return HttpResponse.json(options.results[id] ?? []);
      }),
      http.get('/api/v1/students/:studentId/results/:examId', ({ params }) => {
        cardRequests.push(String(params.examId));
        const key = `${String(params.studentId)}:${String(params.examId)}`;
        const found = options.cards?.[key];
        if (!found) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
        return HttpResponse.json(found);
      }),
      http.get('/api/v1/students/:studentId/final-result-card', () =>
        options.final
          ? HttpResponse.json(options.final)
          : HttpResponse.json({ message: 'Not found' }, { status: 404 }),
      ),
      http.post('/api/v1/students/:studentId/document-prints', async ({ request }) => {
        printLogs.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
  }

  function renderResults(path = '/portal/results', locale = 'en') {
    return renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale,
    });
  }

  it('lists only what the server returns — an unpublished exam is server-filtered, never greyed', async () => {
    // `publishedOnly` is enforced server-side (D19) — this fixture only
    // has the published exam in the response, matching what the real API
    // does for a PARENT/STUDENT caller.
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
    });
    renderResults();

    expect(await screen.findByText('First Term Exam')).toBeTruthy();
    // No unpublished row anywhere on the page — absent, not disabled/greyed.
    expect(screen.queryByText('Monthly Test')).toBeNull();
  });

  it('shows the published final result first, above the per-exam list', async () => {
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
      final: {
        final_result_id: 'fr-1',
        academic_year_name: '2026',
        student: { full_name: 'Fatima Rahman', roll_number: 14 },
        final: { total_marks: 880, gpa: 4.8, grade: 'A', position: 2, is_fail: false },
        exams: [],
        exam_shares: [],
        subjects: [],
        legend: [],
        attendance: { working_days: null, present_days: null },
        remark: null,
        conduct: [],
        issuer: {},
        logo_url: null,
      },
    });
    renderResults();

    const finalTitle = await screen.findByRole('heading', { level: 2, name: /Final result 2026/ });
    const examTitle = await screen.findByRole('heading', { level: 2, name: 'First Term Exam' });
    expect(
      finalTitle.compareDocumentPosition(examTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows no final card when nothing is published', async () => {
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
    });
    renderResults();

    expect(await screen.findByText('First Term Exam')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: /Final result/ })).toBeNull();
  });

  it('renders the friendly empty state when there are no published results yet', async () => {
    mockResults({ students: [fatima], results: { 'student-1': [] } });
    renderResults();

    expect(await screen.findByRole('heading', { level: 2, name: 'No results yet' })).toBeTruthy();
    expect(screen.getByText('Results appear here once the school publishes them.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Results' })).toBeTruthy();
  });

  it('lets a multi-child guardian switch students, re-querying for the chosen child', async () => {
    mockResults({
      students: [fatima, imran],
      results: {
        'student-1': [resultRow('exam-1', 'First Term Exam', true)],
        'student-2': [resultRow('exam-2', 'Half Yearly Exam', true)],
      },
    });
    renderResults();

    const picker = await screen.findByRole('navigation', { name: 'Choose a student' });
    expect(await screen.findByText('First Term Exam')).toBeTruthy();

    await userEvent.click(within(picker).getByRole('link', { name: /Imran Rahman/ }));

    expect(await screen.findByText('Half Yearly Exam')).toBeTruthy();
    expect(screen.queryByText('First Term Exam')).toBeNull();
  });

  it('prints the report card for an exam', async () => {
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
      cards: { 'student-1:exam-1': card('First Term Exam') },
    });
    // Captured at the moment `window.print()` fires — the component
    // closes the print target right after, so asserting on the DOM after
    // `waitFor` resolves races against that unmount.
    let bodyTextAtPrintTime = '';
    let printTargetHiddenInPrint: boolean | undefined;
    const printSpy = vi.fn(() => {
      bodyTextAtPrintTime = document.body.textContent ?? '';
      // A `print:hidden` ancestor would hide the card on paper whatever
      // the card's own `print:block` says — it must not sit inside one.
      const target = document.querySelector('.print\\:block');
      printTargetHiddenInPrint = target ? target.closest('.print\\:hidden') !== null : undefined;
    });
    vi.stubGlobal('print', printSpy);
    renderResults();

    const printButton = await screen.findByRole('button', { name: 'Print First Term Exam' });
    await userEvent.click(printButton);

    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    // The audit entry was posted before the browser printed.
    expect(printLogs).toEqual([{ document: 'REPORT_CARD', exam_id: 'exam-1' }]);
    // `ReportCard` rendered with this exam/student's data.
    expect(bodyTextAtPrintTime).toContain('Mathematics');
    expect(printTargetHiddenInPrint).toBe(false);
  });

  it('shows a translated error and clears the print state when the report card cannot load', async () => {
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
      // No card entry: the request 404s.
    });
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);
    try {
      renderResults();

      const button = await screen.findByRole('button', { name: 'Print First Term Exam' });
      await userEvent.click(button);

      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          'Could not load this report card to print. Try again.',
        ),
      );
      expect(printSpy).not.toHaveBeenCalled();
      // The print state cleared: a second click tries again.
      await waitFor(() => expect(button.getAttribute('aria-busy')).not.toBe('true'));
      await userEvent.click(button);
      await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(2));
    } finally {
      toastSpy.mockRestore();
    }
  });

  it('shows the print error and does not print when the print log fails', async () => {
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
      cards: { 'student-1:exam-1': card('First Term Exam') },
    });
    server.use(
      http.post('/api/v1/students/:studentId/document-prints', () =>
        HttpResponse.json({ message: 'Boom' }, { status: 500 }),
      ),
    );
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);
    try {
      renderResults();
      await userEvent.click(await screen.findByRole('button', { name: 'Print First Term Exam' }));
      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          'Could not record this print, so it was not printed. Try again.',
        ),
      );
      expect(printSpy).not.toHaveBeenCalled();
    } finally {
      toastSpy.mockRestore();
    }
  });

  it('shows the Print button busy while the report card loads', async () => {
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
    });
    server.use(
      http.get('/api/v1/students/:studentId/results/:examId', () => new Promise(() => undefined)),
    );
    renderResults();

    const button = await screen.findByRole('button', { name: 'Print First Term Exam' });
    expect(button.getAttribute('aria-busy')).not.toBe('true');
    await userEvent.click(button);

    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
  });

  it('opens the newest card on load and the others only when asked', async () => {
    mockResults({
      students: [fatima],
      results: {
        'student-1': [
          resultRow('exam-2', 'Half Yearly Exam', true),
          resultRow('exam-1', 'First Term Exam', true),
        ],
      },
      cards: {
        'student-1:exam-2': card('Half Yearly Exam'),
        'student-1:exam-1': {
          ...card('First Term Exam'),
          subjects: [{ ...card('x').subjects[0], subject_id: 'subj-2', subject_name: 'Physics' }],
        },
      },
    });
    renderResults();

    // The newest (first) card's table is there without a click.
    expect(await screen.findByText('Mathematics')).toBeTruthy();
    expect(screen.queryByText('Physics')).toBeNull();
    expect(cardRequests).toEqual(['exam-2']);

    const buttons = screen.getAllByRole('button', { name: 'Show subject marks' });
    expect(buttons).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Hide subject marks' }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(buttons[0]!);

    expect(await screen.findByText('Physics')).toBeTruthy();
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows an inline message when an open card cannot load its breakdown', async () => {
    // No `cards` entry, so the breakdown request 404s.
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
    });
    renderResults();

    expect(await screen.findByText("Could not load this exam's breakdown.")).toBeTruthy();
    // The rest of the page is untouched — only this card's breakdown failed.
    expect(screen.getByRole('heading', { level: 1, name: 'Results' })).toBeTruthy();
  });

  it('badges every exam Pass or Fail', async () => {
    mockResults({
      students: [fatima],
      results: {
        'student-1': [
          resultRow('exam-1', 'First Term Exam', true),
          resultRow('exam-2', 'Half Yearly Exam', true, { is_fail: true, grade: 'F' }),
        ],
      },
    });
    renderResults();

    const failed = (
      await screen.findByRole('heading', { level: 2, name: 'Half Yearly Exam' })
    ).closest('article') as HTMLElement;
    const passed = screen
      .getByRole('heading', { level: 2, name: 'First Term Exam' })
      .closest('article') as HTMLElement;
    expect(within(failed).getByText('Fail')).toBeTruthy();
    expect(within(failed).queryByText('Pass')).toBeNull();
    expect(within(passed).getByText('Pass')).toBeTruthy();
    expect(within(passed).queryByText('Fail')).toBeNull();
  });

  it('shows GPA with two decimals, fractional total marks, the kind label, and a dash for no position', async () => {
    mockResults({
      students: [fatima],
      results: {
        'student-1': [
          resultRow('exam-1', 'First Term Exam', true, {
            gpa: 4.5,
            position: null,
            total_marks: 449.5,
          }),
        ],
      },
    });
    renderResults();

    const article = (
      await screen.findByRole('heading', { level: 2, name: 'First Term Exam' })
    ).closest('article') as HTMLElement;
    const fact = (label: string) =>
      within(article).getByText(label).nextElementSibling?.textContent;
    expect(fact('GPA')).toBe('4.50');
    expect(fact('Grade')).toBe('A+');
    // A half mark is kept, not rounded to 450.
    expect(fact('Total marks')).toBe('449.5');
    expect(fact('Position')).toBe('—');
    expect(within(article).getByText('Term')).toBeTruthy();
  });

  it('tags the fourth subject in the breakdown table', async () => {
    const withFourth = card('First Term Exam');
    withFourth.subjects = [{ ...withFourth.subjects[0]!, is_fourth_subject: true }];
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
      cards: { 'student-1:exam-1': withFourth },
    });
    renderResults();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('4th subject')).toBeTruthy();
  });

  it('renders numbers in Bangla digits when the locale is bn', async () => {
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
    });
    const { localeReady } = renderResults('/portal/results', 'bn');
    await localeReady;

    const article = (
      await screen.findByRole('heading', { level: 2, name: 'First Term Exam' })
    ).closest('article') as HTMLElement;
    expect(within(article).getByText('৪৫০')).toBeTruthy();
    expect(within(article).getByText('৫.০০')).toBeTruthy();
    expect(within(article).getByText('উত্তীর্ণ')).toBeTruthy();
  });

  it('shows only the roll number for a student with no class', async () => {
    mockResults({
      students: [{ ...fatima, class_section: null }],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
    });
    renderResults();

    expect(await screen.findByText('Fatima Rahman · Roll 14')).toBeTruthy();
  });

  it('shows the "no students linked" state when the guardian has no children', async () => {
    mockResults({ students: [], results: {} });
    renderResults();

    expect(await screen.findByText('No students linked to you yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('shows a retryable error when the student list fails to load', async () => {
    server.use(
      http.get('/api/v1/students/mine', () =>
        HttpResponse.json(apiErrorBody(403, 'Forbidden', '/api/v1/students/mine'), {
          status: 403,
        }),
      ),
    );
    renderResults();

    expect(await screen.findByText(/Could not load your results/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('shows a retryable error when the results list fails to load', async () => {
    let resultsRequests = 0;
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json([fatima])),
      http.get('/api/v1/students/:studentId/results', () => {
        resultsRequests += 1;
        return HttpResponse.json(
          apiErrorBody(404, 'Not found', '/api/v1/students/student-1/results'),
          { status: 404 },
        );
      }),
    );
    renderResults();

    expect(await screen.findByText(/Could not load your results/)).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();

    // "Try again" re-requests the list (a 404 is never auto-retried, so
    // the count before the click is exactly one).
    expect(resultsRequests).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(resultsRequests).toBe(2));
  });

  it('is axe clean', async () => {
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
      cards: { 'student-1:exam-1': card('First Term Exam') },
    });
    const { container } = renderResults();

    await screen.findByRole('table');
    await expect(container).toHaveNoViolations();
  });
});
