import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, userEvent } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { mockDraftSite } from './-draft-fixture';

const render = () =>
  renderWithRouter(routeTree, {
    initialEntries: ['/website/design'],
    tenantId: 'tenant-1',
    role: UserRole.ADMIN,
    locale: 'en',
  });

describe('/website/design', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('marks the design in use and offers the other one', async () => {
    mockDraftSite();
    render();
    const basic = await screen.findByRole('button', { name: 'Basic' });
    expect(basic.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Primary' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('asks before changing the design and says written text stays; Cancel changes nothing', async () => {
    mockDraftSite();
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Primary' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Your own text stays/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });

  it('changes the design only after Confirm, and saves only the design and its colours/fonts', async () => {
    const saved = mockDraftSite();
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Primary' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Change design' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.theme).toBe('primary');
    // The admin's own text is sent back untouched; the server fills only empty fields (D25).
    expect(saved[0]!.pages[0]!.sections[0]!.data).toEqual({
      headline: { bn: 'আমার হেডলাইন', en: 'My headline' },
    });
  });

  it('saves the chosen colour', async () => {
    const saved = mockDraftSite();
    render();
    await userEvent.click(await screen.findByRole('radio', { name: /Blue/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.palette).toBe('blue');
  });

  it('saves a font for each language on its own', async () => {
    const saved = mockDraftSite();
    render();
    await userEvent.click(await screen.findByRole('combobox', { name: 'Text style: Bangla' }));
    // The second Bangla option is Noto Serif Bengali.
    await userEvent.click((await screen.findAllByRole('option'))[1]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.typography.bn).toEqual({
      heading: 'noto-serif-bengali',
      body: 'noto-serif-bengali',
    });
    expect(saved[0]!.typography.en).toEqual({ heading: 'inter', body: 'inter' });
  });

  it('points the preview links at the draft and at each design', async () => {
    mockDraftSite();
    render();
    await screen.findByRole('button', { name: 'Basic' });
    const links = screen.getAllByRole('link', { name: 'Preview this design' });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/website/preview/basic',
      '/website/preview/primary',
    ]);
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
  });
});
