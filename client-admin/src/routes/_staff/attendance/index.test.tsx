import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { tenantTodayIso } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

// The school's date (Asia/Dhaka in REGION_BD_EN, the `en` fallback the page
// uses), never the runner's clock: between 18:00 and 24:00 UTC the two differ.
const todayLocalIso = () => tenantTodayIso(REGION_BD_EN);

const FINALIZED = {
  state: 'FINALIZED',
  present: 30,
  absent: 3,
  late: 2,
  leave: 0,
  unmarked: 0,
  marked_at: '2026-09-04T00:00:00.000Z',
};

function section(id: string, name: string, today: unknown, count = 40) {
  return {
    section_id: id,
    section_name: name,
    class_name: 'Class 5',
    student_count: count,
    class_teacher_name: null,
    is_working_day: true,
    today,
  };
}

function renderList(search = '') {
  return renderWithRouter(routeTree, {
    initialEntries: [`/attendance${search}`],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

describe('/attendance', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists unfinished sections first (none, draft, finalized), each a link card with a status badge', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          section('s-final', 'C', FINALIZED, 35),
          section('s-none', 'A', null),
          section('s-draft', 'B', { ...FINALIZED, state: 'DRAFT' }),
        ]),
      ),
    );

    renderList();

    const links = await screen.findAllByRole('link', { name: /Class 5/ });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      `/attendance/s-none?date=${todayLocalIso()}`,
      `/attendance/s-draft?date=${todayLocalIso()}`,
      `/attendance/s-final?date=${todayLocalIso()}`,
    ]);
    expect(within(links[0]!).getByText('Class 5 – A')).toBeTruthy();
    expect(within(links[0]!).getByText('Not started')).toBeTruthy();
    expect(within(links[0]!).getByText('40 students')).toBeTruthy();
    expect(within(links[1]!).getByText('Draft')).toBeTruthy();
    expect(within(links[2]!).getByText('Submitted')).toBeTruthy();
  });

  const mixed = [
    section('s-none', 'A', null),
    section('s-draft', 'B', { ...FINALIZED, state: 'DRAFT' }),
    section('s-final', 'C', FINALIZED),
    section('s-empty', 'D', null, 0),
  ];

  it('shows scanned-but-absent and without-status chips, hidden at 0, with a tooltip', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          section('s-a', 'A', { ...FINALIZED, state: 'DRAFT', unmarked: 4, scanned_but_absent: 3 }),
          section('s-b', 'B', { ...FINALIZED, state: 'DRAFT', unmarked: 0, scanned_but_absent: 0 }),
        ]),
      ),
    );

    renderList();

    const links = await screen.findAllByRole('link', { name: /Class 5/ });
    const chip = within(links[0]!).getByText('3 scanned but marked absent');
    expect(chip.getAttribute('title')).toMatch(/card machine saw/);
    expect(within(links[0]!).getByText('4 without a status')).toBeTruthy();
    expect(within(links[1]!).queryByText(/scanned but marked absent|without a status/)).toBeNull();
  });

  it('says how many sections are pending, leaving out zero-student sections', async () => {
    server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json(mixed)));

    renderList();

    expect(await screen.findByText('2 of 3 sections pending')).toBeTruthy();
    expect(screen.queryByText('Class 5 – D')).toBeNull();
  });

  it('?status=pending shows only not-started and draft sections', async () => {
    server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json(mixed)));

    renderList('?status=pending');

    expect(await screen.findByText('Class 5 – A')).toBeTruthy();
    expect(screen.getByText('Class 5 – B')).toBeTruthy();
    expect(screen.queryByText('Class 5 – C')).toBeNull();
  });

  it('?status=done shows only finalized sections', async () => {
    server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json(mixed)));

    renderList('?status=done');

    expect(await screen.findByText('Class 5 – C')).toBeTruthy();
    expect(screen.queryByText('Class 5 – A')).toBeNull();
  });

  it('shows the class teacher, or "Not assigned"', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          { ...section('s-a', 'A', null), class_teacher_name: 'Rahim Uddin' },
          section('s-b', 'B', null),
        ]),
      ),
    );

    renderList();

    expect(await screen.findByText('Class teacher: Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Class teacher: Not assigned')).toBeTruthy();
  });

  it('shows the holiday state when no section has a working day', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([{ ...section('s-a', 'A', null), is_working_day: false }]),
      ),
    );

    renderList();

    expect(await screen.findByText('School is closed on this day')).toBeTruthy();
    expect(screen.queryByText('Class 5 – A')).toBeNull();
    // No "N of M pending" over a holiday notice.
    expect(screen.queryByText(/sections? pending/)).toBeNull();
  });

  it('a class with no school today is neither listed nor counted as pending', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          section('s-a', 'A', null),
          { ...section('s-b', 'B', null), is_working_day: false },
        ]),
      ),
    );

    renderList();

    expect(await screen.findByText('1 of 1 section pending')).toBeTruthy();
    expect(screen.getByText('Class 5 – A')).toBeTruthy();
    expect(screen.queryByText('Class 5 – B')).toBeNull();
  });

  it('shows the all-done state when pending is chosen and nothing is pending', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([section('s-final', 'C', FINALIZED)]),
      ),
    );

    renderList('?status=pending');

    expect(await screen.findByText('All sections are marked')).toBeTruthy();
  });

  it('?status=done with nothing submitted shows an empty state, not a blank list', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([section('s-none', 'A', null)]),
      ),
    );

    renderList('?status=done');

    expect(await screen.findByText('No section is submitted yet')).toBeTruthy();
    expect(screen.queryByText('Class 5 – A')).toBeNull();
  });

  it('the all-done state for a past ?date= does not say "Today"', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([section('s-final', 'C', FINALIZED)]),
      ),
    );

    renderList('?status=pending&date=2026-09-04');

    expect(await screen.findByText('All sections are marked')).toBeTruthy();
    expect(screen.queryByText(/Today/)).toBeNull();
  });

  it('passes a chosen date to the API and to each row link', async () => {
    let requested: string | null = null;
    server.use(
      http.get('/api/v1/attendance/my-sections', ({ request }) => {
        requested = new URL(request.url).searchParams.get('date');
        return HttpResponse.json([section('s-none', 'A', null)]);
      }),
    );

    renderList('?date=2026-09-04');

    const link = await screen.findByRole('link', { name: /Class 5/ });
    expect(link.getAttribute('href')).toBe('/attendance/s-none?date=2026-09-04');
    expect(requested).toBe('2026-09-04');
  });

  it('a Bengali-numeral date in the URL is ignored, not sent (ASCII only, #626)', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([section('s-none', 'A', null)]),
      ),
    );

    renderList('?date=২০২৬-০৯-০৪');

    const link = await screen.findByRole('link', { name: /Class 5/ });
    expect(link.getAttribute('href')).toBe(`/attendance/s-none?date=${todayLocalIso()}`);
  });

  it('in Bangla, a date picked in the DatePicker reaches the URL as ASCII digits (#626)', async () => {
    const requested: Array<string | null> = [];
    server.use(
      http.get('/api/v1/attendance/my-sections', ({ request }) => {
        requested.push(new URL(request.url).searchParams.get('date'));
        return HttpResponse.json([section('s-none', 'A', null)]);
      }),
    );

    const { router, localeReady } = renderWithRouter(routeTree, {
      initialEntries: ['/attendance?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'bn',
    });
    await localeReady;

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^তারিখ, / }));
    await user.click(document.querySelector('[data-date="2026-09-10"]') as HTMLElement);

    await waitFor(() =>
      expect((router.state.location.search as { date?: string }).date).toBe('2026-09-10'),
    );
    await waitFor(() => expect(requested).toContain('2026-09-10'));
    const link = await screen.findByRole('link', { name: /Class 5/ });
    expect(link.getAttribute('href')).toBe('/attendance/s-none?date=2026-09-10');
  });

  it('shows an empty state when the teacher has no mapped sections', async () => {
    server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json([])));

    renderList();

    expect(await screen.findByText('No sections assigned yet')).toBeTruthy();
  });
});
