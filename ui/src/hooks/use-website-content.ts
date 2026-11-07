/**
 * School website content hooks (Epic 40, W3). The one place the W3 screens read the posts,
 * enquiries and teacher-profile API, plus the pure helpers that edit a draft config.
 *
 * Saving a draft reuses `useSaveDraft` from `use-website.ts`. Every mutation here is
 * `retry: false` (Rule 25); create and publish carry an `Idempotency-Key`.
 *
 * Every DTO type comes from the generated `schema.d.ts`.
 */
import {
  SiteSectionKey,
  type SiteAnnouncementBar,
  type SiteConfig,
  type SitePage,
  type SiteSectionTypography,
  type SiteTheme,
  type SiteTypography,
} from '@biddaloy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { shouldRetryQuery } from './retry';

/* ------------------------------ draft helpers ------------------------------ */

/** Hero first, footer last (D31). `footer` is not a stored section key today; kept for when it is. */
const PINNED_FIRST: readonly string[] = [SiteSectionKey.HERO];
const PINNED_LAST: readonly string[] = ['footer'];

export const isPinnedSection = (key: string) =>
  PINNED_FIRST.includes(key) || PINNED_LAST.includes(key);

function editPage(
  config: SiteConfig,
  page: SitePage,
  edit: (
    sections: SiteConfig['pages'][number]['sections'],
  ) => SiteConfig['pages'][number]['sections'],
): SiteConfig {
  return {
    ...config,
    pages: config.pages.map((p) => (p.page === page ? { ...p, sections: edit(p.sections) } : p)),
  };
}

function editSection(
  config: SiteConfig,
  page: SitePage,
  key: SiteSectionKey,
  edit: (
    s: SiteConfig['pages'][number]['sections'][number],
  ) => SiteConfig['pages'][number]['sections'][number],
): SiteConfig {
  return editPage(config, page, (sections) => sections.map((s) => (s.key === key ? edit(s) : s)));
}

/** Turning a section off keeps its data, so turning it on again brings the text back. */
export const toggleSection = (
  config: SiteConfig,
  page: SitePage,
  key: SiteSectionKey,
  enabled: boolean,
) => editSection(config, page, key, (s) => ({ ...s, enabled }));

/** Switches a whole page on or off; a draft that lacks the page (saved before it existed) gets it, section-less. */
export function setPageEnabled(config: SiteConfig, page: SitePage, enabled: boolean): SiteConfig {
  const has = config.pages.some((p) => p.page === page);
  return {
    ...config,
    pages: has
      ? config.pages.map((p) => (p.page === page ? { ...p, enabled } : p))
      : [...config.pages, { page, enabled, sections: [] }],
  };
}

/** A pinned section never moves, and nothing moves onto a pinned slot. */
export function moveSection(config: SiteConfig, page: SitePage, from: number, to: number) {
  return editPage(config, page, (sections) => {
    const moving = sections[from];
    const target = sections[to];
    if (!moving || !target || from === to) return sections;
    if (isPinnedSection(moving.key) || isPinnedSection(target.key)) return sections;
    const next = [...sections];
    next.splice(from, 1);
    next.splice(to, 0, moving);
    return next;
  });
}

export const setSectionData = (
  config: SiteConfig,
  page: SitePage,
  key: SiteSectionKey,
  data: Record<string, unknown>,
) => editSection(config, page, key, (s) => ({ ...s, data }));

export const setSectionTypography = (
  config: SiteConfig,
  page: SitePage,
  key: SiteSectionKey,
  typography: SiteSectionTypography,
) => editSection(config, page, key, (s) => ({ ...s, typography }));

export const setAnnouncements = (
  config: SiteConfig,
  announcements: SiteAnnouncementBar,
): SiteConfig => ({ ...config, announcements });

export const setPalette = (config: SiteConfig, palette: string): SiteConfig => ({
  ...config,
  palette,
});

export const setTypography = (config: SiteConfig, typography: SiteTypography): SiteConfig => ({
  ...config,
  typography,
});

/** Only the theme id changes here; the new theme's defaults for empty fields come from the server. */
export const setTheme = (config: SiteConfig, theme: SiteTheme): SiteConfig => ({
  ...config,
  theme,
});

/* --------------------------------- types ----------------------------------- */

export type SitePost = components['schemas']['PostDto'];
export type SitePostList = components['schemas']['PostListDto'];
export type SitePostInput = components['schemas']['SavePostDto'];
export type SiteEnquiry = components['schemas']['EnquiryDto'];
export type SiteEnquiryPage = components['schemas']['EnquiryListDto'];
export type WebTeacher = components['schemas']['StaffWebProfileDto'];
export type WebTeacherInput = components['schemas']['SaveStaffWebProfileDto'];

export const ENQUIRY_PAGE_SIZE = 20;

export const websiteContentKeys = {
  posts: () => ['website', 'posts'] as const,
  post: (id: string) => ['website', 'posts', id] as const,
  enquiries: (page: number) => ['website', 'enquiries', page] as const,
  enquiriesAll: () => ['website', 'enquiries'] as const,
  teachers: () => ['website', 'teachers'] as const,
};

/* --------------------------------- queries --------------------------------- */

export function usePosts() {
  return useQuery({
    queryKey: websiteContentKeys.posts(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<SitePostList>('/website/posts', { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function usePost(id: string | undefined) {
  return useQuery({
    queryKey: websiteContentKeys.post(id ?? ''),
    queryFn: async ({ signal }) =>
      (await apiClient.get<SitePost>(`/website/posts/${id}`, { signal })).data,
    enabled: !!id,
    retry: shouldRetryQuery,
  });
}

export function useEnquiries(page: number) {
  return useQuery({
    queryKey: websiteContentKeys.enquiries(page),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<SiteEnquiryPage>('/website/enquiries', {
          params: { page, limit: ENQUIRY_PAGE_SIZE },
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function useWebTeachers() {
  return useQuery({
    queryKey: websiteContentKeys.teachers(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<WebTeacher[]>('/website/teachers', { signal })).data,
    retry: shouldRetryQuery,
  });
}

/* ------------------------------- mutations --------------------------------- */

export function useCreatePost() {
  const qc = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: SitePostInput) =>
      (
        await apiClient.post<SitePost>('/website/posts', input, {
          headers: { 'Idempotency-Key': keyFor(input) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      return qc.invalidateQueries({ queryKey: websiteContentKeys.posts() });
    },
    retry: false,
  });
}

export function useUpdatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: SitePostInput & { id: string }) =>
      (await apiClient.put<SitePost>(`/website/posts/${id}`, input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: websiteContentKeys.posts() }),
    retry: false,
  });
}

/** `publish: false` unpublishes. */
export function usePublishPost() {
  const qc = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async ({ id, publish = true }: { id: string; publish?: boolean }) =>
      (
        await apiClient.post<SitePost>(
          `/website/posts/${id}/${publish ? 'publish' : 'unpublish'}`,
          undefined,
          { headers: { 'Idempotency-Key': keyFor({ id, publish }) } },
        )
      ).data,
    onSuccess: () => {
      rotate();
      return qc.invalidateQueries({ queryKey: websiteContentKeys.posts() });
    },
    retry: false,
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/website/posts/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: websiteContentKeys.posts() }),
    retry: false,
  });
}

export function useMarkEnquirySeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/website/enquiries/${id}/seen`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: websiteContentKeys.enquiriesAll() }),
    retry: false,
  });
}

export function useDeleteEnquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/website/enquiries/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: websiteContentKeys.enquiriesAll() }),
    retry: false,
  });
}

export function useUpsertWebTeacher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, ...input }: WebTeacherInput & { userId: string }) =>
      (await apiClient.put<WebTeacher>(`/website/teachers/${userId}`, input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: websiteContentKeys.teachers() }),
    retry: false,
  });
}
