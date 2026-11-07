import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server, userEvent } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { mockDraftSite, type SavedDraft } from './-draft-fixture';
import { baseSite } from './-test-handlers';

const render = (entry = '/website/pages') =>
  renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: UserRole.ADMIN,
    locale: 'en',
  });

const keys = (config: SavedDraft, page = 0) => config.pages[page]!.sections.map((s) => s.key);

describe('/website/pages', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the tabs and the sections of the first page', async () => {
    mockDraftSite();
    render();
    expect(await screen.findByRole('button', { name: 'Edit Front banner' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Design' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Enquiries' })).toBeTruthy();
  });

  it('keeps the hero in place: no move buttons on it', async () => {
    mockDraftSite();
    render();
    await screen.findByRole('button', { name: 'Edit Front banner' });
    expect(screen.queryByRole('button', { name: /Move Front banner/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Move Notices up/ })).toBeTruthy();
  });

  it('moves a section up and saves the new order', async () => {
    const saved = mockDraftSite();
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Move Notices up/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(keys(saved[0]!)).toEqual(['hero', 'notices', 'about', 'teachers']);
  });

  it('turns a section on and saves it, keeping the rest', async () => {
    const saved = mockDraftSite();
    render();
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Show Teachers on the website' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const teachers = saved[0]!.pages[0]!.sections.find((s) => s.key === 'teachers');
    expect(teachers?.enabled).toBe(true);
    expect(keys(saved[0]!)).toEqual(['hero', 'about', 'notices', 'teachers']);
  });

  it('shows the save bar only while there is something to save', async () => {
    mockDraftSite();
    render();
    await screen.findByRole('button', { name: 'Edit Front banner' });
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Show Teachers on the website' }));
    expect(await screen.findByText('You have changes that are not saved.')).toBeTruthy();
  });

  it('switches a whole page off and saves it', async () => {
    const saved = mockDraftSite();
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'About us' }));
    await userEvent.click(await screen.findByRole('switch', { name: 'Show on website' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.pages[1]!.enabled).toBe(false);
    expect(saved[0]!.pages[0]!.enabled).toBe(true);
  });

  it('opens the section editor from ?edit= and closes back to the list', async () => {
    mockDraftSite();
    const { router } = render('/website/pages?edit=hero');
    expect(await screen.findByRole('heading', { name: 'Edit Front banner' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Back to sections' }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('edit'));
  });
});

describe('/website/pages unsaved work', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('drops an ?edit= that names no section', async () => {
    mockDraftSite();
    const { router } = render('/website/pages?edit=nope');
    await screen.findByRole('button', { name: 'Edit Front banner' });
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('edit'));
  });

  it('keeps the edits on screen when the save is refused as stale (409)', async () => {
    mockDraftSite();
    let refused = false;
    server.use(
      http.put('/api/v1/website/draft', () => {
        refused = true;
        return HttpResponse.json({ statusCode: 409, message: 'site.stale' }, { status: 409 });
      }),
    );
    render();
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Show Teachers on the website' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(refused).toBe(true));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      screen
        .getByRole('switch', { name: 'Show Teachers on the website' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();
  });

  it('keeps what was typed while the save was in flight', async () => {
    const saved = mockDraftSite();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.put('/api/v1/website/draft', async ({ request }) => {
        const body = (await request.json()) as { config: SavedDraft };
        await gate;
        saved.push(body.config);
        return HttpResponse.json({
          ...baseSite,
          theme: 'basic',
          draft: body.config,
          draft_revision: 9,
        });
      }),
    );
    render();
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Show Teachers on the website' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Show Notices on the website' }));
    release();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(
      screen
        .getByRole('switch', { name: 'Show Notices on the website' })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(await screen.findByRole('button', { name: 'Save draft' })).toBeTruthy();
  });
});
