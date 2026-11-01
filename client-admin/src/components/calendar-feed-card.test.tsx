import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../help/test-utils';

import { CalendarFeedCard } from './calendar-feed-card';

const FEED_URL = 'webcal://app.biddaloy.test/api/v1/calendar/feed/tok_abc123';

describe('CalendarFeedCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders nothing for a role without CALENDAR_READ', async () => {
    const { container } = renderWithProviders(<CalendarFeedCard />, {
      locale: 'en',
      role: 'GUARDIAN',
      tenantId: 'tenant-1',
    });

    // Give any (unexpected) async render a tick before asserting empty.
    await Promise.resolve();
    expect(container.innerHTML).toBe('');
  });

  it('shows a masked link and reveals it on demand for a role with CALENDAR_READ', async () => {
    server.use(http.get('/api/v1/calendar/feed', () => HttpResponse.json({ url: FEED_URL })));
    const { user } = renderWithProviders(<CalendarFeedCard />, {
      locale: 'en',
      role: 'TEACHER',
      tenantId: 'tenant-1',
    });

    const input = await screen.findByLabelText<HTMLInputElement>('Your personal subscribe link');
    expect(input).toHaveProperty('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveProperty('type', 'text');
    expect(input.value).toBe(FEED_URL);
  });

  it('draws a (?) beside Regenerate', async () => {
    server.use(http.get('/api/v1/calendar/feed', () => HttpResponse.json({ url: FEED_URL })));
    renderWithProviders(withHelp(<CalendarFeedCard />), {
      locale: 'en',
      role: 'TEACHER',
      tenantId: 'tenant-1',
    });
    await screen.findByLabelText('Your personal subscribe link');
    await expectHelp('people.calendar.action.regenerateFeed');
  });

  it('copies the link to the clipboard', async () => {
    server.use(http.get('/api/v1/calendar/feed', () => HttpResponse.json({ url: FEED_URL })));

    const { user } = renderWithProviders(<CalendarFeedCard />, {
      locale: 'en',
      role: 'PARENT',
      tenantId: 'tenant-1',
    });

    // `user-event`'s own `setup()` (inside `renderWithProviders`) installs
    // its fake `navigator.clipboard` lazily, so the spy has to attach
    // after render, not before — spying on a not-yet-installed clipboard
    // silently misses the real call.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    await screen.findByLabelText('Your personal subscribe link');
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith(FEED_URL);
  });

  it('regenerates the link after confirming, replacing the old value', async () => {
    const newUrl = 'webcal://app.biddaloy.test/api/v1/calendar/feed/tok_new456';
    server.use(
      http.get('/api/v1/calendar/feed', () => HttpResponse.json({ url: FEED_URL })),
      http.post('/api/v1/calendar/feed/regenerate', () => HttpResponse.json({ url: newUrl })),
    );

    const { user } = renderWithProviders(<CalendarFeedCard />, {
      locale: 'en',
      role: 'TEACHER',
      tenantId: 'tenant-1',
    });

    await screen.findByLabelText('Your personal subscribe link');
    await user.click(screen.getByRole('button', { name: 'Regenerate link' }));
    // Asks first: the link only changes once confirmed.
    const confirm = await screen.findByRole('alertdialog');
    expect(screen.getByLabelText<HTMLInputElement>('Your personal subscribe link').value).toBe(
      FEED_URL,
    );
    await user.click(within(confirm).getByRole('button', { name: 'Regenerate' }));

    await waitFor(async () => {
      const input = await screen.findByLabelText<HTMLInputElement>('Your personal subscribe link');
      expect(input.value).toBe(newUrl);
    });
  });

  it('shows a translated alert when regenerate fails', async () => {
    server.use(
      http.get('/api/v1/calendar/feed', () => HttpResponse.json({ url: FEED_URL })),
      http.post('/api/v1/calendar/feed/regenerate', () =>
        HttpResponse.json({ message: 'Something went wrong.' }, { status: 500 }),
      ),
    );

    const { user } = renderWithProviders(<CalendarFeedCard />, {
      locale: 'en',
      role: 'TEACHER',
      tenantId: 'tenant-1',
    });

    await screen.findByLabelText('Your personal subscribe link');
    await user.click(screen.getByRole('button', { name: 'Regenerate link' }));
    await user.click(await screen.findByRole('button', { name: 'Regenerate' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't regenerate the link. Try again.");
  });

  it('shows an error state and lets the user retry when the feed fails to load', async () => {
    server.use(
      http.get('/api/v1/calendar/feed', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    const { user } = renderWithProviders(<CalendarFeedCard />, {
      locale: 'en',
      role: 'TEACHER',
      tenantId: 'tenant-1',
    });

    await screen.findByText("Couldn't load your subscribe link.");

    server.use(http.get('/api/v1/calendar/feed', () => HttpResponse.json({ url: FEED_URL })));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByLabelText('Your personal subscribe link');
  });

  it('does not re-show an earlier regenerate failure after cancelling a later confirm', async () => {
    server.use(
      http.get('/api/v1/calendar/feed', () => HttpResponse.json({ url: FEED_URL })),
      http.post('/api/v1/calendar/feed/regenerate', () =>
        HttpResponse.json({ message: 'x' }, { status: 500 }),
      ),
    );
    const { user } = renderWithProviders(<CalendarFeedCard />, {
      locale: 'en',
      role: 'TEACHER',
      tenantId: 'tenant-1',
    });

    await screen.findByLabelText('Your personal subscribe link');
    await user.click(screen.getByRole('button', { name: 'Regenerate link' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Regenerate' }),
    );
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Regenerate link' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
