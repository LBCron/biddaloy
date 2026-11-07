import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { WebsiteProfileTab } from './website-profile-tab';

const person = (n: number, extra: Record<string, unknown> = {}) => ({
  user_id: `u-${n}`,
  full_name: `Person ${n}`,
  role: 'TEACHER',
  show_on_website: true,
  featured: false,
  sort_order: 0,
  subjects: [],
  bio: null,
  credentials: null,
  photo_media_id: null,
  ...extra,
});

function setup(list: unknown[], onPut?: (b: unknown) => void) {
  server.use(
    http.get('/api/v1/website/teachers', () => HttpResponse.json(list)),
    http.put('/api/v1/website/teachers/:id', async ({ request }) => {
      onPut?.(await request.json());
      return HttpResponse.json(person(1));
    }),
  );
  return renderWithProviders(<WebsiteProfileTab userId="u-1" />, {
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'tenant-1',
  });
}

describe('WebsiteProfileTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('says the home page is full and blocks featuring a ninth person', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => person(i + 2, { featured: true }));
    setup([person(1), ...eight]);
    const featured = await screen.findByRole('checkbox', { name: 'Feature on the home page' });
    expect(featured.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/8 people are already on the home page/)).toBeTruthy();
  });

  it('saves the whole card', async () => {
    let sent: unknown;
    setup([person(1)], (b) => (sent = b));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Subjects'), 'Math, Physics');
    await user.click(screen.getByRole('checkbox', { name: 'Feature on the home page' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(sent).toMatchObject({
        show_on_website: true,
        featured: true,
        subjects: ['Math', 'Physics'],
        bio: null,
      }),
    );
  });
});
