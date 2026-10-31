import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

/**
 * #533's SUPER_ADMIN-only platform console — `_platform/route.tsx`'s
 * `RequireRole` gate, same "redirect for the wrong role, render for the
 * right one" shape `_staff.access.test.tsx` covers for `_staff.tsx`.
 */
describe('_platform route access [#533]', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('redirects an ADMIN away from /schools to /dashboard', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/schools'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });

  it('renders /schools for a SUPER_ADMIN', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/schools'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Schools' })).toBeTruthy());
  });

  it('hides the platform nav item for a non-SUPER_ADMIN', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/dashboard'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    await waitFor(() => expect(screen.queryByText('Schools (platform)')).toBeNull());
  });

  it('shows the platform nav item for a SUPER_ADMIN', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/dashboard'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getAllByText('Schools (platform)').length).toBeGreaterThan(0),
    );
  });

  it('[31.3.3] shows the console in the shared shell: four sidebar links, Schools current', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/schools'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Schools',
      'Holiday lists',
      'Subscriptions',
      'Report usage',
    ]);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    // The old hand-made "Dashboard / Platform admin" trail is gone.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });
});
