import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const S1 = {
  section_id: 'section-1',
  section_name: 'A',
  class_id: 'class-7',
  class_name: 'Class 7',
  assignment_type: 'CLASS_TEACHER',
};
const S2 = {
  section_id: 'section-2',
  section_name: 'B',
  class_id: 'class-6',
  class_name: 'Class 6',
  assignment_type: 'ASSISTANT_CLASS_TEACHER',
};

function mockSections(rows: unknown[]) {
  server.use(http.get('/api/v1/my-class/sections', () => HttpResponse.json(rows)));
}

function render(entry: string) {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

describe('/my-class', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the empty state when the teacher has no homeroom section', async () => {
    mockSections([]);
    render('/my-class');
    expect(await screen.findByText('No section yet')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'My class' })).toBeTruthy();
    expect(
      screen.getByText('You are not a class teacher of any section yet — ask an admin.'),
    ).toBeTruthy();
  });

  it('badges the waiting arrival requests on a section card, none for zero [84.3.2]', async () => {
    mockSections([
      { ...S1, arrival_request_count: 3 },
      { ...S2, arrival_request_count: 0 },
    ]);
    render('/my-class');
    expect(await screen.findByText(/^Arrival requests \((3|৩)\)$/)).toBeTruthy();
    expect(screen.getAllByText(/^Arrival requests/)).toHaveLength(1);
  });

  it('keeps ?then=arrival on the picker links, so the palette path lands on the card', async () => {
    mockSections([S1, S2]);
    render('/my-class?then=arrival');
    const link = await screen.findByRole('link', { name: /Class 7 – A/ });
    expect(link.getAttribute('href')).toBe('/my-class/section-1?then=arrival');
  });

  it('redirects to the section page when there is exactly one section', async () => {
    mockSections([S1]);
    const { router } = render('/my-class');
    await waitFor(() => expect(router.state.location.pathname).toBe('/my-class/section-1'));
  });

  it('redirects to the attendance register with ?then=attendance', async () => {
    mockSections([S1]);
    const { router } = render('/my-class?then=attendance');
    await waitFor(() => expect(router.state.location.pathname).toBe('/attendance/section-1'));
  });

  it('[70.5.5] redirects to the remarks grid with ?then=notes', async () => {
    mockSections([S1]);
    const { router } = render('/my-class?then=notes');
    await waitFor(() => expect(router.state.location.pathname).toBe('/my-class/section-1/notes'));
  });

  it('[70.5.5] points the picker links at the remarks grid with ?then=notes', async () => {
    mockSections([S1, S2]);
    render('/my-class?then=notes');
    const link = await screen.findByRole('link', { name: /Class 7 – A/ });
    expect(link.getAttribute('href')).toBe('/my-class/section-1/notes');
  });

  it('lists two sections as link cards with the role as plain text', async () => {
    mockSections([S1, S2]);
    render('/my-class');
    const first = await screen.findByRole('link', { name: /^Class 7 – A\s*Class teacher$/ });
    const second = screen.getByRole('link', {
      name: /^Class 6 – B\s*Assistant class teacher$/,
    });
    expect(first.getAttribute('href')).toBe('/my-class/section-1');
    expect(second.getAttribute('href')).toBe('/my-class/section-2');
    expect(screen.getByRole('heading', { level: 1, name: 'My class' })).toBeTruthy();
    expect(screen.getByText('Pick a section to open.')).toBeTruthy();
  });

  it('offers a retry when the sections request fails, and retrying refetches', async () => {
    let calls = 0;
    server.use(
      http.get('/api/v1/my-class/sections', () => {
        calls += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    render('/my-class');
    // 5xx is retried twice with backoff (~3s) before the error state shows;
    // the global 15s asyncUtilTimeout covers that plus a cold route import.
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('heading', { level: 1, name: 'My class' })).toBeTruthy();
    expect(screen.getByText('Could not load your sections.')).toBeTruthy();
    const before = calls;
    fireEvent.click(retry);
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  }, 25_000);
});
