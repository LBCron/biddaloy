import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  attendanceDeviceKeys,
  useAttendanceDevices,
  useCreateAttendanceDevice,
  useRevokeAttendanceDevice,
  useRotateAttendanceDeviceKey,
} from './attendance-devices';

const device = {
  id: 'd1',
  name: 'Gate',
  kind: 'RFID',
  token_last4: 'abcd',
  section_id: null,
  roster_access: false,
  status: 'ACTIVE',
  last_seen_at: null,
};

describe('attendance devices', () => {
  it('create returns the one-time key', async () => {
    server.use(
      http.post('/api/v1/attendance/devices', () =>
        HttpResponse.json({ device, key: 'raw-key' }, { status: 201 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useCreateAttendanceDevice(), {
      tenantId: 't1',
    });
    const res = await result.current.mutateAsync({ name: 'Gate', kind: 'RFID' });
    expect(res.key).toBe('raw-key');
  });

  it('rotate and revoke invalidate the list', async () => {
    server.use(
      http.get('/api/v1/attendance/devices', () => HttpResponse.json([device])),
      http.post('/api/v1/attendance/devices/d1/rotate', () =>
        HttpResponse.json({ device, key: 'k2' }, { status: 201 }),
      ),
      http.delete('/api/v1/attendance/devices/d1', () => new HttpResponse(null, { status: 204 })),
    );
    const queryClient = createTestQueryClient();
    const list = renderHookWithProviders(() => useAttendanceDevices(), {
      tenantId: 't1',
      queryClient,
    });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const rotate = renderHookWithProviders(() => useRotateAttendanceDeviceKey('d1'), {
      tenantId: 't1',
      queryClient,
    });
    await rotate.result.current.mutateAsync();
    await waitFor(() =>
      expect(queryClient.getQueryState(attendanceDeviceKeys.lists())?.dataUpdateCount).toBe(2),
    );
    const revoke = renderHookWithProviders(() => useRevokeAttendanceDevice('d1'), {
      tenantId: 't1',
      queryClient,
    });
    await revoke.result.current.mutateAsync();
    await waitFor(() =>
      expect(queryClient.getQueryState(attendanceDeviceKeys.lists())?.dataUpdateCount).toBe(3),
    );
  });
});
