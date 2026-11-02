/**
 * [53.3.03] Reader-side queries for `GET /notices/mine` (list), `…/:id` (detail, which marks
 * the notice seen) and `POST …/:id/acknowledge`. Shared by the list, detail and the cards.
 */
import { apiClient, type components } from '@biddaloy/ui/api';
import { shouldRetryQuery } from '@biddaloy/ui/hooks';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type MyNoticeItem = components['schemas']['NoticeMineItemDto'];
export type MyNoticeDetail = components['schemas']['NoticeMineDetailDto'];
export type MyNoticeFile = components['schemas']['NoticeFileDto'];

export interface MyNoticesParams {
  tab?: 'current' | 'archive';
  q?: string;
  year?: number;
  page?: number;
  limit?: number;
}

export const myNoticeKeys = {
  all: ['notices', 'mine'] as const,
  list: (params: MyNoticesParams) => ['notices', 'mine', 'list', params] as const,
  detail: (id: string) => ['notices', 'mine', 'detail', id] as const,
};

export function myNoticesQueryOptions(params: MyNoticesParams) {
  return queryOptions({
    queryKey: myNoticeKeys.list(params),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<components['schemas']['NoticeMineListDto']>('/notices/mine', {
          params,
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function useMyNotices(params: MyNoticesParams) {
  return useQuery(myNoticesQueryOptions(params));
}

/** Opening is the "seen" write (D22), so it only runs once the person asks for the detail. */
export function useMyNotice(id: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: myNoticeKeys.detail(id ?? ''),
    enabled: id !== null,
    retry: shouldRetryQuery,
    queryFn: async ({ signal }) => {
      const data = (await apiClient.get<MyNoticeDetail>(`/notices/mine/${id}`, { signal })).data;
      // The row is now read: refresh lists so the bold clears.
      void queryClient.invalidateQueries({ queryKey: [...myNoticeKeys.all, 'list'] });
      return data;
    },
  });
}

export function useAcknowledgeNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      await apiClient.post(`/notices/mine/${id}/acknowledge`);
    },
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: myNoticeKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: [...myNoticeKeys.all, 'list'] });
    },
  });
}

/** The file route needs the bearer token, so a bare href cannot open it. */
export async function fetchNoticeFileBlob(noticeId: string, fileId: string): Promise<Blob> {
  return (
    await apiClient.get<Blob>(`/notices/${noticeId}/files/${fileId}`, { responseType: 'blob' })
  ).data;
}
