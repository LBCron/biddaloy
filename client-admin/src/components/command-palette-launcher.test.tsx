import { HelpProvider } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../routeTree.gen';

import { CommandPaletteLauncher } from './command-palette-launcher';

/**
 * [30.5.1] `CommandPaletteLauncher` replaces the retired
 * `GlobalSearchLauncher`. Rendered through the real staff layout
 * (`_staff.tsx` mounts it in the top bar on every staff route), same
 * reasoning as every other route test in this app.
 *
 * [8.14.3]: `_staff.tsx` mounts this component twice (desktop top bar,
 * mobile header row) — `findAllByRole(...)[0]` picks the desktop
 * instance deterministically, same as the old launcher's own test did.
 */
describe('CommandPaletteLauncher', () => {
  afterEach(async () => {
    window.localStorage.clear(); // palette recents persist per device
    await cleanupTestState();
  });

  it('selecting a guardian result navigates to its own detail page', async () => {
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          guardians: [{ id: 'guardian-1', full_name: 'Karim Rahman', phone: '+8801700000000' }],
        }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'Karim');

    const option = await screen.findByRole('option', { name: /Karim Rahman/ });
    await user.click(option);

    await waitFor(() => expect(router.state.location.pathname).toBe('/guardians/guardian-1'));
  });

  it('selecting a student result navigates to its own detail page', async () => {
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          students: [
            {
              id: 'student-1',
              full_name: 'Rahim Uddin',
              registration_number: 'R-1',
              roll_number: 1,
              class_name: 'Five',
              section_name: 'A',
              matched_via: 'direct',
            },
          ],
        }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'Rahim');

    const option = await screen.findByRole('option', { name: /Rahim Uddin/ });
    await user.click(option);

    await waitFor(() => expect(router.state.location.pathname).toBe('/students/student-1'));
  });

  it('selecting a staff result closes the palette without navigating — no detail page exists', async () => {
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          staff: [{ id: 'staff-1', full_name: 'Nasrin Akter', employee_id: 'E-1' }],
        }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'Nasrin');

    const option = await screen.findByRole('option', { name: /Nasrin Akter/ });
    await user.click(option);

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('`/` as the first character switches to the Page tab (D11)', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    const input = screen.getByRole('combobox', { name: 'Search' });
    await user.type(input, '/');

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Page' }).getAttribute('aria-selected')).toBe('true'),
    );
    // The `/` itself was consumed as the tab switch, not query text.
    expect(input).toHaveProperty('value', '');
  });

  it('Action tab offers an action only when its permission is held', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    const input = screen.getByRole('combobox', { name: 'Search' });
    await user.type(input, '>student');

    await waitFor(() => expect(screen.queryByRole('option', { name: 'Add student' })).toBeNull());
  });

  it('Action tab finds the arrival-notice action by its synonyms', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    const input = screen.getByRole('combobox', { name: 'Search' });
    await user.type(input, '>reached school');

    expect(await screen.findByRole('option', { name: 'Arrival notice requests' })).toBeTruthy();
  });

  it('Action tab lists "Switch demo role" only in the demo, and it signs out to /login', async () => {
    let signedOut = false;
    server.use(
      http.post('/api/v1/auth/logout', () => {
        signedOut = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get('/api/v1/demo/roles', () =>
        HttpResponse.json({ enabled: true, password: 'x', cards: [] }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    // The demo namespace loads once the call answers, which re-renders the shell; wait for it.
    await screen.findByRole('note', { name: /Demo site/ });
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    await user.type(screen.getByRole('combobox', { name: 'Search' }), '>Switch demo');
    await user.click(await screen.findByRole('option', { name: 'Switch demo role' }));

    // The sign-out call is what proves the action ran; where `/login` lands is the root guard's call.
    await waitFor(() => expect(signedOut).toBe(true));
  });

  it('Action tab has no "Switch demo role" outside the demo', async () => {
    server.use(http.get('/api/v1/demo/roles', () => new HttpResponse(null, { status: 404 })));
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    await user.type(screen.getByRole('combobox', { name: 'Search' }), '>Switch demo');

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: 'Switch demo role' })).toBeNull(),
    );
  });

  it('Action tab offers a context-free action (`context: []`) from any page', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    const input = screen.getByRole('combobox', { name: 'Search' });
    await user.type(input, '>start acr');

    expect(await screen.findByRole('option', { name: 'Start ACR' })).toBeTruthy();
  });

  it('COMMITTEE (no STUDENT_READ) sees Page and Action tabs only and makes no /search call', async () => {
    let searchCalls = 0;
    server.use(
      http.get('/api/v1/search', () => {
        searchCalls += 1;
        return HttpResponse.json({});
      }),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/roles'],
      tenantId: 'tenant-1',
      role: 'COMMITTEE',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    const input = screen.getByRole('combobox', { name: 'Search' });
    // No People tab, so the placeholder must not promise a people search.
    expect(input.getAttribute('placeholder')).toBe('Search pages and actions…');
    await user.type(input, 'ab');

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Page', 'Action']);
    expect(searchCalls).toBe(0);
  });

  it('with `pages`, shows only the Page tab, navigates to a page and makes no /search call', async () => {
    let searchCalls = 0;
    server.use(
      http.get('/api/v1/search', () => {
        searchCalls += 1;
        return HttpResponse.json({});
      }),
    );
    const rootRoute = createRootRoute();
    const pages = [{ id: 'results', label: 'Results page', to: '/portal/results' }];
    const tree = rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <CommandPaletteLauncher pages={pages} />,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/portal/results',
        component: () => <p data-testid="results-page" />,
      }),
    ]);
    const { router } = renderWithRouter(tree, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Search… Ctrl+K' }));
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'Results');

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Page']);
    await user.click(await screen.findByRole('option', { name: /Results page/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/portal/results'));
    // Wait past the 300 ms search debounce, or a late /search call would be missed.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(searchCalls).toBe(0);
  });

  async function openPalette() {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
    return { user, input: screen.getByRole('combobox', { name: 'Search' }) };
  }

  it('Page tab lists every permitted page on an empty query: Dashboard first, sidebar order, pinned first', async () => {
    const { user } = await openPalette();
    await user.keyboard('{Control>}2{/Control}');

    const listbox = await screen.findByRole('listbox', { name: 'Search' });
    const rows = within(listbox).getAllByRole('option');
    expect(rows[0]?.textContent).toMatch(/Dashboard/);
    const text = listbox.textContent ?? '';
    const order = ['People', 'Academics', 'Finance', 'Administration'].map((g) => text.indexOf(g));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text.indexOf('Student dues')).toBeLessThan(text.indexOf('Fee structures'));
  });

  it('Action tab shows context actions disabled with a reason; click does nothing', async () => {
    const { user } = await openPalette();
    await user.keyboard('{Control>}3{/Control}');

    const row = await screen.findByRole('option', { name: /Record payment/ });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toContain('Open a student or an invoice first');
    await user.click(row);

    expect(screen.getByRole('combobox', { name: 'Search' })).toBeTruthy();
  });

  it('Enter on a disabled first row leaves the palette open', async () => {
    const { user, input } = await openPalette();
    await user.keyboard('{Control>}3{/Control}');
    await user.type(input, 'waive');
    const row = await screen.findByRole('option', { name: /Waive fine/ });
    expect(row.getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{Enter}');

    expect(screen.getByRole('combobox', { name: 'Search' })).toBeTruthy();
  });

  it('ranks enabled actions before disabled ones within a group', async () => {
    const { user, input } = await openPalette();
    await user.keyboard('{Control>}3{/Control}');
    await user.type(input, 'fine');

    const names = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
    const generate = names.findIndex((n) => n.startsWith('Generate fines'));
    const log = names.findIndex((n) => n.startsWith('Log fine'));
    expect(generate).toBeGreaterThanOrEqual(0);
    expect(generate).toBeLessThan(log);
  });

  it('with `pages`, an empty query lists every page and the footer drops the tab shortcuts', async () => {
    const rootRoute = createRootRoute();
    const pages = [
      { id: 'results', label: 'Results page', to: '/portal/results' },
      { id: 'fees', label: 'Fees page', to: '/portal/fees' },
    ];
    const tree = rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <CommandPaletteLauncher pages={pages} />,
      }),
    ]);
    renderWithRouter(tree, { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Search… Ctrl+K' }));

    expect(await screen.findByRole('option', { name: /Results page/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Fees page/ })).toBeTruthy();
    expect(screen.getByText('↑↓ move · Enter open · Esc close')).toBeTruthy();
  });

  describe('[48.3.15] Epic 48 actions use the route ids', () => {
    async function openActions(entry: string, role: string, query: string) {
      const view = renderWithRouter(routeTree, {
        initialEntries: [entry],
        tenantId: 'tenant-1',
        role,
        locale: 'en',
      });
      const user = userEvent.setup();
      await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
      await user.type(screen.getByRole('combobox', { name: 'Search' }), query);
      return { ...view, user };
    }

    it('on an exam page an EXAM_CONTROLLER lands on that exam’s Print tab', async () => {
      const { user, router } = await openActions('/exams/e-1', 'EXAM_CONTROLLER', '>admit');
      await user.click(await screen.findByRole('option', { name: 'Print admit cards' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/exams/e-1'));
      expect(router.state.location.search).toMatchObject({ tab: 'print' });
    });

    it('on a student page an OFFICE_STAFF opens the issue modal (issue=pick)', async () => {
      const { user, router } = await openActions('/students/s-1', 'OFFICE_STAFF', '>issue');
      await user.click(await screen.findByRole('option', { name: 'Issue certificate' }));
      await waitFor(() =>
        expect(router.state.location.search).toMatchObject({ tab: 'documents', issue: 'pick' }),
      );
    });

    const absent = (name: string) => expect(screen.queryByRole('option', { name })).toBeNull();

    it('a role without CERTIFICATE_ISSUE sees Certificate register but not Issue certificate', async () => {
      await openActions('/students/s-1', 'EXAM_CONTROLLER', '>certificate');
      expect(await screen.findByRole('option', { name: 'Certificate register' })).toBeTruthy();
      absent('Issue certificate');
    });

    it('Issue certificate is absent on a page with no student', async () => {
      await openActions('/students', 'OFFICE_STAFF', '>certificate');
      expect(await screen.findByRole('option', { name: 'Certificate register' })).toBeTruthy();
      absent('Issue certificate');
    });

    it('Print admit cards is absent without EXAM_MANAGE', async () => {
      await openActions('/exams/e-1', 'OFFICE_STAFF', '>print');
      expect(await screen.findByRole('option', { name: 'Print student ID card' })).toBeTruthy();
      absent('Print admit cards');
    });

    it('Print admit cards is absent off an exam page', async () => {
      await openActions('/students', 'EXAM_CONTROLLER', '>print');
      expect(await screen.findByRole('option', { name: 'Print student ID card' })).toBeTruthy();
      absent('Print admit cards');
    });

    it('a PRINT_HISTORY_READ-only role does not see To print', async () => {
      await openActions('/students', 'EXECUTIVE', '>print');
      expect(await screen.findByRole('option', { name: 'Print history' })).toBeTruthy();
      absent('To print');
    });
  });
  describe('F1 and Help for this page [44.2.01]', () => {
    const HREF = 'https://guide.example/docs/en/';

    // jsdom has no layout, so `offsetParent` is always null and the launcher's
    // "only the visible instance listens" guard would swallow every key. Make
    // exactly one of the two mounted launchers (desktop/mobile) "visible".
    let visible: Element | undefined;
    function visibleLaunchers() {
      vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this === visible ? document.body : null;
      });
    }

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    });

    async function setup(path: string, handbook = 'https://guide.example/docs') {
      vi.stubEnv('VITE_HANDBOOK_URL', handbook);
      visibleLaunchers();
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      renderWithRouter(routeTree, {
        initialEntries: [path],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
      visible = (await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0];
      return { open, user: userEvent.setup() };
    }

    it('F1 outside inputs opens the page guide in a new tab', async () => {
      const { open, user } = await setup('/students');
      await user.keyboard('{F1}');
      expect(open).toHaveBeenCalledTimes(1);
      expect(String(open.mock.calls[0]?.[0]).startsWith(HREF)).toBe(true);
      expect(open.mock.calls[0]?.slice(1)).toEqual(['_blank', 'noopener']);
    });

    it('F1 with a modifier does nothing', async () => {
      const { open, user } = await setup('/students');
      await user.keyboard('{Shift>}{F1}{/Shift}{Control>}{F1}{/Control}');
      expect(open).not.toHaveBeenCalled();
    });

    it('a held F1 (key repeat) opens nothing', async () => {
      const { open } = await setup('/students');
      fireEvent.keyDown(window, { key: 'F1', repeat: true });
      expect(open).not.toHaveBeenCalled();
    });

    it('the shortcuts sheet lists F1 only when the page has a guide', async () => {
      const { user } = await setup('/students');
      await user.keyboard('?');
      expect(await screen.findByText('Open help for this page')).toBeTruthy();
    });

    it('without a handbook URL, F1 does nothing and the sheet omits it', async () => {
      const { open, user } = await setup('/students', '');
      await user.keyboard('{F1}');
      expect(open).not.toHaveBeenCalled();
      await user.keyboard('?');
      expect(await screen.findByText('Open command palette')).toBeTruthy();
      expect(screen.queryByText('Open help for this page')).toBeNull();
    });

    it('the portal (page-only) palette lists Help for this page and opens the guide', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const rootRoute = createRootRoute();
      const tree = rootRoute.addChildren([
        createRoute({
          getParentRoute: () => rootRoute,
          path: '/',
          component: () => (
            <HelpProvider
              lang="en"
              baseUrl="https://guide.example/docs"
              pageId="portal.fees"
              index={{
                'portal.fees': {
                  title: { bn: 'ফি', en: 'Fees' },
                  summary: { bn: 's', en: 's' },
                  path: 'portal/fees',
                  anchor: '',
                  knownIssues: 0,
                },
              }}
            >
              <CommandPaletteLauncher pages={[{ id: 'fees', label: 'Fees page', to: '/fees' }]} />
            </HelpProvider>
          ),
        }),
      ]);
      const { router } = renderWithRouter(tree, {
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Search… Ctrl+K' }));
      // Exact name: the row has no description, so the guide URL is not part of it.
      await user.click(await screen.findByRole('option', { name: 'Help for this page' }));
      expect(open).toHaveBeenCalledWith(
        'https://guide.example/docs/en/portal/fees',
        '_blank',
        'noopener',
      );
      expect(router.state.location.pathname).toBe('/');
    });

    it('F1 inside an input does nothing', async () => {
      const { open, user } = await setup('/students');
      await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
      await user.type(await screen.findByRole('combobox', { name: 'Search' }), 'x{F1}');
      expect(open).not.toHaveBeenCalled();
    });

    it('the palette offers Help for this page on a page with a guide', async () => {
      const { open, user } = await setup('/students');
      await user.click((await screen.findAllByRole('button', { name: 'Search… Ctrl+K' }))[0]!);
      await user.type(await screen.findByRole('combobox', { name: 'Search' }), '>help for');
      await user.click(await screen.findByRole('option', { name: 'Help for this page' }));
      expect(open).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\/guide\.example\//),
        '_blank',
        'noopener',
      );
    });
  });
});
