/**
 * [26.4.2] Promotions client hooks — end-of-year run CRUD, target
 * suggestion, entry overrides, and commit. Mirrors `exams.ts`'s shape
 * (`createEntityKeys`, `queryOptions` + a thin `use*` wrapper) and
 * `grading.ts:187-203`'s `useApprovedMutation` clone for the one
 * approval-gated mutation.
 *
 * `schema.d.ts`'s `operations["PromotionsController_*_v1"]` entries have
 * no `@ApiResponse` decoration server-side (no `@ApiOkResponse` on
 * `PromotionsController`), so every response here is hand-typed against
 * `PromotionsService`'s actual return shapes — same gap `ResultRow`/
 * `ExamProgress` document in `exams.ts`.
 */
import { ApprovalScope, type PlacementAlgorithm, type PromotionOutcome } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { type ApprovedMutationResult, useApprovedMutation } from './approval';
import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type PromotionRunStatus = 'DRAFT' | 'COMMITTED';

export interface PromotionRun {
  id: string;
  tenant_id: string;
  source_class_id: string;
  source_academic_year_id: string;
  target_academic_year_id: string;
  target_class_id: string | null;
  exam_ids?: string[];
  /** [70.4.1] Set when the run ranks on a final result instead of exams. */
  final_result_id?: string | null;
  algorithm: PlacementAlgorithm;
  status: PromotionRunStatus;
  refreshed_at: string;
  committed_at: string | null;
  committed_by_user_id: string | null;
  approved_by_user_id: string | null;
  override_count: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface PromotionEntry {
  id: string;
  tenant_id: string;
  run_id: string;
  student_id: string;
  source_enrollment_id: string;
  source_section_id: string | null;
  merit_rank: number | null;
  mean_gpa: string | null;
  total_marks_sum: string | null;
  passed_all: boolean;
  suggested_outcome: PromotionOutcome;
  final_outcome: PromotionOutcome;
  is_override: boolean;
  override_note: string | null;
  overridden_by_user_id: string | null;
  group_name: string | null;
  target_class_id: string | null;
  target_section_id: string | null;
  new_roll_number: number | null;
  placement_error: string | null;
  target_enrollment_id: string | null;
  created_at: string;
  updated_at: string;
  student_name: string | null;
  student_roll_number: number | null;
}

export interface PromotionRunDetail extends PromotionRun {
  entries: PromotionEntry[];
}

export type BlockingReason =
  'PICK_TARGET_CLASS' | 'TARGET_SECTIONS_MISSING' | 'RETAIN_CLASS_MISSING';

export interface TargetSuggestion {
  target_class: { id: string; name: string } | null;
  retain_class: { id: string; name: string } | null;
  sections: Array<{
    id: string;
    section_name: string;
    capacity: number | null;
    group_name: string | null;
  }>;
  blocking_reason?: BlockingReason;
}

interface CreatePromotionRunBase {
  source_class_id: string;
  target_academic_year_id: string;
  target_class_id?: string;
  algorithm: PlacementAlgorithm;
}

/** Exactly one source: `exam_ids` (an exam average) or `final_result_id` (D4). */
export type CreatePromotionRunInput = CreatePromotionRunBase &
  ({ exam_ids: string[]; final_result_id?: never } | { final_result_id: string; exam_ids?: never });

export interface PatchPromotionEntryInput {
  student_id: string;
  final_outcome?: PromotionOutcome;
  group_name?: string;
  override_note?: string;
}

export interface StudentPromotionOverride {
  run_id: string;
  target_academic_year_name: string | null;
  final_outcome: PromotionOutcome;
  override_note: string | null;
  overridden_by_name: string | null;
  committed_at: string | null;
}

export const promotionKeys = createEntityKeys<{ source_class_id?: string }>('promotions');

export function promotionRunsQueryOptions(sourceClassId?: string) {
  const params = sourceClassId ? { source_class_id: sourceClassId } : {};
  return queryOptions({
    queryKey: promotionKeys.list(params),
    queryFn: async ({ signal }) =>
      (await apiClient.get<PromotionRun[]>('/promotions', { params, signal })).data,
    retry: shouldRetryQuery,
  });
}

export function usePromotionRuns(sourceClassId?: string) {
  return useQuery(promotionRunsQueryOptions(sourceClassId));
}

export function promotionRunQueryOptions(id: string | undefined) {
  return queryOptions({
    queryKey: promotionKeys.detail(id ?? ''),
    queryFn: async ({ signal }) =>
      (await apiClient.get<PromotionRunDetail>(`/promotions/${id}`, { signal })).data,
    enabled: id !== undefined,
    retry: shouldRetryQuery,
  });
}

export function usePromotionRun(id: string | undefined) {
  return useQuery(promotionRunQueryOptions(id));
}

export function suggestPromotionTargetKey(
  sourceClassId: string | undefined,
  targetYearId: string | undefined,
) {
  return [...promotionKeys.all, 'suggest-target', sourceClassId, targetYearId] as const;
}

export function suggestPromotionTargetQueryOptions(
  sourceClassId: string | undefined,
  targetYearId: string | undefined,
) {
  return queryOptions({
    queryKey: suggestPromotionTargetKey(sourceClassId, targetYearId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<TargetSuggestion>('/promotions/suggest-target', {
          params: { source_class_id: sourceClassId, target_academic_year_id: targetYearId },
          signal,
        })
      ).data,
    enabled: sourceClassId !== undefined && targetYearId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useSuggestPromotionTarget(
  sourceClassId: string | undefined,
  targetYearId: string | undefined,
) {
  return useQuery(suggestPromotionTargetQueryOptions(sourceClassId, targetYearId));
}

export function useCreatePromotionRun() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: CreatePromotionRunInput) =>
      (
        await apiClient.post<PromotionRunDetail>('/promotions', input, {
          headers: { 'Idempotency-Key': keyFor(input) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: promotionKeys.lists() });
    },
  });
}

export function useUpdatePromotionEntries(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Serialize one run's entry saves: without it, a revert sent while a
    // note save is still in flight can land first, leaving the server with
    // the override the grid no longer shows. Same pattern as `students.ts`.
    scope: { id: `promotion-entries-${runId}` },
    mutationFn: async (entries: PatchPromotionEntryInput[]) =>
      (await apiClient.patch<PromotionRunDetail>(`/promotions/${runId}/entries`, entries)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: promotionKeys.detail(runId) }),
  });
}

export function useRefreshPromotionRun(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<PromotionRunDetail>(`/promotions/${runId}/refresh`)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: promotionKeys.detail(runId) }),
  });
}

export function useDeletePromotionRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      await apiClient.delete(`/promotions/${runId}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: promotionKeys.lists() }),
  });
}

/** `POST /promotions/:id/commit` — the server only demands a step-up
 * approval when the run has overrides (`override_count > 0`); a
 * no-override commit succeeds on the first request. `useApprovedMutation`
 * only retries with an `X-Approval-Token` when the server actually
 * responds `403 APPROVAL_REQUIRED`, so no run-has-overrides branching is
 * needed here — the server's own conditional `@RequireApproval` (D9's
 * pattern, same as `fee-generation-batch.service.ts`'s duplicate-override
 * consume) already makes the challenge conditional. */
export function useCommitPromotionRun(
  runId: string,
): ApprovedMutationResult<void, PromotionRunDetail> {
  const queryClient = useQueryClient();
  return useApprovedMutation<void, PromotionRunDetail>(
    async (_variables, options) =>
      (await apiClient.post<PromotionRunDetail>(`/promotions/${runId}/commit`, undefined, options))
        .data,
    {
      approvalScope: ApprovalScope.PROMOTION_OVERRIDE,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: promotionKeys.detail(runId) });
        void queryClient.invalidateQueries({ queryKey: promotionKeys.lists() });
      },
    },
  );
}

export function studentPromotionOverridesKey(studentId: string | undefined) {
  return ['students', studentId, 'promotion-overrides'] as const;
}

export function studentPromotionOverridesQueryOptions(studentId: string | undefined) {
  return queryOptions({
    queryKey: studentPromotionOverridesKey(studentId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<StudentPromotionOverride[]>(
          `/students/${studentId}/promotion-overrides`,
          {
            signal,
          },
        )
      ).data,
    enabled: studentId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useStudentPromotionOverrides(studentId: string | undefined) {
  return useQuery(studentPromotionOverridesQueryOptions(studentId));
}
