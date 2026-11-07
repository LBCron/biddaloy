import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget from './sms-balance.widget';

const URL = '/api/v1/dashboard/widgets/sms-balance';
// The default test school uses Bangla numerals, so counts render in them even in English.

function renderWidget(variant: 'full' | 'compact', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="S" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'ADMIN',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('sms-balance widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('full: count, reserved sentence, link', async () => {
    serve({ metering: 'PLATFORM', available: 1240, reserved: 60 });
    renderWidget('full');
    expect(await screen.findByText('1,240 SMS left')).toBeTruthy();
    expect(screen.getByText('60 held for messages being sent')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View sent messages' }).getAttribute('href')).toBe(
      '/communications/message-log?medium=SMS',
    );
  });

  it('bn digits', async () => {
    serve({ metering: 'PLATFORM', available: 1240, reserved: 0 });
    renderWidget('full', 'bn');
    expect(await screen.findByText('১,২৪০টা SMS বাকি')).toBeTruthy();
  });

  it('reserved sentence hidden when 0', async () => {
    serve({ metering: 'PLATFORM', available: 10, reserved: 0 });
    renderWidget('full');
    await screen.findByText('10 SMS left');
    expect(screen.queryByText(/held for messages/)).toBeNull();
  });

  it('metering OFF → not metered, no number', async () => {
    serve({ metering: 'OFF', available: 0, reserved: 0 });
    renderWidget('full');
    expect(await screen.findByText('SMS is not metered for this school.')).toBeTruthy();
    expect(screen.queryByText(/SMS left/)).toBeNull();
  });

  it('compact renders the count', async () => {
    serve({ metering: 'PLATFORM', available: 5, reserved: 0 });
    renderWidget('compact');
    expect(await screen.findByText('5 SMS left')).toBeTruthy();
  });

  it('error: Retry fires a second request', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json(
          { statusCode: 404, message: 'x', timestamp: '', path: '', requestId: '' },
          { status: 404 },
        );
      }),
    );
    renderWidget('full');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it.each([
    [0, 'Needs action'],
    [150, 'Running low'],
  ])('signal at %s credits: %s', async (available, label) => {
    serve({ metering: 'PLATFORM', available, reserved: 0 });
    renderWidget('full');
    expect(await screen.findByText(label, { selector: '.sr-only' })).toBeTruthy();
  });

  it('never says "All good": the school may set its low mark above 200 (no threshold in the DTO)', async () => {
    serve({ metering: 'PLATFORM', available: 1240, reserved: 0 });
    renderWidget('full');
    await screen.findByText('1,240 SMS left');
    expect(document.querySelector('[data-signal]')).toBeNull();
    expect(screen.queryByText('All good')).toBeNull();
  });

  it('shows no signal when not metered', async () => {
    serve({ metering: 'OFF', available: 0, reserved: 0 });
    renderWidget('full');
    await screen.findByText(/not metered/i);
    expect(document.querySelector('.sr-only')).toBeNull();
  });
});
