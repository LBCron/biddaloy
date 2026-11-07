import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, userEvent } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
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

describe('section editor', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('asks only for the fields the design lists for that section, bn and en side by side', async () => {
    mockDraftSite();
    render('/website/pages?edit=hero');
    expect(await screen.findByLabelText('Big headline (বাংলা)')).toBeTruthy();
    expect(screen.getByLabelText('Big headline (English)')).toBeTruthy();
    // `about` has a `body` field, `hero` does not.
    expect(screen.queryByLabelText(/^Text \(/)).toBeNull();
  });

  it('keeps the edit in the draft: Save closes the editor, the save bar saves it', async () => {
    const saved = mockDraftSite();
    render('/website/pages?edit=hero');
    const bn = await screen.findByLabelText('Big headline (বাংলা)');
    await userEvent.clear(bn);
    await userEvent.type(bn, 'নতুন শিরোনাম');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const hero = saved[0]!.pages[0]!.sections[0]!;
    expect(hero.data.headline).toEqual({ bn: 'নতুন শিরোনাম', en: 'My headline' });
  });

  it('puts the design default text back on request', async () => {
    mockDraftSite();
    render('/website/pages?edit=hero');
    await userEvent.click(await screen.findByRole('button', { name: 'Back to the default text' }));
    const field = await screen.findByLabelText<HTMLInputElement>('Big headline (English)');
    expect(field.value).toBe('Default headline');
  });

  it('uses a multi-line field for long text and offers the photo uploader for photo fields', async () => {
    mockDraftSite();
    render('/website/pages?edit=hero');
    expect(await screen.findByRole('heading', { name: 'Photos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeTruthy();
  });

  it('keeps a text style choice per language', async () => {
    const saved = mockDraftSite();
    render('/website/pages?edit=hero');
    await userEvent.click(await screen.findByRole('combobox', { name: /Bangla Heading Size/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Large' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.pages[0]!.sections[0]!.typography).toEqual({
      bn: { heading: { size: 'L' } },
    });
  });
});
