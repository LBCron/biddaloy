/**
 * [53.6.01] `/n/$token`: public, no session. No test registers `/auth/refresh`, so a stray auth
 * call fails through msw's `onUnhandledRequest: 'error'`.
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

const NOTICE = {
  schoolName: 'Ananta High School',
  title: 'Exam routine',
  body: 'Line one\n<b>not bold</b>',
  publishedAt: '2026-10-09T05:00:00.000Z',
  editedAt: null,
  files: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      mimeType: 'application/pdf',
      name: 'routine.pdf',
    },
  ],
};

const dead = (status: number) =>
  new HttpResponse(JSON.stringify({ statusCode: status }), { status });

describe('/n/$token public notice page', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the notice as text, links the file, pings opened, sends no tenant header', async () => {
    let tenantHeader: string | null = 'unset';
    let opened = 0;
    server.use(
      http.get('/api/v1/public/notices/:token', ({ request }) => {
        tenantHeader = request.headers.get('x-tenant-id');
        return HttpResponse.json(NOTICE);
      }),
      http.post('/api/v1/public/notices/:token/opened', () => {
        opened += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/n/live-token'],
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Exam routine' })).toBeTruthy();
    expect(screen.getByText('From Ananta High School')).toBeTruthy();
    // Shown as text: the tag characters are visible, no <b> element exists.
    expect(screen.getByText(/<b>not bold<\/b>/)).toBeTruthy();
    expect(document.querySelector('article b')).toBeNull();
    const file = screen.getByRole('link', { name: 'Open routine.pdf' });
    expect(file.getAttribute('href')).toBe(
      '/api/v1/public/notices/live-token/files/55555555-5555-4555-8555-555555555555',
    );
    expect(file.getAttribute('rel')).toContain('noopener');
    await waitFor(() => expect(opened).toBe(1));
    expect(tenantHeader).toBeNull();
    expect(router.state.location.pathname).toBe('/n/live-token');
  });

  it.each([404, 410])(
    'answers a dead link (%i) with one fixed message and never the token',
    async (status) => {
      let calls = 0;
      let opened = 0;
      server.use(
        http.get('/api/v1/public/notices/:token', () => {
          calls += 1;
          return dead(status);
        }),
        http.post('/api/v1/public/notices/:token/opened', () => {
          opened += 1;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      renderWithRouter(routeTree, { initialEntries: ['/n/secret-dead-token'], locale: 'en' });

      expect(await screen.findByText('This notice is not available')).toBeTruthy();
      expect(document.body.textContent).not.toContain('secret-dead-token');
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(calls).toBe(1);
      expect(opened).toBe(0);
    },
  );

  it('offers Try again after a server error, then shows the notice', async () => {
    let calls = 0;
    server.use(
      http.get('/api/v1/public/notices/:token', () => {
        calls += 1;
        return calls === 1 ? dead(500) : HttpResponse.json(NOTICE);
      }),
      http.post(
        '/api/v1/public/notices/:token/opened',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    renderWithRouter(routeTree, { initialEntries: ['/n/flaky-token'], locale: 'en' });

    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.click();
    expect(await screen.findByRole('heading', { level: 1, name: 'Exam routine' })).toBeTruthy();
  });
});
