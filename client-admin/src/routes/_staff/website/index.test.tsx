import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, userEvent } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { mockWebsite } from './-test-handlers';

const render = (entry = '/website', role: UserRole = UserRole.ADMIN) =>
  renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

describe('/website Overview', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('is refused to a role without WEBSITE_MANAGE', async () => {
    mockWebsite();
    render('/website', UserRole.TEACHER);
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
  });

  it('shows the start card until something is published, and it opens the wizard', async () => {
    mockWebsite();
    const { router } = render();
    const start = await screen.findByRole('button', { name: 'Set up the website' });
    await userEvent.click(start);
    await waitFor(() => expect(router.state.location.search).toMatchObject({ step: 'address' }));
    expect(await screen.findByLabelText('Your web address')).toBeTruthy();
  });

  it('shows status and the live link once published, and says draft before that', async () => {
    mockWebsite({ has_published: true, enabled: true, version: 2 });
    render();
    expect(await screen.findByText('Your website is on')).toBeTruthy();
    expect(await screen.findByText('https://rumsc.example.test')).toBeTruthy();
    expect(screen.getByText(/12\.0 MB \/ 100 MB/)).toBeTruthy();
  });

  it('shows the unpublished badge and enables Publish only while there are changes', async () => {
    mockWebsite({ has_published: true, enabled: true, version: 2 });
    render();
    expect(await screen.findByText('Changes not published')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' }).disabled).toBe(false);
  });

  it('disables Publish when the published copy equals the draft', async () => {
    mockWebsite({ has_published: true, enabled: true, version: 2, has_unpublished_changes: false });
    render();
    await screen.findByText('Your website is on');
    expect(screen.queryByText('Changes not published')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' }).disabled).toBe(true);
  });

  it('hides the live link while the website is off', async () => {
    mockWebsite({ has_published: true, enabled: false, version: 2 });
    render();
    await screen.findByText('Draft');
    expect(screen.queryByText('Your website link')).toBeNull();
  });

  it('?publish=1 on a never-published site opens the wizard at its last step', async () => {
    mockWebsite();
    const { router } = render('/website?publish=1');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ step: 'publish' }));
    expect(await screen.findByRole('button', { name: 'Publish and turn on' })).toBeTruthy();
  });

  it('shows Draft for a published site that is switched off', async () => {
    mockWebsite({ has_published: true, enabled: false, version: 2 });
    render();
    expect(await screen.findByText('Draft')).toBeTruthy();
  });

  it('asks before turning the website off, and does nothing on Cancel', async () => {
    const calls = mockWebsite({ has_published: true, enabled: true, version: 2 });
    render();
    await userEvent.click(await screen.findByRole('switch'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Turn the website off?')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(calls).toEqual([]);

    await userEvent.click(screen.getByRole('switch'));
    const again = await screen.findByRole('alertdialog');
    await userEvent.click(within(again).getByRole('button', { name: 'Turn the website off' }));
    await waitFor(() => expect(calls).toEqual(['enabled:false']));
  });

  it('publishes with the version and draft it showed, after a confirm (?publish=1)', async () => {
    const calls = mockWebsite({ has_published: true, enabled: true, version: 2 });
    render('/website?publish=1');
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(calls).toEqual(['publish:2:3']));
  });
});
