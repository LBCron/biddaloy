import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const SECTION = {
  section_id: 'section-1',
  section_name: 'A',
  class_id: 'class-7',
  class_name: 'Class 7',
  assignment_type: 'CLASS_TEACHER',
};

const paged = (data: unknown[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 10,
  totalPages: 1,
});

/** Every endpoint the six cards call; `overrides` replaces one of them. */
function mockAll(overrides: Parameters<typeof server.use> = []) {
  server.use(
    ...overrides,
    http.get('/api/v1/my-class/sections', () => HttpResponse.json([SECTION])),
    http.get('/api/v1/attendance/sections/section-1/register', () =>
      HttpResponse.json({
        students: [
          { student_id: 's1', roll_number: 1, full_name: 'Rafi Absent', status: 'ABSENT' },
          { student_id: 's2', roll_number: 2, full_name: 'Mina Present', status: 'PRESENT' },
        ],
      }),
    ),
    http.get('/api/v1/attendance/sections/section-1/streaks', () =>
      HttpResponse.json({
        as_of_date: '2026-10-01',
        items: [
          {
            student_id: 's3',
            student_name: 'Tania Late',
            roll_number: 3,
            status: 'LATE',
            length: 4,
            since_date: '2026-09-28',
          },
        ],
      }),
    ),
    http.get('/api/v1/fees/dues', () =>
      HttpResponse.json({
        ...paged([{ student_id: 's1', full_name: 'Rafi Absent', total_due: 500, dues: [] }]),
        total_due_sum: 500,
      }),
    ),
    http.get('/api/v1/homework/analytics/section/section-1', () =>
      HttpResponse.json({
        totalAssignments: 7,
        completed: 5,
        defaulters: 2,
        completionPercent: 71,
      }),
    ),
    http.get('/api/v1/exams', () =>
      HttpResponse.json(
        paged([
          {
            id: 'exam-1',
            name: 'Half Yearly',
            status: 'PUBLISHED',
            published_at: '2026-09-30T00:00:00Z',
            academic_year_id: 'year-1',
            academic_year: { is_current: true },
            created_at: '2026-09-01T00:00:00Z',
          },
          {
            id: 'exam-0',
            name: 'Draft Test',
            status: 'DRAFT',
            published_at: null,
            academic_year_id: 'year-1',
            academic_year: { is_current: true },
            created_at: '2026-08-01T00:00:00Z',
          },
        ]),
      ),
    ),
    http.get('/api/v1/final-results', () =>
      HttpResponse.json([
        {
          class: { id: 'class-7', name: 'Class 7' },
          final_result_id: 'final-1',
          status: 'DRAFT',
          published_at: null,
        },
      ]),
    ),
    http.get('/api/v1/my-class/sections/section-1/report-card-notes/missing', () =>
      HttpResponse.json({ total: 8, missing_remark: 2, missing_conduct: 3 }),
    ),
    http.get('/api/v1/performance/classes/class-7', () =>
      HttpResponse.json({
        exams: [
          {
            examId: 'exam-1',
            examName: 'Half Yearly',
            appeared: 30,
            passRate: 90,
            averageMarks: 72,
          },
        ],
      }),
    ),
    http.get('/api/v1/exams/exam-1/analysis/defaulted', () =>
      HttpResponse.json({
        status: 'OK',
        rows: [{ student_id: 's4', full_name: 'Karim Failed', roll_number: 4, is_fail: true }],
      }),
    ),
    http.get('/api/v1/students', () =>
      HttpResponse.json(
        paged([
          {
            id: 's1',
            full_name: 'Rafi Absent',
            roll_number: 1,
            guardians: [
              {
                id: 'g1',
                full_name: 'Rafi Parent',
                relationship: 'Father',
                phone: '01700000000',
                is_primary_contact: true,
              },
            ],
          },
        ]),
      ),
    ),
    http.get('/api/v1/attendance/arrival-subscriptions', () => HttpResponse.json([])),
  );
}

const sub = (over: Record<string, unknown>) => ({
  id: 'sub-1',
  student_id: 's1',
  guardian_id: 'g1',
  student_name: 'Nusrat Jahan',
  guardian_name: 'Karim Uddin',
  status: 'REQUESTED',
  mode: 'ONCE',
  channel: 'PUSH',
  lock: 'NONE',
  consumed_at: null,
  updated_at: '2026-10-29T00:00:00Z',
  ...over,
});

function render(entry = '/my-class/section-1') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

describe('/my-class/$sectionId', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  it('shows a (?) after the take-attendance button [44.3.05]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    mockAll();
    render();
    await screen.findByRole('link', { name: "Take today's attendance" });
    await screen.findAllByRole('button', { name: /^Help:/ });
    expect(
      document.querySelector('[data-help-id="academics.myClass.action.takeAttendance"]'),
    ).not.toBeNull();
  });

  it('renders all six cards and focuses the attendance button first', async () => {
    mockAll();
    render();
    const button = await screen.findByRole('link', { name: "Take today's attendance" });
    expect(button.getAttribute('href')).toContain('/attendance/section-1');
    await waitFor(() => expect(document.activeElement).toBe(button));

    expect(await screen.findByRole('heading', { level: 1, name: 'Class 7 – A' })).toBeTruthy();
    expect(screen.getByText(/^Class teacher · Today, /)).toBeTruthy();
    for (const title of [
      'Absent today',
      'Attendance flags',
      'Dues',
      'Homework',
      'Results',
      'Students',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(await screen.findByText('Late 3 or more days in a row')).toBeTruthy();
    expect(await screen.findByText(/^(4|৪) days$/)).toBeTruthy();
    expect(await screen.findByText('Half Yearly')).toBeTruthy();
    expect(await screen.findByText(/^(90|৯০)%$/)).toBeTruthy();
    expect(await screen.findByText('Karim Failed')).toBeTruthy();
    const tel = await screen.findByRole('link', { name: 'Call guardian of Rafi Absent' });
    expect(tel.getAttribute('href')).toBe('tel:01700000000');
    // formatPhone output; digits are Latin or Bangla depending on the (async) region config.
    expect(tel.textContent).toMatch(/^(01700-000000|০১৭০০-০০০০০০)$/);
  });

  it('shows how many remarks are missing and links to the notes screen', async () => {
    mockAll();
    render();
    const card = (await screen.findByRole('heading', { name: 'Remarks and conduct' })).closest(
      'section',
    )!;
    expect(await within(card).findByText('Final result — 6 given, 2 to do')).toBeTruthy();
    const link = within(card).getByRole('link', { name: /Write remarks/ });
    expect(link.getAttribute('href')).toBe('/my-class/section-1/notes?for=final');
  });

  it('with no final result the notes card speaks for the newest exam', async () => {
    mockAll([http.get('/api/v1/final-results', () => HttpResponse.json([]))]);
    render();
    const card = (await screen.findByRole('heading', { name: 'Remarks and conduct' })).closest(
      'section',
    )!;
    const link = await within(card).findByRole('link', { name: /Write remarks|View/ });
    expect(link.getAttribute('href')).toMatch(/\/notes\?for=exam-/);
    expect(within(card).queryByText(/Final result/)).toBeNull();
  });

  it('badges the absent count on the Absent today card', async () => {
    mockAll();
    render();
    const card = (await screen.findByRole('heading', { name: 'Absent today' })).closest('section')!;
    expect(await within(card).findByText(/^(1|১) absent$/)).toBeTruthy();
    expect(within(card).getByText('Rafi Absent')).toBeTruthy();
  });

  it('names the section, not its id, in the breadcrumb and tab title', async () => {
    mockAll();
    render();
    const nav = await screen.findByRole('navigation', { name: 'You are here' });
    await waitFor(() => expect(within(nav).getByText('Class 7 – A')).toBeTruthy());
    expect(within(nav).queryByText('section-1')).toBeNull();
    await waitFor(() => expect(document.title).toContain('Class 7 – A'));
  });

  it('keeps the other cards when one card fails, and retries just that card', async () => {
    let calls = 0;
    mockAll([
      http.get('/api/v1/attendance/sections/section-1/streaks', () => {
        calls += 1;
        return HttpResponse.json({}, { status: 403 });
      }),
    ]);
    render();
    const flags = (await screen.findByRole('heading', { name: 'Attendance flags' })).closest(
      'section',
    )!;
    const retry = await within(flags).findByRole('button', { name: 'Try again' });
    expect(await screen.findByText('Half Yearly')).toBeTruthy();
    expect((await screen.findAllByText('Rafi Absent')).length).toBeGreaterThan(0);
    const before = calls;
    fireEvent.click(retry);
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it('shows the page error with the retry, and retrying refetches the sections', async () => {
    let calls = 0;
    mockAll([
      http.get('/api/v1/my-class/sections', () => {
        calls += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    ]);
    render();
    // 5xx is retried twice with backoff (~3s) before the error state shows.
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 8000 });
    expect(screen.getByText('Could not load this section.')).toBeTruthy();
    const before = calls;
    fireEvent.click(retry);
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  }, 15_000);

  it('prints a dash, not NaN, for a student without a roll number', async () => {
    mockAll([
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json({
          students: [
            { student_id: 's1', roll_number: null, full_name: 'No Roll', status: 'ABSENT' },
          ],
        }),
      ),
    ]);
    render();
    const card = (await screen.findByRole('heading', { name: 'Absent today' })).closest('section')!;
    expect(await within(card).findByText('No Roll')).toBeTruthy();
    expect(within(card).getByText('Roll —')).toBeTruthy();
    expect(card.textContent).not.toContain('NaN');
  });

  it('shows the empty line when the class has no published exam', async () => {
    mockAll([http.get('/api/v1/exams', () => HttpResponse.json(paged([])))]);
    render();
    expect(await screen.findByText('No results yet.')).toBeTruthy();
  });

  // `/fees/dues` needs FEE_COLLECT, which TEACHER lacks (FEE_READ only):
  // the Dues card must not offer a link that lands on access-denied.
  it('hides the Dues "See all" link from a TEACHER', async () => {
    mockAll();
    render();
    const dues = (await screen.findByRole('heading', { name: 'Dues' })).closest('section')!;
    expect(await within(dues).findByText('Rafi Absent')).toBeTruthy();
    expect(within(dues).queryByRole('link', { name: 'See all' })).toBeNull();
  });

  it('shows the server-wide dues total, not the sum of the rows on the page', async () => {
    mockAll([
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({
          ...paged([
            { student_id: 's1', full_name: 'Rafi Absent', total_due: 500, dues: [] },
            { student_id: 's2', full_name: 'Mina Present', total_due: 700, dues: [] },
          ]),
          total_due_sum: 123456,
        }),
      ),
    ]);
    render();
    const dues = (await screen.findByRole('heading', { name: 'Dues' })).closest('section')!;
    expect(await within(dues).findByText(/1,23,456|123,456|১,২৩,৪৫৬/)).toBeTruthy();
  });

  it('says attendance is not taken yet when no student has a status', async () => {
    mockAll([
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json({
          students: [{ student_id: 's1', roll_number: 1, full_name: 'Rafi', status: null }],
        }),
      ),
    ]);
    render();
    expect(await screen.findByText('Attendance not taken yet.')).toBeTruthy();
    expect(screen.getByText('Not taken')).toBeTruthy();
    expect(screen.queryByText('No one is absent today.')).toBeNull();
  });

  describe('Arrival notices card [84.3.2]', () => {
    it('shows three buttons per waiting request and PATCHes Every school day', async () => {
      const patches: { url: string; body: unknown }[] = [];
      mockAll([
        http.get('/api/v1/attendance/arrival-subscriptions', () =>
          HttpResponse.json([
            sub({ id: 'sub-1' }),
            sub({ id: 'sub-2', student_name: 'Rima Akter', channel: 'SMS' }),
          ]),
        ),
        http.patch('/api/v1/attendance/arrival-subscriptions/:id', async ({ request, params }) => {
          patches.push({ url: String(params.id), body: await request.json() });
          return HttpResponse.json(sub({ id: String(params.id), status: 'ACTIVE' }));
        }),
      ]);
      render();
      const card = (await screen.findByRole('heading', { name: 'Arrival notices' })).closest(
        'section',
      )!;
      expect(await within(card).findByText('Nusrat Jahan')).toBeTruthy();
      expect(within(card).getAllByRole('button', { name: 'Once' })).toHaveLength(2);
      expect(within(card).getAllByRole('button', { name: 'Every school day' })).toHaveLength(2);
      expect(within(card).getAllByRole('button', { name: 'Not now' })).toHaveLength(2);
      fireEvent.click(within(card).getAllByRole('button', { name: 'Every school day' })[0]!);
      await waitFor(() => expect(patches).toHaveLength(1));
      expect(patches[0]).toEqual({ url: 'sub-1', body: { status: 'ACTIVE', mode: 'RECURRING' } });
    });

    it('hides the row menu when the school fixed the choice, and shows it otherwise', async () => {
      mockAll([
        http.get('/api/v1/attendance/arrival-subscriptions', () =>
          HttpResponse.json([
            sub({ id: 'a', status: 'ACTIVE', lock: 'ALWAYS', student_name: 'Fixed Child' }),
            sub({ id: 'b', status: 'ACTIVE', lock: 'NONE', student_name: 'Free Child' }),
          ]),
        ),
      ]);
      render();
      const card = (await screen.findByRole('heading', { name: 'Arrival notices' })).closest(
        'section',
      )!;
      await within(card).findByText('Fixed Child');
      expect(within(card).getByText('Set by school')).toBeTruthy();
      // One menu (Change + Stop actions) for the unlocked row only.
      expect(within(card).getAllByRole('button', { name: 'Stop' })).toHaveLength(1);
    });

    it('shows the empty sentence, the Add yourself button, and no banned words', async () => {
      mockAll();
      render();
      const card = (await screen.findByRole('heading', { name: 'Arrival notices' })).closest(
        'section',
      )!;
      expect(
        await within(card).findByText('No guardian has asked for arrival notices yet.'),
      ).toBeTruthy();
      expect(within(card).getByRole('button', { name: 'Add yourself' })).toBeTruthy();
      expect(card.textContent).not.toMatch(
        /subscription|notification|push|channel|\bmode\b|\block\b|device|sync|decline|recurring/i,
      );
    });

    it('keeps focus in the card after answering, while the request count changes', async () => {
      let answered = false;
      let sectionsCalls = 0;
      mockAll([
        // The badge count drops after an answer, so the sections refetch returns a new object.
        http.get('/api/v1/my-class/sections', () => {
          sectionsCalls += 1;
          return HttpResponse.json([{ ...SECTION, arrival_request_count: answered ? 0 : 1 }]);
        }),
        http.get('/api/v1/attendance/arrival-subscriptions', () =>
          HttpResponse.json([sub(answered ? { status: 'ACTIVE', mode: 'RECURRING' } : {})]),
        ),
        http.patch('/api/v1/attendance/arrival-subscriptions/:id', () => {
          answered = true;
          return HttpResponse.json(sub({ status: 'ACTIVE', mode: 'RECURRING' }));
        }),
      ]);
      render();
      const heading = await screen.findByRole('heading', { name: 'Arrival notices' });
      const card = heading.closest('section')!;
      const everyDay = await within(card).findByRole('button', { name: 'Every school day' });
      // First focus went to Take attendance; the teacher then works in the card.
      const take = await screen.findByRole('link', { name: "Take today's attendance" });
      await waitFor(() => expect(document.activeElement).toBe(take));
      const before = sectionsCalls;
      everyDay.focus();
      fireEvent.click(everyDay);
      await waitFor(() => expect(sectionsCalls).toBeGreaterThan(before));
      await within(card).findByText('Every school day');
      // Not thrown back to Take attendance (or the body) by the refetch.
      await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
    });

    it('focuses the card heading for ?then=arrival', async () => {
      mockAll();
      render('/my-class/section-1?then=arrival');
      const heading = await screen.findByRole('heading', { name: 'Arrival notices' });
      await waitFor(() => expect(document.activeElement).toBe(heading));
    });

    it('adds a guardian as ACTIVE from the dialog', async () => {
      let posted: unknown;
      mockAll([
        http.post('/api/v1/attendance/arrival-subscriptions', async ({ request }) => {
          posted = await request.json();
          return HttpResponse.json(sub({ status: 'ACTIVE' }));
        }),
      ]);
      render();
      fireEvent.click(await screen.findByRole('button', { name: 'Add yourself' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByLabelText('Student'));
      fireEvent.click(await screen.findByRole('option', { name: 'Rafi Absent' }));
      fireEvent.click(within(dialog).getByLabelText('Guardian'));
      fireEvent.click(await screen.findByRole('option', { name: 'Rafi Parent (Father)' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
      await waitFor(() =>
        expect(posted).toEqual({ student_id: 's1', guardian_id: 'g1', mode: 'ONCE' }),
      );
    });
  });

  it('shows the not-found page for a section the teacher does not own', async () => {
    mockAll();
    render('/my-class/someone-elses-section');
    expect(await screen.findByText(/not found|doesn.t exist|404/i)).toBeTruthy();
  });
});
