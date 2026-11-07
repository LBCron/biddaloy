import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  usePublishExamWebsite,
  useSetExamWebsiteNames,
  useUnpublishExamWebsite,
} from './use-exam-website';

const fail = () => HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 });
const EXAM = 'e1';

describe('exam website mutations', () => {
  it.each([
    ['publish', () => usePublishExamWebsite(EXAM), 'website-publish'],
    ['unpublish', () => useUnpublishExamWebsite(EXAM), 'website-unpublish'],
  ] as const)('%s sends an Idempotency-Key and is not retried', async (_n, hook, path) => {
    let calls = 0;
    let key: string | null = null;
    server.use(
      http.post(`/api/v1/exams/${EXAM}/${path}`, ({ request }) => {
        calls += 1;
        key = request.headers.get('Idempotency-Key');
        return fail();
      }),
    );
    const { result } = renderHookWithProviders(hook, { tenantId: 't1' });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(key).toBeTruthy();
    expect(calls).toBe(1);
  });

  it('names: sends the switch value, one request on a 500', async () => {
    let calls = 0;
    let body: unknown;
    server.use(
      http.patch(`/api/v1/exams/${EXAM}/website-names`, async ({ request }) => {
        calls += 1;
        body = await request.json();
        return fail();
      }),
    );
    const { result } = renderHookWithProviders(() => useSetExamWebsiteNames(EXAM), {
      tenantId: 't1',
    });
    result.current.mutate({ showNames: false });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(body).toEqual({ showNames: false });
    expect(calls).toBe(1);
  });
});
