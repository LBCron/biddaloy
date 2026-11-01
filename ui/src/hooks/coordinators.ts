/** [83.2.5] `/coordinators` — admin assign / list / remove of class and subject coordinators
 * (Epic 83 D21). Writes never retry; the assign carries an `Idempotency-Key` (Rule 25). */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { coordinationKeys } from './coordination';
import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type CoordinatorAssignment = components['schemas']['CoordinatorAssignmentDto'];
export type AssignCoordinatorsInput = components['schemas']['AssignCoordinatorsDto'];
export type CoordinatorsFilter = {
  teacherId?: string;
  classId?: string;
};

export const coordinatorKeys = createEntityKeys('coordinators');

export function coordinatorsQueryOptions(filter: CoordinatorsFilter = {}) {
  return queryOptions({
    queryKey: coordinatorKeys.list(filter),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<CoordinatorAssignment[]>('/coordinators', {
        params: filter,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useCoordinators(
  filter: CoordinatorsFilter = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({ ...coordinatorsQueryOptions(filter), enabled: options.enabled ?? true });
}

function useInvalidateCoordinators() {
  const qc = useQueryClient();
  return () => {
    // The coordinator's own My coordination page reads the same rows.
    void qc.invalidateQueries({ queryKey: coordinationKeys.all });
    return qc.invalidateQueries({ queryKey: coordinatorKeys.all });
  };
}

/** `POST /coordinators` — one teacher, several classes, optional subject. Returns the rows. */
export function useAssignCoordinators() {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateCoordinators();
  return useMutation({
    mutationFn: async (input: AssignCoordinatorsInput) => {
      const res = await apiClient.post<CoordinatorAssignment[]>('/coordinators', input, {
        headers: { 'Idempotency-Key': keyFor(input) },
      });
      return res.data;
    },
    onSuccess: () => {
      rotate();
      return invalidate();
    },
    retry: false,
  });
}

/** `DELETE /coordinators/:id` — unbound (the id is the mutate argument), like unassign. */
export function useRemoveCoordinator() {
  const invalidate = useInvalidateCoordinators();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/coordinators/${id}`);
    },
    onSuccess: () => invalidate(),
    retry: false,
  });
}
