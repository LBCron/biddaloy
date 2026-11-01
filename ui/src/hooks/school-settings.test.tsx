import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  schoolSettingsKeys,
  schoolSettingsQueryOptions,
  useMessagingProviders,
  useSchoolSettings,
  useSendTestMessage,
  useTestSchoolConnection,
} from './school-settings';

describe('schoolSettingsQueryOptions', () => {
  // [8.14.5]: `useSchoolSettings` is now a one-line wrapper around this
  // factory, extracted for symmetry with `invoiceQueryOptions` even
  // though no route `loader` calls it directly today (see the factory's
  // own comment for why: `schoolId` isn't a route param). Pinning the
  // `queryKey` and `enabled` shape here proves the extraction changed
  // nothing about what `useSchoolSettings` does.
  it('uses schoolSettingsKeys.detail(schoolId) as its queryKey', () => {
    expect(schoolSettingsQueryOptions('school-1').queryKey).toEqual(
      schoolSettingsKeys.detail('school-1'),
    );
  });

  it('disables the query for an empty schoolId, same guard useSchoolSettings had before extraction', () => {
    expect(schoolSettingsQueryOptions('').enabled).toBe(false);
    expect(schoolSettingsQueryOptions('school-1').enabled).toBe(true);
  });
});

describe('useSchoolSettings', () => {
  it('resolves the settings the handler returns for the given school', async () => {
    server.use(
      http.get('/api/v1/schools/:schoolId/settings', () =>
        HttpResponse.json({ region: { timezone: 'Asia/Dhaka' } }),
      ),
    );

    const { result } = renderHookWithProviders(() => useSchoolSettings('school-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.region?.timezone).toBe('Asia/Dhaka');
  });

  it('does not fire a request for an empty schoolId', () => {
    let requested = false;
    server.use(
      http.get('/api/v1/schools/:schoolId/settings', () => {
        requested = true;
        return HttpResponse.json({});
      }),
    );

    const { result } = renderHookWithProviders(() => useSchoolSettings(''), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(requested).toBe(false);
  });
});

describe('useMessagingProviders', () => {
  it('reads the per-medium company schema for the school', async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings/messaging/providers', ({ params }) =>
        HttpResponse.json({ SMS: { providers: [], configured: true, selected: params.id } }),
      ),
    );
    const { result } = renderHookWithProviders(() => useMessagingProviders('school-1'), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.data?.SMS?.selected).toBe('school-1'));
  });
});

describe('useTestSchoolConnection', () => {
  it('sends no Idempotency-Key and opts out of the unknown-outcome toast (it sends nothing)', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('/api/v1/schools/:id/settings/test', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json({ success: true, message: 'ok' });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(
      () => useTestSchoolConnection('school-1'),
      { tenantId: 'tenant-1' },
    );
    await result.current.mutateAsync({ medium: 'SMS' });
    expect(keys).toEqual([null]);
    expect(queryClient.getMutationCache().getAll()[0]?.meta).toEqual({
      handlesUnknownOutcome: true,
    });
  });
});

// PR #3325 review round 2, findings 4 and 5: a real send has its own hook, with one key per attempt.
describe('useSendTestMessage', () => {
  const input = { medium: 'SMS' as const, sendTo: '01712345678' };

  it('reuses the key after a failed attempt and rotates it after a reply', async () => {
    const keys: (string | null)[] = [];
    let fail = true;
    server.use(
      http.post('/api/v1/schools/:id/settings/test', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        if (fail) return HttpResponse.json({ message: 'Server error' }, { status: 500 });
        return HttpResponse.json({ success: true, message: 'ok' });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useSendTestMessage('school-1'), {
      tenantId: 'tenant-1',
    });

    await result.current.mutateAsync(input).catch(() => undefined);
    fail = false;
    // The retry after a lost or failed reply is the same attempt: same key, so the server replays.
    await result.current.mutateAsync(input);
    // After a reply, a deliberate second test is a new send.
    await result.current.mutateAsync(input);

    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBeTruthy();
    expect(keys[2]).not.toBe(keys[1]);
    // A real send keeps the app's "could not confirm" toast (round-1 finding 6).
    expect(queryClient.getMutationCache().getAll()[0]?.meta).toBeUndefined();
  });
});
