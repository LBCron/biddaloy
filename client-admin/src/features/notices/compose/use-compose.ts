/**
 * [53.3.g2.01] Queries and mutations for the notice compose page. No notice hooks exist in
 * `ui/src/hooks` yet, so they live here, next to their only caller. Writes never auto-retry
 * (Rule 25); publish carries an `Idempotency-Key` (D14).
 */
import type { components } from '@biddaloy/ui/api';
import { apiClient } from '@biddaloy/ui/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

type S = components['schemas'];
export type NoticeDto = S['NoticeDto'];
export type NoticeFileDto = S['NoticeFileDto'];
export type NoticeRecipientDto = S['NoticeRecipientDto'];
export type AudiencePersonDto = S['AudiencePersonDto'];
export type AudienceQueryDto = S['AudienceQueryDto'];
export type RecipientRefDto = S['RecipientRefDto'];

export interface NoticeFields {
  title: string;
  body: string;
  important: boolean;
  pinned: boolean;
  isPublic: boolean;
  /** `YYYY-MM-DD`, or null for no end date. */
  expiresOn: string | null;
}

export const RECIPIENTS_PAGE = 25;

const keys = {
  notice: (id: string) => ['notice-compose', id] as const,
  recipients: (id: string, page: number) => ['notice-compose', id, 'recipients', page] as const,
  allRecipients: (id: string) => ['notice-compose', id, 'all-recipients'] as const,
  people: (query: AudienceQueryDto) => ['notice-compose', 'people', query] as const,
};

export function useNotice(id: string | undefined) {
  return useQuery({
    queryKey: keys.notice(id ?? ''),
    queryFn: async ({ signal }) =>
      (await apiClient.get<NoticeDto>(`/notices/${id}`, { signal })).data,
    enabled: id !== undefined,
  });
}

/** Creates the draft on the first save, then patches it. */
export function useSaveNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, fields }: { id: string | undefined; fields: NoticeFields }) =>
      id === undefined
        ? (await apiClient.post<NoticeDto>('/notices', fields)).data
        : (await apiClient.patch<NoticeDto>(`/notices/${id}`, fields)).data,
    onSuccess: (notice) => {
      queryClient.setQueryData(keys.notice(notice.id), notice);
    },
  });
}

export function useUploadNoticeFiles() {
  return useMutation({
    mutationFn: async ({ id, files }: { id: string; files: File[] }) => {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      return (await apiClient.post<NoticeFileDto[]>(`/notices/${id}/files`, form)).data;
    },
  });
}

export function useRemoveNoticeFile() {
  return useMutation({
    mutationFn: async ({ id, fileId }: { id: string; fileId: string }) => {
      await apiClient.delete(`/notices/${id}/files/${fileId}`);
    },
  });
}

export function useAudiencePeople(query: AudienceQueryDto, enabled: boolean) {
  return useQuery({
    queryKey: keys.people(query),
    queryFn: async ({ signal }) =>
      (await apiClient.get<S['AudiencePageDto']>('/audience/people', { params: query, signal }))
        .data,
    enabled,
  });
}

export function useRecipients(id: string | undefined, page: number) {
  return useQuery({
    queryKey: keys.recipients(id ?? '', page),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<S['NoticeRecipientPageDto']>(`/notices/${id}/recipients`, {
          params: { page, limit: RECIPIENTS_PAGE },
          signal,
        })
      ).data,
    enabled: id !== undefined,
  });
}

/** Every recipient, for the Chosen-list totals on the check step (100 per request). */
export function useAllRecipients(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: id ? keys.allRecipients(id) : ['notice-compose', 'none'],
    queryFn: async ({ signal }) => {
      const rows: NoticeRecipientDto[] = [];
      for (let page = 1; ; page++) {
        const { data } = await apiClient.get<S['NoticeRecipientPageDto']>(
          `/notices/${id}/recipients`,
          { params: { page, limit: 100 }, signal },
        );
        rows.push(...data.items);
        if (rows.length >= data.total || data.items.length === 0) return rows;
      }
    },
    enabled: enabled && id !== undefined,
    // The audience changes on the previous step; always read it fresh.
    gcTime: 0,
  });
}

function useRecipientMutation<V>(id: string, fn: (v: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notice-compose', id] }),
  });
}

export function useAddRecipients(id: string) {
  return useRecipientMutation(id, (items: RecipientRefDto[]) =>
    apiClient.post(`/notices/${id}/recipients`, { items }),
  );
}

export function useRemoveRecipients(id: string) {
  return useRecipientMutation(id, (ids: string[]) =>
    apiClient.delete(`/notices/${id}/recipients`, { data: { ids } }),
  );
}

export function useAddMatching(id: string) {
  return useRecipientMutation(id, (query: AudienceQueryDto) =>
    apiClient.post(`/notices/${id}/recipients/matching`, query),
  );
}

export function usePublishNotice(id: string) {
  const queryClient = useQueryClient();
  // ponytail: `useIdempotencyKey` is not exported from `@biddaloy/ui/hooks`; one key per
  // attempt, kept in a ref until it succeeds (a retry after a failure re-sends the same key).
  // Swap to `useIdempotencyKey` once `ui/src/hooks/index.ts` exports it.
  const key = React.useRef<{ sms: boolean; value: string } | undefined>(undefined);
  return useMutation({
    mutationFn: async (requestSms: boolean) => {
      if (key.current?.sms !== requestSms)
        key.current = { sms: requestSms, value: crypto.randomUUID() };
      return (
        await apiClient.post<NoticeDto>(
          `/notices/${id}/publish`,
          { requestSms },
          { headers: { 'Idempotency-Key': key.current.value } },
        )
      ).data;
    },
    onSuccess: (notice) => {
      key.current = undefined;
      queryClient.setQueryData(keys.notice(notice.id), notice);
    },
  });
}

/** Mints a new public link (the old one stops). No Idempotency-Key: the server keeps the token out of Redis. */
export function useNewPublicLink(id: string) {
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<S['PublicLinkDto']>(`/notices/${id}/public-link`)).data,
  });
}
