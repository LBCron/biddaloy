import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { mockWebsite } from './-test-handlers';

const answer = (body: Record<string, unknown>) =>
  server.use(http.get('/api/v1/website/analytics', () => HttpResponse.json(body)));

const render = () =>
  renderWithRouter(routeTree, {
    initialEntries: ['/website/analytics'],
    tenantId: 'tenant-1',
    role: UserRole.ADMIN,
    locale: 'en',
  });

describe('/website/analytics', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the two numbers for the last 30 days', async () => {
    mockWebsite();
    answer({ available: true, visitors: 1234, pageviews: 5678 });
    render();
    expect(await screen.findByText('1,234')).toBeTruthy();
    expect(screen.getByText('5,678')).toBeTruthy();
    expect(screen.getByText(/Last 30 days/)).toBeTruthy();
  });

  it('says so when nobody has visited yet', async () => {
    mockWebsite();
    answer({ available: true, visitors: 0, pageviews: 0 });
    render();
    expect(await screen.findByText('No visitors yet.')).toBeTruthy();
  });

  it('says the numbers are not available when analytics is off or down', async () => {
    mockWebsite();
    answer({ available: false });
    render();
    expect(await screen.findByText('Visitor numbers are not available')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });
});
