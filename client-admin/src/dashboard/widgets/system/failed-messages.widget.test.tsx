import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget from './failed-messages.widget';

const URL = '/api/v1/dashboard/widgets/failed-messages';
// The default test school uses Bangla numerals, so counts render in them even in English.
const WINDOW = { from: '2026-10-01', to: '2026-10-07' };

function renderWidget(variant: 'full' | 'compact') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="S" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('failed-messages widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('3 failed → value, sentence, warning badge with text, link', async () => {
    serve({ failed: 3, window: WINDOW });
    renderWidget('full');
    expect(await screen.findByText('3 failed')).toBeTruthy();
    const badge = document.querySelector('[data-slot="status-badge"]')!;
    expect(badge.getAttribute('data-tone')).toBe('warning');
    expect(badge.textContent).toBe('SMS that could not be sent in the last 7 days.');
    expect(screen.getByRole('link', { name: 'See which ones' }).getAttribute('href')).toBe(
      `/communications/message-log?medium=SMS&status=FAILED&from_date=${WINDOW.from}`,
    );
  });

  it('0 failed → none sentence, no badge', async () => {
    serve({ failed: 0, window: WINDOW });
    renderWidget('full');
    expect(await screen.findByText('Nothing failed in the last 7 days.')).toBeTruthy();
    expect(document.querySelector('[data-slot="status-badge"]')).toBeNull();
  });

  it('compact renders the count', async () => {
    serve({ failed: 2, window: WINDOW });
    renderWidget('compact');
    expect(await screen.findByText('2 failed')).toBeTruthy();
  });

  it.each([
    [3, 'Needs action'],
    [0, 'All good'],
  ])('signal at %s failed: %s', async (failed, label) => {
    serve({ failed, window: WINDOW });
    renderWidget('full');
    expect(await screen.findByText(label, { selector: '.sr-only' })).toBeTruthy();
  });
});
