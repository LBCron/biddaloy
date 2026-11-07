import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, userEvent } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { mockDraftSite } from './-draft-fixture';

const render = (entry: string) =>
  renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: UserRole.ADMIN,
    locale: 'en',
  });

describe('/website tab strip', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it.each([
    ['/website/pages', 'Pages'],
    ['/website/design', 'Design'],
  ])('a deep link to %s activates the %s tab', async (entry, name) => {
    mockDraftSite();
    render(entry);
    const tab = await screen.findByRole('tab', { name });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(
      screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });

  it('moves between tabs with the arrow keys and follows to the route', async () => {
    mockDraftSite();
    const { router } = render('/website/pages');
    const tab = await screen.findByRole('tab', { name: 'Pages' });
    tab.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/website/design'));
    expect(screen.getByRole('tab', { name: 'Design' }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps unsaved edits when the admin goes to another tab and comes back', async () => {
    mockDraftSite();
    render('/website/pages');
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Show Teachers on the website' }),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Design' }));
    expect(await screen.findByText('You have changes that are not saved.')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    const teachers = await screen.findByRole('switch', { name: 'Show Teachers on the website' });
    expect(teachers.getAttribute('aria-checked')).toBe('true');
  });

  it('asks before leaving /website with unsaved edits, and Keep editing stays', async () => {
    mockDraftSite();
    const { router } = render('/website/pages');
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Show Teachers on the website' }),
    );
    void router.navigate({ to: '/dashboard' });
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/website/pages');
  });
});
