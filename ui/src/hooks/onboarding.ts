import type { OnboardingStatus } from '@biddaloy/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { shouldRetryQuery } from './retry';

export type UpdateOnboardingInput = components['schemas']['UpdateOnboardingDto'];

export const onboardingKeys = { status: ['onboarding', 'status'] as const };

/** `GET /onboarding/status` — the response is untyped in `schema.d.ts`, so it
 * is typed from `@biddaloy/shared`'s `OnboardingStatus` (the server's own type). */
export function onboardingStatusQueryOptions() {
  return queryOptions({
    queryKey: onboardingKeys.status,
    queryFn: async ({ signal }) =>
      (await apiClient.get<OnboardingStatus>('/onboarding/status', { signal })).data,
    retry: shouldRetryQuery,
  });
}

/** `PATCH /onboarding` — setup path / finished / dismissed / seen. */
export function useUpdateOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateOnboardingInput) =>
      (await apiClient.patch<OnboardingStatus>('/onboarding', input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: onboardingKeys.status }),
  });
}
