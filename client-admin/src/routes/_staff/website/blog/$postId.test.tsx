import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server, userEvent } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { mockWebsite } from '../-test-handlers';
import { routeTree } from '../../../../routeTree.gen';

const saved = {
  id: 'p1',
  kind: 'POST',
  slug: 'sports-day',
  title: { bn: 'ক্রীড়া দিবস', en: '' },
  cover_media_id: null,
  body: [{ type: 'paragraph', children: [{ text: 'আজ খেলা' }] }],
  published_at: null as string | null,
  updated_at: '2026-11-01T06:00:00.000Z',
};

const render = (entry: string) =>
  renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: UserRole.ADMIN,
    locale: 'en',
  });

/** Registers the post routes; returns the order write calls arrive in. */
function mockPosts(existing: Partial<typeof saved> = {}, failCreate?: number) {
  const calls: string[] = [];
  server.use(
    http.get('/api/v1/website/posts/p1', () => HttpResponse.json({ ...saved, ...existing })),
    http.post('/api/v1/website/posts', async ({ request }) => {
      const b = (await request.json()) as { title: { bn: string }; kind: string };
      calls.push(`create:${b.kind}:${b.title.bn}`);
      if (failCreate) {
        return HttpResponse.json(
          {
            statusCode: failCreate,
            message: 'site.post_invalid',
            error: 'Bad Request',
            requestId: 'r1',
            path: '/api/v1/website/posts',
            timestamp: '2026-11-07T00:00:00.000Z',
          },
          { status: failCreate },
        );
      }
      return HttpResponse.json({ ...saved, ...existing });
    }),
    http.put('/api/v1/website/posts/p1', async ({ request }) => {
      const b = (await request.json()) as { title: { bn: string } };
      calls.push(`update:${b.title.bn}`);
      return HttpResponse.json({ ...saved, ...existing });
    }),
    http.post('/api/v1/website/posts/:id/:action', ({ params }) => {
      calls.push(String(params.action));
      return HttpResponse.json({ ...saved, ...existing, published_at: '2026-11-02T06:00:00.000Z' });
    }),
    http.delete('/api/v1/website/posts/p1', () => {
      calls.push('delete');
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

describe('/website/blog/$postId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('keeps Save off until the Bangla title is filled, then creates a draft post', async () => {
    mockWebsite();
    const calls = mockPosts();
    render('/website/blog/new');
    const save = (await screen.findByRole('button', { name: 'Save' })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Title \(বাংলা\)/), 'ক্রীড়া দিবস');
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    await waitFor(() => expect(calls).toEqual(['create:POST:ক্রীড়া দিবস']));
  });

  it('publishes by saving first, then calling publish', async () => {
    mockWebsite();
    const calls = mockPosts();
    render('/website/blog/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(calls).toEqual(['update:ক্রীড়া দিবস', 'publish']));
  });

  it('shows Unpublish for a published post, with its public address', async () => {
    mockWebsite();
    const calls = mockPosts({ published_at: '2026-11-02T06:00:00.000Z' });
    render('/website/blog/p1');
    expect(await screen.findByText('https://rumsc.example.test/bn/blog/sports-day')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(calls).toContain('unpublish'));
  });

  it('asks before deleting, and deletes only after the answer is yes', async () => {
    mockWebsite();
    const calls = mockPosts();
    render('/website/blog/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete post' }));
    expect(await screen.findByText('Delete this post?')).toBeTruthy();
    expect(calls).toEqual([]);
    const buttons = screen.getAllByRole('button', { name: 'Delete post' });
    await userEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(calls).toEqual(['delete']));
  });

  it('says so when the server refuses the post', async () => {
    mockWebsite();
    mockPosts({}, 400);
    render('/website/blog/new');
    await userEvent.type(await screen.findByLabelText(/Title \(বাংলা\)/), 'ক');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/title or the text is not valid/);
  });

  const refuse = (status: number, code: string) =>
    HttpResponse.json(
      {
        statusCode: status,
        message: code,
        error: 'x',
        requestId: 'r1',
        path: '/api/v1/website/posts',
        timestamp: '2026-11-07T00:00:00.000Z',
      },
      { status },
    );

  it('creates one post only, even when publish fails and Publish is clicked again', async () => {
    mockWebsite();
    const calls = mockPosts();
    server.use(
      http.post('/api/v1/website/posts/:id/:action', () => {
        calls.push('publish');
        return refuse(500, 'boom');
      }),
    );
    render('/website/blog/new');
    await userEvent.type(await screen.findByLabelText(/Title \(বাংলা\)/), 'ক');
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(calls).toEqual(['create:POST:ক', 'publish']));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(calls).toEqual(['create:POST:ক', 'publish', 'update:ক', 'publish']));
    expect(calls.filter((c) => c.startsWith('create'))).toHaveLength(1);
  });

  it('tells a taken address, a post in use and any other 409 apart', async () => {
    mockWebsite();
    mockPosts();
    server.use(http.post('/api/v1/website/posts', () => refuse(409, 'site.post_slug_taken')));
    render('/website/blog/new');
    await userEvent.type(await screen.findByLabelText(/Title \(বাংলা\)/), 'ক');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/address is already used/);
  });

  it('says a post is in use when delete is refused with post_in_use', async () => {
    mockWebsite();
    mockPosts();
    server.use(http.delete('/api/v1/website/posts/p1', () => refuse(409, 'site.post_in_use')));
    render('/website/blog/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete post' }));
    const buttons = screen.getAllByRole('button', { name: 'Delete post' });
    await userEvent.click(buttons[buttons.length - 1]!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/used on your home page/);
  });

  it('says a post is in use when publish is refused with post_in_use', async () => {
    mockWebsite();
    mockPosts();
    server.use(
      http.post('/api/v1/website/posts/:id/:action', () => refuse(409, 'site.post_in_use')),
    );
    render('/website/blog/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/used on your home page/);
  });

  it('shows the generic message for any other 409', async () => {
    mockWebsite();
    mockPosts();
    server.use(http.put('/api/v1/website/posts/p1', () => refuse(409, 'site.something_else')));
    render('/website/blog/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not do that/);
  });
});
