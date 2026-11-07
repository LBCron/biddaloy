import { UserRole } from '@biddaloy/shared';
import {
  apiErrorBody,
  cleanupTestState,
  renderWithRouter,
  server,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/website.json';
import { routeTree } from '../../../routeTree.gen';

import { mockWebsite } from './-test-handlers';

const records = [
  { type: 'CNAME', name: 'www.school.edu', value: 'edge.example.test' },
  { type: 'TXT', name: '_verify.school.edu', value: 'token-123' },
];

const status = (over: Record<string, unknown> = {}) => ({
  host: 'www.school.edu',
  status: 'PENDING_DNS',
  records,
  lastCheckedAt: null,
  ...over,
});

function mockDomain(answer: () => Response, calls: string[] = []) {
  server.use(
    http.get('/api/v1/website/custom-domain', answer),
    http.put('/api/v1/website/custom-domain', async ({ request }) => {
      calls.push(`set:${((await request.json()) as { host: string }).host}`);
      return HttpResponse.json(status());
    }),
    http.delete('/api/v1/website/custom-domain', () => {
      calls.push('remove');
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/v1/website/custom-domain/recheck', () => {
      calls.push('recheck');
      return HttpResponse.json(status());
    }),
  );
  return calls;
}

const unavailable = () =>
  HttpResponse.json(
    apiErrorBody(409, 'site.custom_domain_unavailable', '/api/v1/website/custom-domain'),
    { status: 409 },
  );

const render = (locale: 'en' | 'bn' = 'en') =>
  renderWithRouter(routeTree, {
    initialEntries: ['/website/address'],
    tenantId: 'tenant-1',
    role: UserRole.ADMIN,
    locale,
  });

describe('/website/address', () => {
  afterEach(async () => {
    await cleanupTestState();
    vi.restoreAllMocks();
  });

  it('renames only after the live check says the address is free, and after confirming', async () => {
    const calls = mockWebsite({}, ['taken-one']);
    mockDomain(unavailable);
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Change the address' }));
    const field = await screen.findByLabelText('New address');
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save address' });
    expect(save.disabled).toBe(true);

    await userEvent.type(field, 'taken-one');
    expect(await screen.findByText('This address cannot be used. Try another one.')).toBeTruthy();
    expect(save.disabled).toBe(true);

    await userEvent.clear(field);
    await userEvent.type(field, 'new-school');
    expect(await screen.findByText('This address is free.')).toBeTruthy();
    expect(screen.getByText(/keeps working for 30 days/)).toBeTruthy();
    await waitFor(() => expect(save.disabled).toBe(false));
    await userEvent.click(save);
    expect(calls).toEqual([]);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change address' }));
    await waitFor(() => expect(calls).toEqual(['rename:new-school']));
  });

  it('hides the own-address card when the server says it is off', async () => {
    mockWebsite();
    mockDomain(unavailable);
    render();
    await screen.findByRole('button', { name: 'Change the address' });
    await waitFor(() => expect(document.querySelector('.animate-pulse')).toBeNull());
    expect(screen.queryByText('Your own address')).toBeNull();
    // Hidden, not failed: no error message either.
    expect(screen.queryByText('We could not load the address.')).toBeNull();
  });

  it('adds an own address from the empty card', async () => {
    mockWebsite();
    const calls = mockDomain(() =>
      HttpResponse.json(status({ host: null, status: null, records: [] })),
    );
    render();
    await userEvent.type(await screen.findByLabelText('Your address'), 'www.school.edu');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls).toEqual(['set:www.school.edu']));
  });

  it('shows one fixed sentence for a refused address, never the typed value', async () => {
    mockWebsite();
    mockDomain(() => HttpResponse.json(status({ host: null, status: null, records: [] })));
    server.use(http.put('/api/v1/website/custom-domain', () => unavailable()));
    render();
    await userEvent.type(await screen.findByLabelText('Your address'), 'www.bad.edu');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('This address cannot be added. Try another one.')).toBeTruthy();
    expect(screen.queryByText(/www\.bad\.edu\./)).toBeNull();
  });

  it('shows the two lines with copy buttons and the status', async () => {
    mockWebsite();
    mockDomain(() => HttpResponse.json(status()));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render();
    expect(await screen.findByText('Line 1')).toBeTruthy();
    expect(screen.getByText('Line 2')).toBeTruthy();
    expect(screen.getByText('Waiting for the two lines')).toBeTruthy();
    expect(screen.getByText('edge.example.test')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Copy: Value 1' }));
    expect(writeText).toHaveBeenCalledWith('edge.example.test');
  });

  it.each([
    ['PENDING_DNS', 'Waiting for the two lines'],
    ['PENDING_SSL', 'Almost ready'],
    ['ACTIVE', 'Working'],
    ['FAILED', 'Did not work'],
  ])('shows a chip for %s', async (state, label) => {
    mockWebsite();
    mockDomain(() => HttpResponse.json(status({ status: state })));
    render();
    expect(await screen.findByText(label)).toBeTruthy();
  });

  it('disables Check again for a minute after a click', async () => {
    mockWebsite();
    const calls = mockDomain(() => HttpResponse.json(status()));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(calls).toEqual(['recheck']));
    const wait = await screen.findByRole('button', { name: /Check again in \d+ s/ });
    expect((wait as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks before removing the own address', async () => {
    mockWebsite();
    const calls = mockDomain(() => HttpResponse.json(status()));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove this address' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(calls).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls).toEqual(['remove']));
  });

  it('sets the page title in Bangla and keeps jargon out of the Bangla words', async () => {
    mockWebsite();
    mockDomain(() => HttpResponse.json(status()));
    render('bn');
    expect(await screen.findByText('লাইন ১')).toBeTruthy();
    // Words only: the JSON keys (PENDING_DNS) are code, not what the admin reads.
    const words: string[] = [];
    JSON.stringify([bn.address, bn.analytics, bn.help], (_k, v) => {
      if (typeof v === 'string') words.push(v);
      return v;
    });
    expect(words.join(' ')).not.toMatch(/tenant|slug|dns|cname|deploy|ssl|cloudflare/i);
  });
});
