/**
 * [76.4.01] Attendance devices (`devices.controller.ts`). Create and rotate
 * return the raw key exactly once; the caller must show it then.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type AttendanceDevice = components['schemas']['DeviceResponseDto'];
export type AttendanceDeviceWithKey = components['schemas']['DeviceWithKeyResponseDto'];
export type CreateAttendanceDeviceInput = components['schemas']['CreateDeviceDto'];

export const attendanceDeviceKeys = createEntityKeys('attendance-devices');

export function attendanceDevicesQueryOptions() {
  return queryOptions({
    queryKey: attendanceDeviceKeys.lists(),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<AttendanceDevice[]>('/attendance/devices', { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useAttendanceDevices() {
  return useQuery(attendanceDevicesQueryOptions());
}

function useInvalidateDevices() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: attendanceDeviceKeys.all });
}

export function useCreateAttendanceDevice() {
  const invalidate = useInvalidateDevices();
  return useMutation({
    mutationFn: async (input: CreateAttendanceDeviceInput) => {
      const res = await apiClient.post<AttendanceDeviceWithKey>('/attendance/devices', input);
      return res.data;
    },
    retry: false,
    onSuccess: invalidate,
  });
}

export function useRotateAttendanceDeviceKey(id: string) {
  const invalidate = useInvalidateDevices();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<AttendanceDeviceWithKey>(`/attendance/devices/${id}/rotate`);
      return res.data;
    },
    retry: false,
    onSuccess: invalidate,
  });
}

export function useRevokeAttendanceDevice(id: string) {
  const invalidate = useInvalidateDevices();
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/attendance/devices/${id}`);
    },
    retry: false,
    onSuccess: invalidate,
  });
}
