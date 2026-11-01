/**
 * [53.3.g1.01] Staff-side notice hooks: list, one notice, the read report, and
 * the two row writes (copy, withdraw). Mutations never retry (rule 25); copy
 * carries an Idempotency-Key that lives until it succeeds.
 */
import { apiClient, type components } from '@biddaloy/ui/api';
import { shouldRetryQuery } from '@biddaloy/ui/hooks';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import * as React from 'react';

export type Notice = components['schemas']['NoticeDto'];
export type NoticePage = components['schemas']['NoticePageDto'];
export type NoticeReport = components['schemas']['NoticeReportDto'];
export type NoticeReportStatus = components['schemas']['NoticeReportStatus'];
export type NoticeStatus = components['schemas']['NoticeStatus'];

export interface NoticeListParams {
  page: number;
  limit: number;
  status?: NoticeStatus | undefined;
  q?: string | undefined;
}

export interface NoticeReportParams {
  page: number;
  limit: number;
  status?: NoticeReportStatus | undefined;
}

export const noticeKeys = {
  all: ['notices'] as const,
  list: (p: NoticeListParams) => ['notices', 'list', p] as const,
  detail: (id: string) => ['notices', 'detail', id] as const,
  report: (id: string, p: NoticeReportParams) => ['notices', 'report', id, p] as const,
};

export function useNotices(params: NoticeListParams) {
  return useQuery({
    queryKey: noticeKeys.list(params),
    queryFn: async ({ signal }) =>
      (await apiClient.get<NoticePage>('/notices', { params, signal })).data,
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

export function useNotice(id: string) {
  return useQuery({
    queryKey: noticeKeys.detail(id),
    queryFn: async ({ signal }) => (await apiClient.get<Notice>(`/notices/${id}`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useNoticeReport(id: string, params: NoticeReportParams) {
  return useQuery({
    queryKey: noticeKeys.report(id, params),
    queryFn: async ({ signal }) =>
      (await apiClient.get<NoticeReport>(`/notices/${id}/report`, { params, signal })).data,
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

const refresh = (qc: QueryClient) => qc.invalidateQueries({ queryKey: noticeKeys.all });

export function useWithdrawNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<Notice>(`/notices/${id}/withdraw`)).data,
    retry: false,
    onSuccess: () => refresh(qc),
  });
}

export function useCopyNotice() {
  const qc = useQueryClient();
  // One key per copy attempt: a lost reply re-sends the same key, a success rotates it.
  const keys = React.useRef(new Map<string, string>());
  return useMutation({
    mutationFn: async (id: string) => {
      const key = keys.current.get(id) ?? crypto.randomUUID();
      keys.current.set(id, key);
      return (
        await apiClient.post<Notice>(`/notices/${id}/copy`, undefined, {
          headers: { 'Idempotency-Key': key },
        })
      ).data;
    },
    retry: false,
    onSuccess: (_data, id) => {
      keys.current.delete(id);
      return refresh(qc);
    },
  });
}
