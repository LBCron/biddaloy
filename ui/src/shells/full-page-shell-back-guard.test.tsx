import { QueryClientProvider } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '../i18n/i18n';
import { I18nProvider } from '../i18n/locale-provider';
import { createTestQueryClient } from '../test/render-with-providers';

import { FullPageShell, useCloseFullPage } from './full-page-shell';

/**
 * #3173: browser Back with unsaved changes asks before it drops the overlay.
 *
 * Needs a real (jsdom) browser history: a memory history never blocks a back/forward step, so
 * `renderWithRouter` cannot show this. The overlay is opened with a push, as the host pages do
 * (`?assignment=<id>`), so Back is what removes it.
 */
describe('FullPageShell Back guard', () => {
  // Each mount makes a browser history that listens on window and wraps pushState/replaceState;
  // unmount the tree, then destroy every history so no later test gets its callbacks.
  const routers: { history: { destroy: () => void } }[] = [];
  afterEach(() => {
    cleanup();
    for (const r of routers.splice(0)) r.history.destroy();
    window.history.replaceState({}, '', '/');
  });

  function mount(dirty: boolean) {
    window.history.replaceState({}, '', '/a');
    const root = createRootRoute();
    const Page = () => {
      const navigate = useNavigate();
      const search = route.useSearch();
      const close = useCloseFullPage(() => {});
      return (
        <div>
          <button onClick={() => void navigate({ to: '/a', search: { add: 1 } })}>open</button>
          {search.add === 1 && (
            <FullPageShell title="Check work" onClose={close} dirty={dirty}>
              <p>grid</p>
            </FullPageShell>
          )}
        </div>
      );
    };
    const route = createRoute({
      getParentRoute: () => root,
      path: '/a',
      validateSearch: (s: Record<string, unknown>) => ({
        add: s.add === 1 ? (1 as const) : undefined,
      }),
      component: Page,
    });
    const other = createRoute({
      getParentRoute: () => root,
      path: '/b',
      component: () => <p>other page</p>,
    });
    const queryClient = createTestQueryClient();
    const router = createRouter({
      routeTree: root.addChildren([route, other]),
      history: createBrowserHistory(),
      context: { queryClient },
    });
    routers.push(router);
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <RouterProvider router={router} />
        </I18nProvider>
      </QueryClientProvider>,
    );
    return router;
  }

  async function openOverlay(dirty: boolean) {
    await i18n.changeLanguage('en');
    const router = mount(dirty);
    const user = userEvent.setup();
    await user.click(await screen.findByText('open'));
    await screen.findByText('grid');
    return { router, user };
  }

  it('dirty without any router (a bare mount) renders, there is just no history to guard', async () => {
    await i18n.changeLanguage('en');
    render(
      <I18nProvider>
        <FullPageShell title="Bare" onClose={() => {}} dirty>
          <p>content</p>
        </FullPageShell>
      </I18nProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Bare' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('dirty: Back asks first; Keep editing stays on the overlay', async () => {
    const { router, user } = await openOverlay(true);
    window.history.back();
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(router.state.location.search).toEqual({ add: 1 }));
    expect(screen.getByText('grid')).toBeTruthy();
  });

  it('dirty: a jump of several entries (history GO) asks too', async () => {
    await i18n.changeLanguage('en');
    const router = mount(true);
    // /a, /b, /a, /a?add=1: going back two entries lands on /b in one GO step.
    await router.navigate({ to: '/b' });
    await screen.findByText('other page');
    await router.navigate({ to: '/a' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('open'));
    await screen.findByText('grid');
    window.history.go(-2);
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ add: 1 }));
    expect(screen.getByText('grid')).toBeTruthy();
  });

  it('dirty: Discard changes lets the Back through', async () => {
    const { router, user } = await openOverlay(true);
    window.history.back();
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByText('grid')).toBeNull());
    expect(router.state.location.search).toEqual({});
  });

  it('not dirty: Back goes straight through', async () => {
    const { router } = await openOverlay(false);
    window.history.back();
    await waitFor(() => expect(screen.queryByText('grid')).toBeNull());
    expect(router.state.location.search).toEqual({});
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('dirty: a navigate() is not blocked (a save-then-navigate must not be asked)', async () => {
    const { router } = await openOverlay(true);
    await router.navigate({ to: '/b' });
    await screen.findByText('other page');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('dirty: the page closer asks once (the shell dialog), not twice', async () => {
    const { router, user } = await openOverlay(true);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a later Back is asked again after the page closed once (no stale pass)', async () => {
    const { user } = await openOverlay(true);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByText('grid')).toBeNull());
    await user.click(screen.getByText('open'));
    await screen.findByText('grid');
    window.history.back();
    await screen.findByRole('alertdialog');
  });
});
