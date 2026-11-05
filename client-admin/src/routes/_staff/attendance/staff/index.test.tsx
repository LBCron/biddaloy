import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

function day(
  rows: {
    user_id: string;
    full_name: string;
    role: string;
    staff_profile_id: string;
    status?: string | null;
  }[],
) {
  return http.get('/api/v1/staff-attendance/register', ({ request }) =>
    HttpResponse.json({
      date: new URL(request.url).searchParams.get('date'),
      reason_required: false,
      non_working_day: false,
      staff: rows.map((r) => ({ status: null, ...r })),
    }),
  );
}

describe('/attendance/staff', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders a row per staff member with a staff profile, no console error', async () => {
    server.use(
      day([
        { user_id: 'user-1', full_name: 'Karim', role: 'TEACHER', staff_profile_id: 'profile-1' },
      ]),
      // The page must not touch the admin-only users list (403 for non-admins).
      http.get('/api/v1/users', () => HttpResponse.json({}, { status: 403 })),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('button', { name: 'Karim' })).toBeTruthy();
  });

  it('shows an empty state when there is no staff with a profile yet', async () => {
    server.use(day([]));

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('No staff yet')).toBeTruthy();
  });

  it('shows the saved marks on load and keeps them after a save', async () => {
    // Stateful stub: the PUT flips Rahima to ABSENT, and the refetch must show it.
    const marks: Record<string, string | null> = { 'profile-1': 'PRESENT', 'profile-2': null };
    server.use(
      http.get('/api/v1/staff-attendance/register', () =>
        HttpResponse.json({
          date: '2026-10-04',
          reason_required: false,
          non_working_day: false,
          staff: [
            { user_id: 'u1', full_name: 'Karim', role: 'TEACHER', staff_profile_id: 'profile-1' },
            { user_id: 'u2', full_name: 'Rahima', role: 'TEACHER', staff_profile_id: 'profile-2' },
          ].map((r) => ({ ...r, status: marks[r.staff_profile_id] })),
        }),
      ),
      http.put('/api/v1/staff-attendance/register', () => {
        marks['profile-2'] = 'ABSENT';
        return HttpResponse.json({ saved: 1 });
      }),
    );
    const user = userEvent.setup();
    const { localeReady } = renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff?date=2026-10-04'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await localeReady;

    // Karim was saved as Present: counted as marked, so only Rahima is unmarked.
    expect(await screen.findByText('Present 1')).toBeTruthy();
    expect(screen.getByText('1 unmarked')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Rahima' })); // draft: PRESENT
    await user.click(screen.getByRole('button', { name: 'Rahima' })); // draft: ABSENT
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));

    expect(await screen.findByText('Attendance saved')).toBeTruthy();
    // After the refetch the grid still shows both marks (nothing blanked).
    expect(await screen.findByText('Absent 1')).toBeTruthy();
    expect(screen.getByText('Present 1')).toBeTruthy();
    expect(screen.getByText('Unmarked 0')).toBeTruthy();
  });

  describe('reason for an old day', () => {
    function oldDay(reasonRequired: boolean, onPut?: (body: unknown) => void) {
      return [
        http.get('/api/v1/staff-attendance/register', () =>
          HttpResponse.json({
            date: '2026-10-04',
            reason_required: reasonRequired,
            non_working_day: false,
            staff: [
              {
                user_id: 'u1',
                full_name: 'Karim',
                role: 'TEACHER',
                staff_profile_id: 'profile-1',
                status: null,
              },
            ],
          }),
        ),
        http.put('/api/v1/staff-attendance/register', async ({ request }) => {
          onPut?.(await request.json());
          return HttpResponse.json({ saved: 1 });
        }),
      ];
    }
    function renderOld() {
      return renderWithRouter(routeTree, {
        initialEntries: ['/attendance/staff?date=2026-10-04'],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
    }

    it('blocks a save with no reason, then sends the typed reason', async () => {
      const puts: unknown[] = [];
      server.use(...oldDay(true, (b) => puts.push(b)));
      const user = userEvent.setup();
      const { localeReady } = renderOld();
      await localeReady;

      await user.click(await screen.findByRole('button', { name: 'Karim' }));
      await user.click(screen.getByRole('button', { name: 'Save attendance' }));
      expect(await screen.findByText('Write a reason of at least 3 characters.')).toBeTruthy();
      expect(puts).toHaveLength(0);

      await user.type(screen.getByLabelText('Why are you changing this day?'), 'late entry');
      await user.click(screen.getByRole('button', { name: 'Save attendance' }));
      expect(await screen.findByText('Attendance saved')).toBeTruthy();
      expect(puts).toEqual([
        {
          date: '2026-10-04',
          reason: 'late entry',
          entries: [{ staff_profile_id: 'profile-1', status: 'PRESENT' }],
        },
      ]);
    });

    it('shows no reason field inside the correction window', async () => {
      server.use(...oldDay(false));
      const { localeReady } = renderOld();
      await localeReady;

      await screen.findByRole('button', { name: 'Karim' });
      expect(screen.queryByLabelText('Why are you changing this day?')).toBeNull();
    });
  });

  describe('page chrome', () => {
    function twoStaff() {
      return day(
        [1, 2].map((n) => ({
          user_id: `user-${n}`,
          full_name: n === 1 ? 'Karim' : 'Rahima',
          role: 'TEACHER',
          staff_profile_id: `profile-${n}`,
        })),
      );
    }

    const pinEnglishRegion = http.get('/api/v1/schools/:schoolId/settings', () =>
      HttpResponse.json({ version: 1, region: REGION_BD_EN }),
    );

    function renderPage(search = '') {
      return renderWithRouter(routeTree, {
        initialEntries: [`/attendance/staff${search}`],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
    }

    it('shows one h1, a count, a labelled date field and a Leave link to the leave page', async () => {
      server.use(pinEnglishRegion, twoStaff());
      const { localeReady } = renderPage('?date=2026-10-04');
      await localeReady;

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Staff attendance' }),
      ).toBeTruthy();
      expect(await screen.findByText('2 staff members')).toBeTruthy();
      // The trigger shows the long date and is named "Date" (not the ISO text).
      expect(await screen.findByText('4th October, 2026')).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Date, / })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Leave' }).getAttribute('href')).toBe(
        '/attendance/staff/leave',
      );
    });

    it('falls back to today instead of crashing on a malformed ?date=', async () => {
      server.use(pinEnglishRegion, twoStaff());
      const { localeReady } = renderPage('?date=2026-13-45');
      await localeReady;

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Staff attendance' }),
      ).toBeTruthy();
      expect(await screen.findByRole('button', { name: 'Karim' })).toBeTruthy();
    });

    it('writes an ISO date to the URL when a day is picked', async () => {
      server.use(pinEnglishRegion, twoStaff());
      const user = userEvent.setup();
      const { router, localeReady } = renderPage('?date=2026-10-04');
      await localeReady;

      await user.click(await screen.findByRole('button', { name: /^Date, / }));
      await user.click(document.querySelector('[data-date="2026-10-10"]') as HTMLElement);

      await waitFor(() =>
        expect((router.state.location.search as { date?: string }).date).toBe('2026-10-10'),
      );
    });

    it('updates the count badges and the save bar as rows are marked, and shows Saved after saving', async () => {
      server.use(
        pinEnglishRegion,
        twoStaff(),
        http.put('/api/v1/staff-attendance/register', () => HttpResponse.json({ saved: 1 })),
      );
      const user = userEvent.setup();
      const { localeReady } = renderPage();
      await localeReady;

      const save = await screen.findByRole<HTMLButtonElement>('button', {
        name: 'Save attendance',
      });
      expect(screen.getByText('Present 0')).toBeTruthy();
      expect(screen.getByText('2 unmarked')).toBeTruthy();
      expect(save.disabled).toBe(true);
      // The save bar sits in the content column, not fixed over the sidebar.
      expect((save.parentElement as HTMLElement).className).toContain('sticky');
      expect((save.parentElement as HTMLElement).className).not.toContain('fixed');

      await user.click(screen.getByRole('button', { name: 'Karim' }));
      expect(await screen.findByText('Present 1')).toBeTruthy();
      expect(screen.getByText('1 unmarked')).toBeTruthy();

      await user.click(save);
      expect(await screen.findByText('Attendance saved')).toBeTruthy();
    });
  });
});
