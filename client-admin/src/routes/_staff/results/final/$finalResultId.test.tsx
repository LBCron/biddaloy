/**
 * [70.5.3] Final result page: tab in the URL, the header action per status, the build / publish
 * / reopen / SMS dialogs (writes never retry), the D18 notes warning, and the glossary check
 * (words the epic bans from the screen).
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

// The route-permission entries for these pages land with the nav/route-map ticket (#3421). Until then
// the closed-by-default gate would refuse them, so the same two entries are added here.
vi.mock('../../../../route-permissions', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../../route-permissions')>();
  const { Permission } = await import('@biddaloy/shared');
  return {
    ...mod,
    STAFF_ROUTE_PERMISSIONS: {
      ...mod.STAFF_ROUTE_PERMISSIONS,
      '/_staff/results/final/': Permission.RESULT_PROCESS,
      '/_staff/results/final/$finalResultId': Permission.RESULT_PROCESS,
    },
  };
});

import { mockFinal, type Status } from './-test-fixtures';

const render = (entry = '/results/final/fr-1') =>
  renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });

async function open(status: Status, entry?: string) {
  mockFinal(status);
  render(entry);
  await screen.findByRole('tab', { name: 'Setup' });
}

describe('/results/final/$finalResultId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('keeps the tab in the URL and falls back to Setup', async () => {
    await open('PROCESSED', '/results/final/fr-1?tab=results');
    expect(screen.getByRole('tab', { name: 'Results' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(screen.getByRole('tab', { name: 'Print' }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Print' }).getAttribute('aria-selected')).toBe('true'),
    );
  });

  it('opens on Setup with an unknown tab', async () => {
    await open('DRAFT', '/results/final/fr-1?tab=nope');
    expect(screen.getByRole('tab', { name: 'Setup' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows the next step for each status', async () => {
    await open('DRAFT');
    expect(screen.getAllByRole('button', { name: 'Build results' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('builds once; a failed build is not retried and says what happened', async () => {
    let calls = 0;
    mockFinal('DRAFT');
    server.use(
      http.post('/api/v1/final-results/fr-1/build', () => {
        calls += 1;
        return HttpResponse.json({ message: 'boom' }, { status: 500 });
      }),
    );
    render();
    await screen.findByRole('tab', { name: 'Setup' });
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Build results' })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Build results' }));
    await within(dialog).findByText("Couldn't build the final results.");
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(1);
  });

  it('warns about missing remarks and conduct before publishing, and never blocks', async () => {
    let published = 0;
    mockFinal('PROCESSED');
    server.use(
      http.post('/api/v1/final-results/fr-1/publish', () => {
        published += 1;
        return new HttpResponse(null, { status: 201 });
      }),
    );
    render();
    await screen.findByRole('tab', { name: 'Setup' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Publish' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    const warning = await within(dialog).findByTestId('missing-notes');
    // Digits follow the school's region setting, so accept Latin or Bangla numerals.
    expect(warning.textContent).toMatch(/[3৩] students have no remark and [5৫] have no conduct/);
    const link = within(warning).getByRole('link', { name: 'Go to section' });
    expect(link.getAttribute('href')).toBe('/my-class/sec-a/notes?for=fr-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(published).toBe(1));
  });

  it('reopens a published result', async () => {
    let reopened = 0;
    mockFinal('PUBLISHED');
    server.use(
      http.post('/api/v1/final-results/fr-1/reopen', () => {
        reopened += 1;
        return new HttpResponse(null, { status: 201 });
      }),
    );
    render();
    await screen.findByRole('tab', { name: 'Setup' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Reopen' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(reopened).toBe(1));
  });

  it('sends the SMS once, with an Idempotency-Key', async () => {
    const keys: Array<string | null> = [];
    mockFinal('PUBLISHED');
    server.use(
      http.post('/api/v1/final-results/fr-1/sms', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json({ queued: 12, skipped: [] });
      }),
    );
    render();
    await screen.findByRole('tab', { name: 'Setup' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Send SMS' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Send' });
    await userEvent.click(send);
    await within(dialog).findByText(/Sent to 12 guardians/);
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBeTruthy();
  });

  it('shows the D18 numbers on the Results tab and the roll, name and exam columns', async () => {
    await open('PROCESSED', '/results/final/fr-1?tab=results');
    const warning = await screen.findByTestId('missing-notes');
    expect(warning.textContent).toMatch(/[3৩] students have no remark/);
    await screen.findByText('Rima Akter');
    expect(screen.getAllByText('Half Yearly').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Absent').length).toBeGreaterThan(0);
  });

  it('never shows the words the glossary bans', async () => {
    await open('PROCESSED', '/results/final/fr-1?tab=setup');
    const main = document.querySelector('main') as HTMLElement;
    await within(main).findByText('Which exams count');
    await userEvent.click(within(main).getByText('More rules'));
    const banned = /composition|weight|override|snapshot|best-of|\bprocess(ed)?\b/i;
    expect(main.textContent ?? '').not.toMatch(banned);
  });
});
