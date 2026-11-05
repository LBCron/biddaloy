/** [70.4.1] Final result (D6/D15): one class-year result built from the published exams.
 * `GET/POST /final-results…`. The response DTOs have no `@ApiResponse` server-side, so they
 * are typed from `@biddaloy/shared` (same gap `exams.ts` documents for `ResultRow`). The final
 * tabulation is the exception: its route declares `@ApiOkResponse`, so it comes from `schema.d.ts`. */
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
export type FinalTabulation = components['schemas']['FinalTabulationDto'];

/** The final card the student routes return (D20): the shared card plus each counted exam's
 * whole-exam share (null = the exam only has per-subject shares). Same shape as `Transcript.final`. */
export type FinalCard = FinalResultStudentCard & {
  exam_shares: Array<{ exam_id: string; share_percent: number | null }>;
};

export const finalResultKeys = createEntityKeys<{ academic_year_id?: string }>('final-results');
export const finalResultRowsKey = (id: string, filters: FinalResultRowsFilters = {}) =>
  [...finalResultKeys.detail(id), 'rows', filters] as const;
export const finalResultCardKey = (id: string, studentId: string) =>
  [...finalResultKeys.detail(id), 'card', studentId] as const;
export const finalTabulationKey = (id: string, sectionId: string) =>
  [...finalResultKeys.detail(id), 'tabulation', sectionId] as const;
/** Student-scoped like the transcript key, so a final change refreshes both (see `invalidateFinal`). */
export const studentFinalCardKey = (studentId: string, academicYearId: string) =>
  ['students', studentId, 'final-result-card', academicYearId] as const;

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

/** Final tabulation of one section: per-subject exam and final marks (D21). */
export function useFinalTabulation(id: string | undefined, sectionId: string | undefined) {
  return useQuery({
    queryKey: finalTabulationKey(id ?? '', sectionId ?? ''),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<FinalTabulation>(`/final-results/${id}/documents/tabulation`, {
          params: { section_id: sectionId },
          signal,
        })
      ).data,
    enabled: Boolean(id && sectionId),
    retry: shouldRetryQuery,
  });
}

/** A student's final card for a year. Staff see a PROCESSED final too; a family sees PUBLISHED
 * only (the server decides). 404 when the year has no visible final for the student. */
export function useStudentFinalCard(
  studentId: string | undefined,
  academicYearId: string | undefined,
) {
  return useQuery({
    queryKey: studentFinalCardKey(studentId ?? '', academicYearId ?? ''),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<FinalCard>(`/students/${studentId}/final-result-card`, {
          params: { academic_year_id: academicYearId },
          signal,
        })
      ).data,
    enabled: Boolean(studentId && academicYearId),
    retry: shouldRetryQuery,
  });
}

/** Student-scoped reads that show a final: results, the transcript's `final`, the final card. */
const STUDENT_FINAL_VIEWS: readonly unknown[] = ['results', 'transcript', 'final-result-card'];

/** A change touches the list line, the summary, rows, the notes lock and every student's results. */
function invalidateFinal(queryClient: QueryClient, id: string) {
  void queryClient.invalidateQueries({ queryKey: finalResultKeys.lists() });
  void queryClient.invalidateQueries({ queryKey: finalResultKeys.detail(id) });
  void queryClient.invalidateQueries({ queryKey: ['report-card-notes'] });
  void queryClient.invalidateQueries({ queryKey: ['promotions'] });
  void invalidateStudentFinalViews(queryClient);
}

/** Refresh every student's loaded results, transcript and final card. */
export function invalidateStudentFinalViews(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (q) => q.queryKey[0] === 'students' && STUDENT_FINAL_VIEWS.includes(q.queryKey[2]),
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
