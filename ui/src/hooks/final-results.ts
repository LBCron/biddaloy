/** [70.4.1] Final result (D6/D15): one class-year result built from the published exams.
 * `GET/POST /final-results…`. The response DTOs have no `@ApiResponse` server-side, so they
 * are typed from `@biddaloy/shared` (same gap `exams.ts` documents for `ResultRow`).
 *
 * No `useFinalTabulation` yet: its route is not in `schema.d.ts` until #3416 regenerates the
 * types; the W5 screen ticket adds it then. */
import {
  ApprovalScope,
  type FinalResultRowView,
  type FinalResultStatus,
  type FinalResultStudentCard,
  type FinalResultSummary,
} from '@biddaloy/shared';
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { type ApprovedMutationResult, useApprovedMutation } from './approval';
import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/** One line per class of the year; `NOT_SET_UP` = the class has no final result yet. */
export interface FinalResultListItem {
  class: { id: string; name: string };
  final_result_id: string | null;
  status: FinalResultStatus | 'NOT_SET_UP';
  published_at: string | null;
}

export interface FinalResultRowsPage {
  data: FinalResultRowView[];
  total: number;
  limit: number;
  offset: number;
}

export interface FinalResultRowsFilters {
  section_id?: string;
  limit?: number;
  offset?: number;
}

export interface FinalResultSmsOutcome {
  queued: number;
  skipped: Array<{ student_id: string; reason: string }>;
}

export type CreateFinalResultInput = components['schemas']['CreateFinalResultBodyDto'];
export type FinalResultWeightInput = components['schemas']['FinalResultWeightBodyDto'];
export type UpdateFinalResultInput = components['schemas']['UpdateFinalResultBodyDto'];

export const finalResultKeys = createEntityKeys<{ academic_year_id?: string }>('final-results');
export const finalResultRowsKey = (id: string, filters: FinalResultRowsFilters = {}) =>
  [...finalResultKeys.detail(id), 'rows', filters] as const;
export const finalResultCardKey = (id: string, studentId: string) =>
  [...finalResultKeys.detail(id), 'card', studentId] as const;

export function finalResultsQueryOptions(academicYearId: string) {
  const params = { academic_year_id: academicYearId };
  return queryOptions({
    queryKey: finalResultKeys.list(params),
    queryFn: async ({ signal }) =>
      (await apiClient.get<FinalResultListItem[]>('/final-results', { params, signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useFinalResults(academicYearId: string | undefined) {
  return useQuery({
    ...finalResultsQueryOptions(academicYearId ?? ''),
    enabled: Boolean(academicYearId),
  });
}

export function finalResultQueryOptions(id: string) {
  return queryOptions({
    queryKey: finalResultKeys.detail(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<FinalResultSummary>(`/final-results/${id}`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useFinalResult(id: string | undefined) {
  return useQuery({ ...finalResultQueryOptions(id ?? ''), enabled: Boolean(id) });
}

export function useFinalResultRows(id: string | undefined, filters: FinalResultRowsFilters = {}) {
  return useQuery({
    queryKey: finalResultRowsKey(id ?? '', filters),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<FinalResultRowsPage>(`/final-results/${id}/rows`, {
          params: filters,
          signal,
        })
      ).data,
    enabled: Boolean(id),
    retry: shouldRetryQuery,
  });
}

export function useFinalResultStudentCard(id: string | undefined, studentId: string | undefined) {
  return useQuery({
    queryKey: finalResultCardKey(id ?? '', studentId ?? ''),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<FinalResultStudentCard>(`/final-results/${id}/students/${studentId}`, {
          signal,
        })
      ).data,
    enabled: Boolean(id && studentId),
    retry: shouldRetryQuery,
  });
}

/** A change touches the list line, the summary, rows, the notes lock and every student's results. */
function invalidateFinal(queryClient: QueryClient, id: string) {
  void queryClient.invalidateQueries({ queryKey: finalResultKeys.lists() });
  void queryClient.invalidateQueries({ queryKey: finalResultKeys.detail(id) });
  void queryClient.invalidateQueries({ queryKey: ['report-card-notes'] });
  void queryClient.invalidateQueries({ queryKey: ['promotions'] });
  void queryClient.invalidateQueries({
    predicate: (q) => q.queryKey[0] === 'students' && q.queryKey[2] === 'results',
  });
}

/** Set up a class's final result (equal shares over the published term exams). */
export function useCreateFinalResult() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: CreateFinalResultInput) =>
      (
        await apiClient.post<FinalResultSummary>('/final-results', input, {
          headers: { 'Idempotency-Key': keyFor(input) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: finalResultKeys.lists() });
    },
    retry: false,
  });
}

/** Save the shares and the switches. */
export function useUpdateFinalResult(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateFinalResultInput) =>
      (await apiClient.patch<FinalResultSummary>(`/final-results/${id}`, input)).data,
    onSuccess: () => invalidateFinal(queryClient, id),
    retry: false,
  });
}

/** "ফল তৈরি করুন": computes every student's row from the published exams. */
export function useBuildFinalResult(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<{ processed: number }>(`/final-results/${id}/build`)).data,
    onSuccess: () => invalidateFinal(queryClient, id),
    retry: false,
  });
}

export function usePublishFinalResult(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.post(`/final-results/${id}/publish`);
    },
    onSuccess: () => invalidateFinal(queryClient, id),
    retry: false,
  });
}

/** Step-up approval (`results.reopen`) like `useReopenResults`; the modal host does the prompt. */
export function useReopenFinalResult(id: string): ApprovedMutationResult<void, void> {
  const queryClient = useQueryClient();
  return useApprovedMutation<void, void>(
    async (_variables, options) => {
      await apiClient.post(`/final-results/${id}/reopen`, undefined, options);
    },
    {
      approvalScope: ApprovalScope.RESULTS_REOPEN,
      onSuccess: () => invalidateFinal(queryClient, id),
    },
  );
}

/** Rule 25: the send carries an `Idempotency-Key`; a double click replays the first answer. */
export function useSendFinalResultSms(id: string) {
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<FinalResultSmsOutcome>(`/final-results/${id}/sms`, undefined, {
          headers: { 'Idempotency-Key': keyFor({ id }) },
        })
      ).data,
    onSuccess: () => rotate(),
    retry: false,
  });
}
