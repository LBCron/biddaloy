import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server, userEvent } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { mockWebsite } from '../-test-handlers';
import { routeTree } from '../../../../routeTree.gen';

const post = (over: Record<string, unknown>) => ({
  id: 'p1',
  kind: 'POST',
  slug: 'sports-day',
  title: { bn: 'ক্রীড়া দিবস', en: '' },
  cover_media_id: null,
  body: [],
  published_at: null,
  updated_at: '2026-11-01T06:00:00.000Z',
  ...over,
});

const render = (role: UserRole = UserRole.ADMIN) =>
  renderWithRouter(routeTree, {
    initialEntries: ['/website/blog'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

describe('/website/blog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists posts with their status and leaves pages out', async () => {
    mockWebsite();
    server.use(
      http.get('/api/v1/website/posts', () =>
        HttpResponse.json({
          items: [
            post({}),
            post({
              id: 'p2',
              title: { bn: 'ভর্তি', en: '' },
              published_at: '2026-11-02T06:00:00.000Z',
            }),
            post({ id: 'p3', kind: 'PAGE', title: { bn: 'আমাদের কথা', en: '' } }),
          ],
          total: 3,
        }),
      ),
    );
    render();
    expect(await screen.findByText('ক্রীড়া দিবস')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.queryByText('আমাদের কথা')).toBeNull();
    // The layout's DetailShell owns the one H1.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows the empty state, and New post opens the editor', async () => {
    mockWebsite();
    server.use(http.get('/api/v1/website/posts', () => HttpResponse.json({ items: [], total: 0 })));
    const { router } = render();
    expect(await screen.findByText('Write your first post')).toBeTruthy();
    await userEvent.click(screen.getAllByText('New post')[0]!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/website/blog/new'));
  });

  it('is refused to a role without WEBSITE_MANAGE', async () => {
    mockWebsite();
    render(UserRole.TEACHER);
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
  });
});
