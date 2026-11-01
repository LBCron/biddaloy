import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

/**
 * [8.14.17]'s per-role coverage of `_staff.tsx`'s `RequirePermission`
 * gate — the audit that motivated this ticket found a TEACHER's
 * `/fees/dues` rendering 46 students' payment balances and a TEACHER's
 * `/staff` rendering the whole staff directory including email
 * addresses, neither of which `TEACHER`'s `ROLE_PERMISSIONS` actually
 * grants. These cases are named explicitly rather than left to the
 * generic per-route matrix below, so a regression here has its own
 * failing test, not just a line in a larger table.
 *
 * Asserts on the access-denied heading and on `router.state.location`,
 * not on page content — a refused route must render *something* in
 * place, and must not navigate anywhere else while doing it.
 */
describe('_staff route access [8.14.17]', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const ACCESS_DENIED_TITLE = "You don't have access to this page.";

  it("refuses a TEACHER at /fees/dues (previously rendered every student's balance)", async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(ACCESS_DENIED_TITLE)).toBeTruthy());
    // Regression case the ticket calls out by name: a refused role stays
    // on the URL it visited, it is never bounced into a *different*
    // page — refusing in place, not redirecting to another privileged
    // route it also can't see.
    expect(router.state.location.pathname).toBe('/fees/dues');
  });

  it('refuses a TEACHER at /staff (previously rendered the whole directory, incl. emails)', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(ACCESS_DENIED_TITLE)).toBeTruthy());
    expect(router.state.location.pathname).toBe('/staff');
  });

  it('renders /students for a TEACHER, who holds STUDENT_READ', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() => expect(screen.queryByText(ACCESS_DENIED_TITLE)).toBeNull());
  });

  // [83.4.1] D25: COORDINATION_VIEW is TEACHER only; ADMIN already sees every class.
  it('renders /my-coordination for a TEACHER and refuses an ADMIN in place', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/my-coordination'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });
    await waitFor(() => expect(screen.queryByText(ACCESS_DENIED_TITLE)).toBeNull());
    await cleanupTestState();

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/my-coordination'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });
    await waitFor(() => expect(screen.getByText(ACCESS_DENIED_TITLE)).toBeTruthy());
    expect(router.state.location.pathname).toBe('/my-coordination');
  });

  it('refuses an EXECUTIVE at /invoices, who holds no INVOICE_READ', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/invoices'],
      tenantId: 'tenant-1',
      role: UserRole.EXECUTIVE,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(ACCESS_DENIED_TITLE)).toBeTruthy());
    expect(router.state.location.pathname).toBe('/invoices');
  });

  it('renders /students for an EXECUTIVE, who holds STUDENT_READ', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: UserRole.EXECUTIVE,
      locale: 'en',
    });

    await waitFor(() => expect(screen.queryByText(ACCESS_DENIED_TITLE)).toBeNull());
  });

  it.each(['/fees/dues', '/staff', '/invoices'] as const)(
    'renders %s for an ADMIN, who holds every permission',
    async (path) => {
      renderWithRouter(routeTree, {
        initialEntries: [path],
        tenantId: 'tenant-1',
        role: UserRole.ADMIN,
        locale: 'en',
      });

      await waitFor(() => expect(screen.queryByText(ACCESS_DENIED_TITLE)).toBeNull());
    },
  );

  // [14.11.4/#614] `SETTINGS_MANAGE` and `BACKUP_MANAGE` are granted to the
  // exact same role set today — ADMIN only, plus SUPER_ADMIN which holds
  // everything (`shared/src/enums/permissions.ts`). So no role can reach
  // `/settings` without also holding `BACKUP_MANAGE`, and there is no
  // "sees Settings but not Backup" case to write at this route level. These
  // three cases exist so a *future* divergence between the two permissions
  // — one granted to a role the other isn't — fails here, at the route
  // gate, rather than only inside the in-page assertion #612 already owns
  // (`backup-section.test.tsx`'s "section absent without the permission").
  it('refuses a TEACHER at /settings (no SETTINGS_MANAGE, so no Backup UI)', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/settings'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(ACCESS_DENIED_TITLE)).toBeTruthy());
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('refuses an ACCOUNTANT at /settings', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/settings'],
      tenantId: 'tenant-1',
      role: UserRole.ACCOUNTANT,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(ACCESS_DENIED_TITLE)).toBeTruthy());
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('renders /settings for an ADMIN, who holds SETTINGS_MANAGE and BACKUP_MANAGE', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/settings'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    await waitFor(() => expect(screen.queryByText(ACCESS_DENIED_TITLE)).toBeNull());
  });

  // [17.4.2] Calendar nav item — every tenant role (`ROLE_PERMISSIONS`
  // in `shared/src/enums/permissions.ts`) holds `CALENDAR_READ`, so
  // there is no *authenticated* role that should see the sidebar without
  // the Calendar link — the "no role active" case just below is the one
  // real "hidden" case: with no session, `_staff.tsx`'s sidebar never
  // mounts at all.
  it('shows the Calendar nav item for a TEACHER, who holds CALENDAR_READ', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('link', { name: /calendar/i })).toBeTruthy());
  });

  it('fails closed when no role is active at all', async () => {
    // No role active never even reaches `RequirePermission` — or even
    // `_staff.tsx`'s outer `RequireRole` gate. `__root.tsx`'s own
    // `beforeLoad` guard is one layer earlier still: with no session to
    // resolve a role from, `ensureSessionLoaded()` reports unauthenticated
    // and the whole app redirects to `/login` before any staff route ever
    // matches. Still fail-closed, just at a higher gate: an unresolved
    // visitor never sees staff content either way. The default refresh
    // handler hands back a session with no school, so the visitor lands
    // on /select-school's "not in any school" state (#1632: sign out
    // offered there instead of bouncing to /login).
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/select-school'));
    expect(
      await screen.findByRole('heading', { name: 'You are not in any school yet' }),
    ).toBeTruthy();
    expect(screen.queryByText(ACCESS_DENIED_TITLE)).toBeNull();
    // Sidebar (and its Calendar link) never mounts pre-login.
    expect(screen.queryByRole('link', { name: /calendar/i })).toBeNull();
  });
});
