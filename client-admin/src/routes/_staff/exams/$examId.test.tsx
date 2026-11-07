import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

// No built-in role holds some of these permissions without the others, so the permission
// variants are driven through `useHasPermission` (null = real behaviour).
const grant = vi.hoisted(() => ({ only: null as Set<string> | null }));
vi.mock('@biddaloy/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/hooks')>();
  return {
    ...actual,
    useHasPermission: (permission: Parameters<typeof actual.useHasPermission>[0]) =>
      grant.only ? grant.only.has(permission) : actual.useHasPermission(permission),
  };
});

import { routeTree } from '../../../routeTree.gen';

/** [19.6.1] / [31.4.exams-2a] Exam detail — Progress is the DEFAULT tab, the header
 * holds the one next-step action for the exam's status. */
describe('/exams/$examId', () => {
  afterEach(async () => {
    grant.only = null;
    await cleanupTestState();
  });

  const year = academicYearFactory({ id: 'year-1', name: '2026-2027' });
  const klass = classFactory({ id: 'class-7', name: 'Class 7' });

  function renderExam(
    status: 'DRAFT' | 'PROCESSED' | 'PUBLISHED',
    initialEntry = '/exams/exam-1',
    role = 'ADMIN',
  ) {
    const exam = examFactory({
      id: 'exam-1',
      name: 'Half Yearly 2026',
      status,
      academic_year: year,
      academic_year_id: year.id,
      class: klass,
      class_id: klass.id,
    });
    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)),
      http.get('/api/v1/exams/:examId/results', () => HttpResponse.json([])),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 2, SUBMITTED: 8 }, outstanding: [] }),
      ),
    );
    return renderWithRouter(routeTree, {
      initialEntries: [initialEntry],
      tenantId: 'tenant-1',
      role,
      locale: 'en',
    });
  }

  /** Buttons in the page header that are filled (the primary variant). */
  function filledButtons() {
    return screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('data-variant') === 'default');
  }

  it('lands on the Progress tab by default, with no back link and the facts in the header', async () => {
    renderExam('DRAFT');

    await screen.findByRole('heading', { name: 'Half Yearly 2026' });
    expect(screen.queryByText('Back to exams')).toBeNull();
    const progressTab = screen.getByRole('tab', { name: 'Progress' });
    expect(progressTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Marks breakdown' })).toBeTruthy();
    await screen.findByText('৮ of ১০ marks lists submitted');
    expect(await screen.findByText('Class 7')).toBeTruthy();
    expect(await screen.findByText('2026-2027')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('DRAFT: exactly one filled button, Process results', async () => {
    renderExam('DRAFT');
    await screen.findByRole('heading', { name: 'Half Yearly 2026' });
    await screen.findByRole('button', { name: 'Process result' });
    const filled = filledButtons();
    expect(filled).toHaveLength(1);
    expect(filled[0]?.textContent).toBe('Process result');
  });

  it('PROCESSED: Publish is primary and Process again is an outline action', async () => {
    renderExam('PROCESSED');
    await screen.findByRole('button', { name: 'Publish' });
    const filled = filledButtons();
    expect(filled).toHaveLength(1);
    expect(filled[0]?.textContent).toBe('Publish');
    const again = screen.getByRole('button', { name: 'Process again' });
    expect(again.getAttribute('data-variant')).toBe('outline');
  });

  it('PUBLISHED: SMS is primary and Reopen is only inside the More menu', async () => {
    const user = userEvent.setup();
    renderExam('PUBLISHED');
    await screen.findByRole('button', { name: 'Send result SMS' });
    expect(filledButtons()[0]?.textContent).toBe('Send result SMS');
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
    // Nothing on the page is a red filled button.
    expect(
      screen
        .queryAllByRole('button')
        .filter((b) => b.getAttribute('data-variant') === 'destructive'),
    ).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Reopen' })).toBeTruthy();
  });

  it('the Results tab carries no action buttons of its own', async () => {
    renderExam('PROCESSED', '/exams/exam-1?tab=results');
    await screen.findByText('No results yet');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Process again' })).toBeNull();
  });

  it('without RESULT_PUBLISH, a PROCESSED exam offers Process again as the only primary', async () => {
    grant.only = new Set(['EXAM_MANAGE', 'RESULT_PROCESS', 'EXAM_READ']);
    renderExam('PROCESSED');
    await screen.findByRole('heading', { name: 'Half Yearly 2026' });
    await screen.findByRole('button', { name: 'Process again' });
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    const buttons = filledButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('Process again');
  });

  it('without RESULT_PROCESS, a DRAFT exam has no primary action', async () => {
    grant.only = new Set(['EXAM_MANAGE']);
    renderExam('DRAFT');
    await screen.findByRole('heading', { name: 'Half Yearly 2026' });
    expect(screen.queryByRole('button', { name: 'Process result' })).toBeNull();
    expect(filledButtons()).toHaveLength(0);
  });

  it('without EXAM_MANAGE, Reopen is a More menu item, never an inline red button', async () => {
    const user = userEvent.setup();
    grant.only = new Set(['RESULT_PUBLISH']);
    renderExam('PUBLISHED');
    await screen.findByRole('heading', { name: 'Half Yearly 2026' });
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
    expect(
      screen
        .queryAllByRole('button')
        .filter((b) => b.getAttribute('data-variant') === 'destructive'),
    ).toHaveLength(0);
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Reopen' })).toBeTruthy();
  });

  it('shows the Print tab to a DOCUMENT_PRINT holder and ?tab=print opens it', async () => {
    renderExam('PUBLISHED', '/exams/exam-1?tab=print');
    const tab = await screen.findByRole('tab', { name: 'Print' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });

  /** Open the delete confirm from the header (inline button or More menu). */
  async function openDelete(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('heading', { name: 'Half Yearly 2026' });
    const inline = screen.queryByRole('button', { name: 'Delete exam' });
    if (inline) {
      await user.click(inline);
    } else {
      await user.click(await screen.findByRole('button', { name: 'More actions' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Delete exam' }));
    }
    return screen.findByRole('alertdialog');
  }

  it('DRAFT: Delete exam confirms, calls DELETE and goes back to the list', async () => {
    const user = userEvent.setup();
    let deleted = false;
    renderExam('DRAFT');
    server.use(
      http.delete('/api/v1/exams/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get('/api/v1/exams', () => HttpResponse.json({ data: [], total: 0 })),
    );
    const dialog = await openDelete(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() => expect(deleted).toBe(true));
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('PUBLISHED: there is no Delete exam action', async () => {
    const user = userEvent.setup();
    renderExam('PUBLISHED');
    await screen.findByRole('heading', { name: 'Half Yearly 2026' });
    expect(screen.queryByRole('button', { name: 'Delete exam' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await screen.findByRole('menuitem', { name: 'Reopen' });
    expect(screen.queryByRole('menuitem', { name: 'Delete exam' })).toBeNull();
  });

  it('a 409 EXAM_HAS_RESULTS shows the has-results sentence, not the server text', async () => {
    const user = userEvent.setup();
    renderExam('DRAFT');
    server.use(
      http.delete('/api/v1/exams/:id', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'raw server text',
            requestId: 'req-1',
            details: { code: 'EXAM_HAS_RESULTS' },
          },
          { status: 409 },
        ),
      ),
    );
    const dialog = await openDelete(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByText(/This exam has results\./)).toBeTruthy();
    expect(within(dialog).queryByText(/raw server text/)).toBeNull();
  });

  it('hides the Print tab without DOCUMENT_PRINT', async () => {
    grant.only = new Set(['EXAM_MANAGE', 'EXAM_READ']);
    renderExam('PUBLISHED');
    await screen.findByRole('heading', { name: 'Half Yearly 2026' });
    expect(screen.queryByRole('tab', { name: 'Print' })).toBeNull();
  });

  describe('[40.5.03] results on the website', () => {
    it.each(['DRAFT', 'PROCESSED'] as const)('%s: no website action', async (status) => {
      renderExam(status);
      await screen.findByRole('heading', { name: 'Half Yearly 2026' });
      expect(screen.queryByRole('button', { name: /on the website|off the website/ })).toBeNull();
    });

    it('PUBLISHED: a secondary Show results on the website action, never primary', async () => {
      renderExam('PUBLISHED');
      const button = await screen.findByRole('button', { name: 'Show results on the website' });
      expect(button.getAttribute('data-variant')).not.toBe('default');
      expect(filledButtons()).toHaveLength(1);
    });

    it('without RESULT_PUBLISH the action is not offered', async () => {
      grant.only = new Set(['EXAM_MANAGE', 'EXAM_READ']);
      renderExam('PUBLISHED');
      await screen.findByRole('heading', { name: 'Half Yearly 2026' });
      expect(screen.queryByRole('button', { name: 'Show results on the website' })).toBeNull();
    });
  });
});
