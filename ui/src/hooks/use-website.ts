/**
 * School website admin hooks (Epic 40, W2). The one place W2 screens read the website API.
 * Every type comes from the generated `schema.d.ts`.
 *
 * Mutations: `retry: false` and every one invalidates `['website']` (Rule 25).
 */
import type { SiteMediaSlot } from '@biddaloy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { shouldRetryQuery } from './retry';
import { useDebouncedValue } from './use-debounce';

export type WebsiteConfig = components['schemas']['SiteDto'];
export type WebsiteTheme = components['schemas']['ThemeSummaryDto'];
export type SaveDraftInput = components['schemas']['SaveDraftDto'];
export type PublishInput = components['schemas']['PublishDto'];
export type SubdomainCheck = components['schemas']['SubdomainCheckDto'];
export type SubdomainSuggestions = components['schemas']['SubdomainSuggestDto'];
export type PreviewToken = components['schemas']['PreviewTokenDto'];
export type WebsiteMedia = components['schemas']['SiteMediaListDto'];

export const websiteKeys = {
  all: ['website'] as const,
  config: () => ['website', 'config'] as const,
  themes: () => ['website', 'themes'] as const,
  subdomainCheck: (value: string) => ['website', 'subdomain-check', value] as const,
  subdomainSuggest: () => ['website', 'subdomain-suggest'] as const,
  media: () => ['website', 'media'] as const,
  previewToken: () => ['website', 'preview-token'] as const,
};

export function useWebsiteConfig() {
  return useQuery({
    queryKey: websiteKeys.config(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<WebsiteConfig>('/website', { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useWebsiteThemes() {
  return useQuery({
    queryKey: websiteKeys.themes(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<WebsiteTheme[]>('/website/themes', { signal })).data,
    retry: shouldRetryQuery,
    staleTime: 5 * 60 * 1000,
  });
}

/** Debounced 300 ms; nothing is sent under 3 characters. */
export function useSubdomainCheck(value: string) {
  const debounced = useDebouncedValue(value.trim().toLowerCase(), 300);
  return useQuery({
    queryKey: websiteKeys.subdomainCheck(debounced),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<SubdomainCheck>('/website/subdomain/check', {
          params: { value: debounced },
          signal,
        })
      ).data,
    enabled: debounced.length >= 3,
    retry: shouldRetryQuery,
  });
}

export function useSubdomainSuggestions() {
  return useQuery({
    queryKey: websiteKeys.subdomainSuggest(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<SubdomainSuggestions>('/website/subdomain/suggest', { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useWebsiteMedia() {
  return useQuery({
    queryKey: websiteKeys.media(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<WebsiteMedia>('/website/media', { signal })).data,
    retry: shouldRetryQuery,
  });
}

/** The link expires after an hour, so it is never cached and only fetched when asked for. */
export function usePreviewToken(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: websiteKeys.previewToken(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<PreviewToken>('/website/preview-token', { signal })).data,
    enabled: options.enabled ?? false,
    retry: shouldRetryQuery,
    staleTime: 0,
    gcTime: 0,
  });
}

function useInvalidateWebsite() {
  const qc = useQueryClient();
  // Not `all`: subdomain-check answers and preview tokens must not refetch on every save.
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: websiteKeys.config() }),
      qc.invalidateQueries({ queryKey: websiteKeys.media() }),
    ]);
}

export function useSaveDraft() {
  const invalidate = useInvalidateWebsite();
  return useMutation({
    mutationFn: async (input: SaveDraftInput) =>
      (await apiClient.put<WebsiteConfig>('/website/draft', input)).data,
    onSuccess: invalidate,
    retry: false,
  });
}

export function usePublishWebsite() {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateWebsite();
  return useMutation({
    mutationFn: async (input: PublishInput) =>
      (
        await apiClient.post<WebsiteConfig>('/website/publish', input, {
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

export function useSetWebsiteEnabled() {
  const invalidate = useInvalidateWebsite();
  return useMutation({
    mutationFn: async (enabled: boolean) =>
      (await apiClient.post<WebsiteConfig>('/website/enabled', { enabled })).data,
    onSuccess: invalidate,
    retry: false,
  });
}

export function useRenameSubdomain() {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateWebsite();
  return useMutation({
    mutationFn: async (value: string) =>
      (
        await apiClient.put<WebsiteConfig>(
          '/website/subdomain',
          { value },
          { headers: { 'Idempotency-Key': keyFor({ value }) } },
        )
      ).data,
    onSuccess: () => {
      rotate();
      return invalidate();
    },
    retry: false,
  });
}

/** `blob` is the cropped output of `ImageSlotUpload`, never the original file. */
export function useUploadSiteMedia(slot: SiteMediaSlot) {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateWebsite();
  return useMutation({
    mutationFn: async (blob: Blob) => {
      const form = new FormData();
      form.append('slot', slot);
      form.append('file', blob, `${slot}.${blob.type === 'image/jpeg' ? 'jpg' : 'webp'}`);
      return (
        await apiClient.post<{ id: string }>('/website/media', form, {
          headers: { 'Idempotency-Key': keyFor({ slot, size: blob.size, type: blob.type }) },
        })
      ).data;
    },
    onSuccess: () => {
      rotate();
      return invalidate();
    },
    retry: false,
  });
}

export function useDeleteSiteMedia() {
  const invalidate = useInvalidateWebsite();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/website/media/${id}`);
    },
    onSuccess: invalidate,
    retry: false,
  });
}
