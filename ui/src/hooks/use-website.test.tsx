import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  usePublishWebsite,
  useRenameSubdomain,
  useSaveDraft,
  useSetWebsiteEnabled,
  useSubdomainCheck,
  useUploadSiteMedia,
} from './use-website';

const fail = () => HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 });

describe('website mutations', () => {
  it('publish sends an Idempotency-Key and is not retried', async () => {
    let calls = 0;
    let key: string | null = null;
    server.use(
      http.post('/api/v1/website/publish', ({ request }) => {
        calls += 1;
        key = request.headers.get('Idempotency-Key');
        return fail();
      }),
    );
    const { result } = renderHookWithProviders(() => usePublishWebsite(), { tenantId: 't1' });
    result.current.mutate({ version: 1, draft_revision: 1 });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(key).toBeTruthy();
    expect(calls).toBe(1);
  });

  it('media upload sends an Idempotency-Key and is not retried', async () => {
    let calls = 0;
    let key: string | null = null;
    server.use(
      http.post('/api/v1/website/media', ({ request }) => {
        calls += 1;
        key = request.headers.get('Idempotency-Key');
        return fail();
      }),
    );
    const { result } = renderHookWithProviders(() => useUploadSiteMedia('hero' as never), {
      tenantId: 't1',
    });
    result.current.mutate(new Blob(['x'], { type: 'image/webp' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(key).toBeTruthy();
    expect(calls).toBe(1);
  });

  it.each([
    ['put', '/api/v1/website/draft', () => useSaveDraft(), { config: {}, draft_revision: 1 }],
    ['post', '/api/v1/website/enabled', () => useSetWebsiteEnabled(), true],
    ['put', '/api/v1/website/subdomain', () => useRenameSubdomain(), 'my-school'],
  ] as const)('%s %s: one request on a 500 (retry: false)', async (method, path, hook, input) => {
    let calls = 0;
    server.use(
      http[method](path, () => {
        calls += 1;
        return fail();
      }),
    );
    const { result } = renderHookWithProviders(
      hook as () => { mutate: (v: never) => void; isError: boolean },
      { tenantId: 't1' },
    );
    result.current.mutate(input as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });
});

describe('useSubdomainCheck', () => {
  it('skips under 3 characters', async () => {
    let calls = 0;
    server.use(
      http.get('/api/v1/website/subdomain/check', () => {
        calls += 1;
        return HttpResponse.json({ available: true });
      }),
    );
    const { result } = renderHookWithProviders(() => useSubdomainCheck('ab'), { tenantId: 't1' });
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toBe(0);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('waits 300 ms of quiet, then sends only the last value', async () => {
    const values: string[] = [];
    server.use(
      http.get('/api/v1/website/subdomain/check', ({ request }) => {
        values.push(new URL(request.url).searchParams.get('value') ?? '');
        return HttpResponse.json({ available: true });
      }),
    );
    let input = 'ab';
    const { rerender, result } = renderHookWithProviders(() => useSubdomainCheck(input), {
      tenantId: 't1',
    });
    input = 'abc';
    rerender();
    await new Promise((r) => setTimeout(r, 100));
    expect(values).toEqual([]);
    input = 'abcd';
    rerender();
    await waitFor(() => expect(result.current.data?.available).toBe(true), { timeout: 2000 });
    expect(values).toEqual(['abcd']);
  });
});
