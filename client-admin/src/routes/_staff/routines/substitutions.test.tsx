import { toast } from '@biddaloy/ui/components';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatDate, tenantTodayIso } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanupTestState();
});

// `substitute_teacher_id`/`covered_for_teacher_id`/`class_id`/`section_id`
// are all `z.string().uuid()` in the route's search schema (`.catch(undefined)`
// silently drops anything that fails validation) — real UUID-shaped ids
// here, not `"teacher-1"`, or a filter select never reaches the query.
const TEACHER_1_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_2_ID = '22222222-2222-4222-8222-222222222222';
const CLASS_ID = '55555555-5555-4555-8555-555555555555';
const SECTION_ID = '66666666-6666-4666-8666-666666666666';

function mockBaseData() {
  server.use(
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({
        data: [
          { id: TEACHER_1_ID, user: { id: 'user-1', full_name: 'Ms Nahar' } },
          { id: TEACHER_2_ID, user: { id: 'user-2', full_name: 'Mr Karim' } },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [{ id: CLASS_ID, name: 'Class 6' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get(`/api/v1/classes/${CLASS_ID}/sections`, () =>
      HttpResponse.json([{ id: SECTION_ID, section_name: 'B' }]),
    ),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [{ id: 'year-1', name: '2026', is_current: true }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/routines', () =>
      HttpResponse.json([
        {
          id: 'routine-1',
          academic_year_id: 'year-1',
          state: 'PUBLISHED',
          created_at: '2026-01-01',
        },
      ]),
    ),
    http.get('/api/v1/routines/routine-1/slots', () =>
      HttpResponse.json([
        {
          slot: {
            id: 'slot-1',
            section_id: SECTION_ID,
            weekday: 4,
            period_slot_id: 'p2',
            subject_id: 'subject-math',
            recurrence: 'WEEKLY',
            recurrence_offset: 0,
            valid_from: '2026-01-01',
            valid_to: null,
          },
          teacher_ids: [TEACHER_2_ID],
          warnings: [],
        },
      ]),
    ),
    http.get('/api/v1/routines/shifts', () =>
      HttpResponse.json({
        data: [{ id: 'shift-1' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/routines/shifts/shift-1/period-slots', () =>
      HttpResponse.json([
        {
          id: 'p2',
          sequence: 2,
          kind: 'CLASS',
          name: null,
          starts_at: '08:45:00',
          ends_at: '09:25:00',
        },
      ]),
    ),
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({
        data: [{ id: 'subject-math', name_en: 'Math', name_bn: null, code: 'MATH' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

const COVERED = {
  id: 'sub-1',
  routine_slot_id: 'slot-1',
  date: '2026-10-08',
  substitute_teacher_id: TEACHER_1_ID,
  is_cancelled: false,
  reason: 'Covering for a workshop',
  created_by: 'user-2',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  // [2897] The server joins the slot's context; the page renders from this alone.
  slot: {
    section_id: SECTION_ID,
    class_name: 'Class 6',
    section_name: 'B',
    period_sequence: 2,
    starts_at: '08:45:00',
    subject_name_en: 'Math',
    subject_name_bn: null,
    teacher_ids: [TEACHER_2_ID],
  },
};

/** A row from an earlier year: its slot is in no current routine, yet it has a slot summary. */
const OLD_YEAR = {
  ...COVERED,
  id: 'sub-old',
  date: '2025-03-04',
  routine_slot_id: 'slot-old-year',
  slot: {
    ...COVERED.slot,
    class_name: 'Class 5',
    section_name: 'A',
    period_sequence: 4,
    subject_name_en: 'Science',
    teacher_ids: [TEACHER_1_ID],
  },
};

/** A record dated tomorrow in the school's own clock: still changeable, so Delete is offered (#3175). */
function tomorrowIso(): string {
  const [y, m, d] = tenantTodayIso(REGION_BD_BN).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}
const UPCOMING = { ...COVERED, id: 'sub-upcoming', date: tomorrowIso() };
/** Yesterday in the school's clock may still be today in another zone, so it keeps Delete. */
function yesterdayIso(): string {
  const [y, m, d] = tenantTodayIso(REGION_BD_BN).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
}
const YESTERDAY = { ...COVERED, id: 'sub-yesterday', date: yesterdayIso() };

function render(entry = '/routines/substitutions') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/routines/substitutions', () => {
  it('shows a (?) after the Add header action [44.3.04]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    mockBaseData();
    server.use(http.get('/api/v1/routines/substitutions', () => HttpResponse.json([])));
    render();
    await screen.findAllByRole('button', { name: /^Help:/ });
    expect(
      document.querySelector('[data-help-id="academics.routineSubstitutions.action.add"]'),
    ).not.toBeNull();
  });

  it('renders each record from the server slot summary, shows a status badge, and has no native select or date input', async () => {
    mockBaseData();
    server.use(
      http.get('/api/v1/routines/substitutions', () =>
        HttpResponse.json([
          COVERED,
          {
            ...COVERED,
            id: 'sub-2',
            date: '2026-10-07',
            is_cancelled: true,
            substitute_teacher_id: null,
            reason: null,
          },
          OLD_YEAR,
        ]),
      ),
    );
    const { container } = render();

    expect(await screen.findByText(formatDate('2026-10-08', REGION_BD_BN))).toBeTruthy();
    expect((await screen.findAllByText('Class 6 – B')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Mr Karim')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Covering for a workshop').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Covered').length).toBe(2);
    expect(screen.getByText('Period cancelled')).toBeTruthy();
    // The earlier-year row shows its own section, subject and absent teacher, not dashes.
    expect((await screen.findAllByText('Class 5 – A')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Science').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ms Nahar').length).toBeGreaterThan(0);
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it('picking a class writes class_id to the URL but never sends it to the API', async () => {
    mockBaseData();
    const queries: URLSearchParams[] = [];
    server.use(
      http.get('/api/v1/routines/substitutions', ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json([COVERED]);
      }),
    );
    const { router } = render(`/routines/substitutions?section_id=${SECTION_ID}`);
    const user = userEvent.setup();

    await screen.findByText('Covering for a workshop');
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 6' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ class_id: CLASS_ID }));
    expect(router.state.location.search).not.toHaveProperty('section_id');
    expect(queries.every((query) => !query.has('class_id'))).toBe(true);
  });

  it('shows "Clear filters" on an empty filtered list', async () => {
    mockBaseData();
    server.use(http.get('/api/v1/routines/substitutions', () => HttpResponse.json([])));
    render(`/routines/substitutions?substitute_teacher_id=${TEACHER_1_ID}`);

    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('shows the translated error with Retry when the list fails to load', async () => {
    mockBaseData();
    server.use(
      http.get('/api/v1/routines/substitutions', () =>
        HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 }),
      ),
    );
    render();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText(/Couldn't load substitute teachers/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('opens the add-substitution dialog', async () => {
    mockBaseData();
    server.use(http.get('/api/v1/routines/substitutions', () => HttpResponse.json([])));
    render();

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'No substitute teachers' });
    await user.click(screen.getAllByRole('button', { name: /add substitute teacher/i })[0]!);

    expect(screen.getByRole('dialog', { name: /record a substitute teacher/i })).toBeTruthy();
  });

  it('offers Delete on a record dated today or later, not on a past one (#3175)', async () => {
    mockBaseData();
    server.use(
      http.get('/api/v1/routines/substitutions', () => HttpResponse.json([COVERED, UPCOMING])),
    );
    render();
    // Both rows render; only the upcoming one can be deleted (the server answers 409 for past).
    await screen.findByText(formatDate(UPCOMING.date, REGION_BD_BN));
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
  });

  it('keeps Delete on yesterday: the page may not know the school zone, so the server decides', async () => {
    mockBaseData();
    server.use(
      http.get('/api/v1/routines/substitutions', () => HttpResponse.json([COVERED, YESTERDAY])),
    );
    render();
    await screen.findByText(formatDate(YESTERDAY.date, REGION_BD_BN));
    // COVERED is weeks old (surely past); YESTERDAY keeps its Delete.
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
  });

  it('Delete asks first, then sends DELETE /routines/substitutions/<id>', async () => {
    mockBaseData();
    let deletedId: string | null = null;
    server.use(
      http.get('/api/v1/routines/substitutions', () => HttpResponse.json([UPCOMING])),
      http.delete('/api/v1/routines/substitutions/:id', ({ params }) => {
        deletedId = String(params['id']);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(deletedId).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deletedId).toBe('sub-upcoming'));
  });

  it('a 409 SUBSTITUTION_IN_PAST shows the past-record sentence', async () => {
    mockBaseData();
    server.use(
      http.get('/api/v1/routines/substitutions', () => HttpResponse.json([UPCOMING])),
      http.delete('/api/v1/routines/substitutions/:id', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'x',
            requestId: 'req-9',
            details: { code: 'SUBSTITUTION_IN_PAST' },
          },
          { status: 409 },
        ),
      ),
    );
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    try {
      render();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          'A past substitution is part of the record and cannot be deleted.',
        ),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a failing DELETE shows "Could not delete"', async () => {
    mockBaseData();
    server.use(
      http.get('/api/v1/routines/substitutions', () => HttpResponse.json([UPCOMING])),
      http.delete('/api/v1/routines/substitutions/:id', () =>
        HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 }),
      ),
    );
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    try {
      render();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Could not delete — try again.'));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
