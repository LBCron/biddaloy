import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  useCustomDomain,
  useRecheckCustomDomain,
  useRemoveCustomDomain,
  useSetCustomDomain,
  useWebsiteAnalytics,
} from './use-website-domain';

const fail = () => HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 });

describe('useCustomDomain', () => {
  it('turns the 409 "unavailable" answer into null', async () => {
    server.use(
      http.get('/api/v1/website/custom-domain', () =>
        HttpResponse.json(
          apiErrorBody(409, 'site.custom_domain_unavailable', '/api/v1/website/custom-domain'),
          { status: 409 },
        ),
      ),
    );
    const { result } = renderHookWithProviders(() => useCustomDomain(), { tenantId: 't1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('returns the status when the school can use a custom domain', async () => {
    server.use(
      http.get('/api/v1/website/custom-domain', () =>
        HttpResponse.json({
          host: 'www.school.edu',
          status: 'PENDING_DNS',
          records: [],
          lastCheckedAt: null,
        }),
      ),
    );
    const { result } = renderHookWithProviders(() => useCustomDomain(), { tenantId: 't1' });
    await waitFor(() => expect(result.current.data?.status).toBe('PENDING_DNS'));
  });
});

describe('useWebsiteAnalytics', () => {
  it('passes `available: false` through as data', async () => {
    server.use(
      http.get('/api/v1/website/analytics', () => HttpResponse.json({ available: false })),
    );
    const { result } = renderHookWithProviders(() => useWebsiteAnalytics(), { tenantId: 't1' });
    await waitFor(() => expect(result.current.data).toEqual({ available: false }));
  });
});

describe('custom domain mutations', () => {
  it('set sends an Idempotency-Key and is not retried', async () => {
    let calls = 0;
    let key: string | null = null;
    server.use(
      http.put('/api/v1/website/custom-domain', ({ request }) => {
        calls += 1;
        key = request.headers.get('Idempotency-Key');
        return fail();
      }),
    );
    const { result } = renderHookWithProviders(() => useSetCustomDomain(), { tenantId: 't1' });
    result.current.mutate({ host: 'www.school.edu' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(key).toBeTruthy();
    expect(calls).toBe(1);
  });

  it('remove: one request on a 500 (retry: false)', async () => {
    let calls = 0;
    server.use(
      http.delete('/api/v1/website/custom-domain', () => {
        calls += 1;
        return fail();
      }),
    );
    const { result } = renderHookWithProviders(() => useRemoveCustomDomain(), { tenantId: 't1' });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });

  it('recheck: one request on a 500 (retry: false)', async () => {
    let calls = 0;
    server.use(
      http.post('/api/v1/website/custom-domain/recheck', () => {
        calls += 1;
        return fail();
      }),
    );
    const { result } = renderHookWithProviders(() => useRecheckCustomDomain(), {
      tenantId: 't1',
    });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });
});
