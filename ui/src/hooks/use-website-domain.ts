/**
 * School website address and visitor hooks (Epic 40, W5): the custom domain and 30-day analytics.
 * Every type comes from the generated `schema.d.ts`. Renaming the subdomain is
 * `useRenameSubdomain` in `use-website.ts`.
 *
 * Mutations: `retry: false` (Rule 25); setting a domain sends an `Idempotency-Key`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import { ApiError } from '../api/errors';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { shouldRetryQuery } from './retry';

export type CustomDomainStatus = components['schemas']['CustomDomainStatusDto'];
export type CustomDomainRecord = components['schemas']['DnsRecordDto'];
export type SetCustomDomainInput = components['schemas']['SetCustomDomainDto'];
export type WebsiteAnalytics = components['schemas']['AnalyticsDto'];

export const websiteDomainKeys = {
  customDomain: () => ['website', 'custom-domain'] as const,
  analytics: () => ['website', 'analytics'] as const,
};

/**
 * `null` means custom domains are off for this school (server answers 409
 * `site.custom_domain_unavailable`: direct edge mode, or Cloudflare not set up). The screen hides
 * its card instead of showing an error.
 */
export function useCustomDomain() {
  return useQuery({
    queryKey: websiteDomainKeys.customDomain(),
    queryFn: async ({ signal }): Promise<CustomDomainStatus | null> => {
      try {
        return (await apiClient.get<CustomDomainStatus>('/website/custom-domain', { signal })).data;
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 409) return null;
        throw error;
      }
    },
    // Live status: keep asking while the domain is still waiting on the school's DNS or the cert.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PENDING_DNS' || status === 'PENDING_SSL' ? 15_000 : false;
    },
    retry: shouldRetryQuery,
  });
}

/** `{ available: false }` is a normal answer (analytics off or down), not an error. */
export function useWebsiteAnalytics() {
  return useQuery({
    queryKey: websiteDomainKeys.analytics(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<WebsiteAnalytics>('/website/analytics', { signal })).data,
    retry: shouldRetryQuery,
    staleTime: 60 * 1000,
  });
}

function useInvalidateCustomDomain() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: websiteDomainKeys.customDomain() });
}

export function useSetCustomDomain() {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateCustomDomain();
  return useMutation({
    mutationFn: async (input: SetCustomDomainInput) =>
      (
        await apiClient.put<CustomDomainStatus>('/website/custom-domain', input, {
          headers: { 'Idempotency-Key': keyFor(input) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      return invalidate();
    },
    retry: false,
  });
}

export function useRemoveCustomDomain() {
  const invalidate = useInvalidateCustomDomain();
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete('/website/custom-domain');
    },
    onSuccess: invalidate,
    retry: false,
  });
}

export function useRecheckCustomDomain() {
  const invalidate = useInvalidateCustomDomain();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<CustomDomainStatus>('/website/custom-domain/recheck')).data,
    onSuccess: invalidate,
    retry: false,
  });
}
