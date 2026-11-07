/** [13.5.1] Setup checklist: rows per item state, hidden when done / dismissed, Hide persists. */
import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { SetupChecklistCard } from './setup-checklist-card';

const ids = [
  'profile',
  'structure',
  'sections',
  'students',
  'staff',
  'feeStructures',
  'guardianInvites',
  'messageSettings',
] as const;

function mockStatus(doneIds: string[], over: object = {}) {
  server.use(
    http.get('/api/v1/onboarding/status', () =>
      HttpResponse.json({
        finished_at: null,
        dismissed_at: null,
        seen: true,
        setup_path: null,
        items: ids.map((id) => ({ id, done: doneIds.includes(id) })),
        counts: { classes: 0, sections: 0, students: 0, staff: 0 },
        trial: null,
        support_url: null,
        ...over,
      }),
    ),
  );
}

function renderCard(role = 'ADMIN') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: SetupChecklistCard,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale: 'en',
    role,
    tenantId: 'school-1',
    accessToken: 'a.b.c',
  });
}

afterEach(cleanupTestState);

describe('SetupChecklistCard', () => {
  it('lists every item, linked to its page, with progress', async () => {
    mockStatus(['profile', 'structure']);
    renderCard();
    expect(await screen.findByText('2 of 8 done')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.getByRole('link', { name: /Students/ }).getAttribute('href')).toBe('/students');
    expect(screen.getAllByText('Done')).toHaveLength(2);
  });

  it('shows the website row, linked to /website, only when the server lists it', async () => {
    mockStatus([], {
      items: [
        { id: 'profile', done: true },
        { id: 'website', done: false },
      ],
    });
    renderCard();
    const link = await screen.findByRole('link', { name: /Set up the website/ });
    expect(link.getAttribute('href')).toBe('/website');
    expect(screen.getByText('1 of 2 done')).toBeTruthy();
  });

  it('is hidden when everything is done, dismissed, or for a TEACHER', async () => {
    mockStatus([...ids]);
    const a = renderCard();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Finish setting up your school')).toBeNull();
    a.unmount();
    mockStatus([], { dismissed_at: '2026-01-01' });
    const b = renderCard();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Finish setting up your school')).toBeNull();
    b.unmount();
    mockStatus([]);
    renderCard('TEACHER');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Finish setting up your school')).toBeNull();
  });

  it('Hide sends dismissed: true', async () => {
    mockStatus([]);
    let body: unknown;
    server.use(
      http.patch('/api/v1/onboarding', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(body).toEqual({ dismissed: true }));
  });
});
