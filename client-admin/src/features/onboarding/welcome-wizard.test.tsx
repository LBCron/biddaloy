/** [13.6.1] Doors, URL-held step, "Do it later", MSW-backed. */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { WelcomeWizard } from './welcome-wizard';

const status = (over: object = {}) => ({
  finished_at: null,
  dismissed_at: null,
  seen: false,
  setup_path: null,
  items: [],
  counts: { classes: 0, sections: 0, students: 0, staff: 0 },
  trial: null,
  support_url: 'https://example.test/help',
  ...over,
});

function useServer(over: object = {}) {
  const patches: Record<string, unknown>[] = [];
  server.use(
    http.get('/api/v1/onboarding/status', () => HttpResponse.json(status(over))),
    http.patch('/api/v1/onboarding', async ({ request }) => {
      patches.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(status());
    }),
  );
  return patches;
}

const SLOT = {
  guided: 'GUIDED SLOT',
  excel: 'EXCEL SLOT',
  people: 'PEOPLE SLOT',
  summary: 'SUMMARY SLOT',
  home: 'HOME',
};

function tree() {
  const root = createRootRoute();
  const welcome = createRoute({
    getParentRoute: () => root,
    path: '/welcome',
    component: () => (
      <WelcomeWizard
        guided={<p>{SLOT.guided}</p>}
        excel={<p>{SLOT.excel}</p>}
        people={<p>{SLOT.people}</p>}
        summary={<p>{SLOT.summary}</p>}
      />
    ),
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <p>{SLOT.home}</p>,
  });
  return root.addChildren([welcome, home]);
}

function renderEn(entry: string) {
  const result = renderWithRouter(tree(), {
    initialEntries: [entry],
    locale: 'en',
    tenantId: 'tenant-1',
    accessToken: 'a.b.c',
  });
  return result;
}

afterEach(cleanupTestState);

describe('WelcomeWizard', () => {
  it('marks the wizard seen once on mount', async () => {
    const patches = useServer();
    renderEn('/welcome');
    await screen.findByRole('radiogroup', { name: 'How do you want to set up your school?' });
    await waitFor(() => expect(patches).toEqual([{ seen: true }]));
  });

  it('saves a yes to the website question with the guided door', async () => {
    const patches = useServer();
    renderEn('/welcome');
    await userEvent.click(await screen.findByRole('radio', { name: 'Yes, set it up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('GUIDED SLOT');
    expect(patches).toContainEqual({ setup_path: 'guided', wants_website: true });
  });

  it('guided is preselected; Next saves the path and opens the slot', async () => {
    const patches = useServer();
    const { router } = renderEn('/welcome');
    const guided = await screen.findByRole('radio', { name: /Step by step/ });
    expect(guided.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('GUIDED SLOT')).toBeTruthy();
    expect(patches).toContainEqual({ setup_path: 'guided', wants_website: false });
    expect(router.state.location.search).toMatchObject({ step: 'setup', path: 'guided' });
    // Guided owns its Back / Next, so the frame footer is gone.
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('Excel opens the Excel slot; Back returns to the doors', async () => {
    useServer();
    renderEn('/welcome');
    await userEvent.click(await screen.findByRole('radio', { name: /Excel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('EXCEL SLOT')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      await screen.findByRole('radiogroup', { name: 'How do you want to set up your school?' }),
    ).toBeTruthy();
  });

  it('"later" saves it and goes to the people step', async () => {
    const patches = useServer();
    const { router } = renderEn('/welcome');
    await userEvent.click(await screen.findByRole('radio', { name: /later/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('PEOPLE SLOT')).toBeTruthy();
    expect(patches).toContainEqual({ setup_path: 'later', wants_website: false });
    expect(router.state.location.search).toMatchObject({ step: 'people' });
  });

  it('keyboard only: arrow to Excel, Enter opens it', async () => {
    useServer();
    renderEn('/welcome');
    await screen.findByRole('radiogroup', { name: 'How do you want to set up your school?' });
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByText('EXCEL SLOT')).toBeTruthy();
  });

  it('shows the support link from the status, and hides it without a URL', async () => {
    useServer();
    const first = renderEn('/welcome');
    const link = await screen.findByRole('link', { name: /Talk to us/ });
    expect(link.getAttribute('href')).toBe('https://example.test/help');
    first.unmount();

    useServer({ support_url: null });
    renderEn('/welcome');
    await screen.findByRole('radiogroup', { name: 'How do you want to set up your school?' });
    expect(screen.queryByRole('link', { name: /Talk to us/ })).toBeNull();
  });

  it('resumes the step from the URL on reload', async () => {
    useServer();
    renderEn('/welcome?step=done');
    expect(await screen.findByText('SUMMARY SLOT')).toBeTruthy();
    renderEn('/welcome?step=setup&path=excel');
    expect(await screen.findByText('EXCEL SLOT')).toBeTruthy();
  });

  it('the header close dismisses and leaves for the dashboard', async () => {
    const patches = useServer();
    renderEn('/welcome');
    await userEvent.click(await screen.findByRole('button', { name: 'Do this later' }));
    expect(await screen.findByText('HOME')).toBeTruthy();
    expect(patches).toContainEqual({ dismissed: true });
  });

  it('shows an error and stays when saving fails', async () => {
    useServer();
    server.use(http.patch('/api/v1/onboarding', () => new HttpResponse(null, { status: 500 })));
    renderEn('/welcome');
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('GUIDED SLOT')).toBeNull();
  });
});
