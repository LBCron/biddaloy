import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, userEvent } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { mockWebsite } from './-test-handlers';

const render = () =>
  renderWithRouter(routeTree, {
    initialEntries: ['/website?step=address'],
    tenantId: 'tenant-1',
    role: UserRole.ADMIN,
    locale: 'en',
  });

const next = () => screen.getByRole('button', { name: 'Next' });

describe('website first-run wizard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('blocks Next on a taken address, and a suggestion chip fills the field', async () => {
    mockWebsite({}, ['taken-name']);
    render();
    const field = await screen.findByLabelText('Your web address');
    await userEvent.clear(field);
    await userEvent.type(field, 'taken-name');
    expect(await screen.findByText('This address is already used. Try another one.')).toBeTruthy();
    expect((next() as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(await screen.findByRole('button', { name: 'gvs' }));
    expect((field as HTMLInputElement).value).toBe('gvs');
    expect(await screen.findByText('This address is free.')).toBeTruthy();
    await waitFor(() => expect((next() as HTMLButtonElement).disabled).toBe(false));
  });

  it('refuses a malformed address without asking the server', async () => {
    mockWebsite();
    render();
    const field = await screen.findByLabelText('Your web address');
    await userEvent.clear(field);
    await userEvent.type(field, '-bad-');
    expect(screen.getByText(/Use 3 to 30 letters/)).toBeTruthy();
    expect((next() as HTMLButtonElement).disabled).toBe(true);
  });

  it('preselects Basic, and Escape on step 2 keeps the step-1 answer', async () => {
    mockWebsite();
    render();
    const field = await screen.findByLabelText('Your web address');
    await userEvent.clear(field);
    await userEvent.type(field, 'gvs');
    await waitFor(() => expect((next() as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(next());

    const basic = await screen.findByRole('button', { name: /Basic/ });
    expect(basic.getAttribute('aria-pressed')).toBe('true');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /Basic/ })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText('Your web address') as HTMLInputElement).value).toBe('gvs');
  });

  it('finishes with rename, save, publish, then switch on, in that order', async () => {
    const calls = mockWebsite();
    const { router } = render();
    const field = await screen.findByLabelText('Your web address');
    await userEvent.clear(field);
    await userEvent.type(field, 'gvs');
    await waitFor(() => expect((next() as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole('radio', { name: /Blue/ }));
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole('button', { name: 'Publish and turn on' }));

    await waitFor(() =>
      expect(calls).toEqual(['rename:gvs', 'save:blue', 'publish:1:4', 'enabled:true']),
    );
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('step'));
  });

  it('keeps the current address without renaming when it is not changed', async () => {
    const calls = mockWebsite();
    render();
    await screen.findByLabelText('Your web address');
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole('button', { name: /Basic/ }));
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole('button', { name: 'Publish and turn on' }));
    await waitFor(() => expect(calls).toEqual(['save:green', 'publish:1:4', 'enabled:true']));
  });
});
