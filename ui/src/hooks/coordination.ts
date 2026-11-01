/** [83.3.4] `/coordination/*` — Academics › My coordination (Epic 83 D9, D22–D25). */
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type CoordinationOverview = components['schemas']['CoordinationOverviewDto'];
export type CoordinationClass = components['schemas']['CoordinationClassDto'];
export type CoordinationSection = components['schemas']['CoordinationSectionDto'];
export type CoordinationPendingGrid = components['schemas']['CoordinationPendingGridDto'];
export type CoordinationTeacher = components['schemas']['CoordinationTeacherDto'];
export type NotifyCoordinatedTeachersInput = components['schemas']['NotifyCoordinatedTeachersDto'];
export type NotifyCoordinatedTeachersResult =
  components['schemas']['NotifyCoordinatedTeachersResultDto'];

export const coordinationKeys = createEntityKeys('coordination');

/** `date` omitted = the school's today (the server decides). */
export function coordinationOverviewQueryOptions(date?: string) {
  return queryOptions({
    queryKey: coordinationKeys.detail(date ?? 'today'),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<CoordinationOverview>('/coordination/overview', {
        params: date ? { date } : {},
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useCoordinationOverview(date?: string) {
  return useQuery(coordinationOverviewQueryOptions(date));
}

/** `POST /coordination/alerts` — one REMINDER to the checked teachers. Nothing to invalidate:
 * the overview does not show sent reminders. */
export function useNotifyCoordinatedTeachers() {
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: NotifyCoordinatedTeachersInput) => {
      const res = await apiClient.post<NotifyCoordinatedTeachersResult>(
        '/coordination/alerts',
        input,
        { headers: { 'Idempotency-Key': keyFor(input) } },
      );
      return res.data;
    },
    onSuccess: () => rotate(),
    retry: false,
  });
}
