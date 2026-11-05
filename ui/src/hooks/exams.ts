/**
 * [19.6.1] Exams client hooks — exam CRUD, exam-component CRUD + copy,
 * grid-submission progress, and a student's fourth-subject choice.
 * Mirrors `classes.ts`'s shape (query-key factory, `offlineCachedQueryFn`
 * only where a list is genuinely worth reading offline — exams/components
 * skip it, same as `subjects.ts`, since these are low-traffic staff-admin
 * screens, not a field-worker list).
 *
 * `progress`/`listOptions`/`copy`'s response bodies have no `@ApiResponse`
 * decoration server-side (see `mark-grid.service.ts#progress`,
 * `subject-choices.service.ts#listOptions`), so `schema.d.ts` types them
 * `content?: never` — hand-typed here against the service's actual return
 * shape, same gap `PaginatedClasses` documents for `/classes`.
 */
import { ApprovalScope, type ExamStatus } from '@biddaloy/shared';
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';
import type { IssuerSnapshot } from '../components/print/issuer-header';
import type { ReportCardProgramRow } from '../components/print/report-card';

import { type ApprovedMutationResult, useApprovedMutation } from './approval';
import { withHttpStatusShape } from './bulk-upload';
import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { filenameFromContentDisposition, saveBlob } from './reports';
import { shouldRetryQuery } from './retry';
import type { BulkImportError, PreviewResult } from './use-bulk-upload-preview';

export type Exam = components['schemas']['Exam'];
export type CreateExamInput = components['schemas']['CreateExamDto'];
export type UpdateExamInput = components['schemas']['UpdateExamDto'];
export type ExamComponent = components['schemas']['ExamComponent'];
export type CreateExamComponentInput = components['schemas']['CreateExamComponentDto'];
export type UpdateExamComponentInput = components['schemas']['UpdateExamComponentDto'];
export type CopyExamComponentsInput = components['schemas']['CopyExamComponentsDto'];
export type SetSubjectChoiceInput = components['schemas']['SetSubjectChoiceDto'];

export interface PaginatedExams {
  data: Exam[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ExamListFilters {
  academic_year_id?: string;
  class_id?: string;
  /** Filtered on the server before paging. */
  status?: ExamStatus;
  page?: number;
  limit?: number;
}

export const examKeys = createEntityKeys<ExamListFilters>('exams');

export function examsQueryOptions(filters: ExamListFilters = {}) {
  const params = { limit: 10, ...filters };
  const queryKey = examKeys.list(params);
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedExams>('/exams', { params, signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useExams(filters: ExamListFilters = {}) {
  return useQuery(examsQueryOptions(filters));
}

export function examQueryOptions(id: string) {
  return queryOptions({
    queryKey: examKeys.detail(id),
    queryFn: async () => (await apiClient.get<Exam>(`/exams/${id}`)).data,
    retry: shouldRetryQuery,
  });
}

export function useExam(id: string | undefined) {
  return useQuery({ ...examQueryOptions(id ?? ''), enabled: id !== undefined });
}

export function useCreateExam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExamInput) =>
      (await apiClient.post<Exam>('/exams', input)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: examKeys.lists() }),
  });
}

export function useUpdateExam(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateExamInput) =>
      (await apiClient.patch<Exam>(`/exams/${id}`, input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: examKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: examKeys.lists() });
    },
  });
}

export function useDeleteExam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/exams/${id}`);
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: examKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: examKeys.lists() });
    },
  });
}

// --- Exam components ---

export function examComponentsKey(examId: string | undefined, subjectId: string | undefined) {
  return [...examKeys.all, 'components', examId, subjectId] as const;
}

export function examComponentsQueryOptions(
  examId: string | undefined,
  subjectId: string | undefined,
) {
  return queryOptions({
    queryKey: examComponentsKey(examId, subjectId),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ExamComponent[]>(`/exams/${examId}/components`, {
        params: subjectId ? { subject_id: subjectId } : {},
        signal,
      });
      return res.data;
    },
    enabled: examId !== undefined && subjectId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useExamComponents(examId: string | undefined, subjectId: string | undefined) {
  return useQuery(examComponentsQueryOptions(examId, subjectId));
}

/** Every component for an exam, across all subjects — the copy dialog's
 * preview needs to know what already exists in every candidate target
 * subject, not just the one currently open on the Setup tab. */
export function examComponentsAllQueryOptions(examId: string | undefined) {
  return queryOptions({
    queryKey: [...examComponentsKey(examId, undefined), 'all'] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ExamComponent[]>(`/exams/${examId}/components`, { signal });
      return res.data;
    },
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useExamComponentsAll(examId: string | undefined) {
  return useQuery(examComponentsAllQueryOptions(examId));
}

// [pr-fix #945] All three mutations below invalidate the exam-level
// prefix ([...examKeys.all, 'components', examId]) rather than
// examComponentsKey(examId, subjectId) — examComponentsAllQueryOptions
// (the CopyComponentsDialog preview) is keyed with subjectId `undefined`,
// which TanStack Query's prefix matching would otherwise never touch when
// subjectId is defined here. These three take no subjectId —
// they never need one.

export function useCreateExamComponent(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExamComponentInput) =>
      (await apiClient.post<ExamComponent>(`/exams/${examId}/components`, input)).data,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: [...examKeys.all, 'components', examId] }),
  });
}

export function useUpdateExamComponent(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateExamComponentInput }) =>
      (await apiClient.patch<ExamComponent>(`/exams/${examId}/components/${id}`, input)).data,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: [...examKeys.all, 'components', examId] }),
  });
}

export function useDeleteExamComponent(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/exams/${examId}/components/${id}`);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: [...examKeys.all, 'components', examId] }),
  });
}

/** D9 copy dialog's confirm step — `ExamComponentsService.copy`'s actual
 * created/skipped result. The dialog's *preview* (shown before this ever
 * fires) is computed client-side from already-fetched component lists —
 * see `-copy-components-dialog.tsx` — since the endpoint itself performs
 * the copy rather than offering a dry run. */
export interface CopyExamComponentsResult {
  copied: Array<{ subject_id: string; name: string }>;
  skipped: Array<{ subject_id: string; name: string; reason: string }>;
}

export function useCopyExamComponents(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CopyExamComponentsInput) =>
      (await apiClient.post<CopyExamComponentsResult>(`/exams/${examId}/components/copy`, input))
        .data,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: [...examKeys.all, 'components', examId] }),
  });
}

// --- Progress ---

export interface ExamProgress {
  counts: Record<'DRAFT' | 'SUBMITTED', number>;
  /** Grids not ready to process (draft, or submitted with blanks). */
  outstanding: ExamProgressGrid[];
  /** Every grid the caller may open, whatever its state. */
  grids: ExamProgressGrid[];
}

export interface ExamProgressGrid {
  section_id: string;
  section_name: string;
  subject_id: string;
  subject_name: string | null;
  subject_name_bn: string | null;
  state: 'DRAFT' | 'SUBMITTED';
}

export function examProgressQueryOptions(examId: string | undefined) {
  return queryOptions({
    queryKey: [...examKeys.all, 'progress', examId] as const,
    queryFn: async ({ signal }) =>
      (await apiClient.get<ExamProgress>(`/exams/${examId}/marks/progress`, { signal })).data,
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useExamProgress(examId: string | undefined) {
  return useQuery(examProgressQueryOptions(examId));
}

// --- Subject choices (fourth subject) ---

export interface SubjectChoiceOption {
  class_subject_id: string;
  subject_id: string;
  chosen: boolean;
  is_fourth: boolean;
  /** Raw group label; null = ordinary optional (fourth-subject) option. */
  choice_group: string | null;
}

export function subjectChoiceOptionsKey(
  studentId: string | undefined,
  academicYearId: string | undefined,
) {
  return ['subject-choices', studentId, academicYearId] as const;
}

export function subjectChoiceOptionsQueryOptions(
  studentId: string | undefined,
  academicYearId: string | undefined,
) {
  return queryOptions({
    queryKey: subjectChoiceOptionsKey(studentId, academicYearId),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<SubjectChoiceOption[]>(
        `/students/${studentId}/subject-choices`,
        { params: { academic_year_id: academicYearId }, signal },
      );
      return res.data;
    },
    enabled: studentId !== undefined && academicYearId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useSubjectChoiceOptions(
  studentId: string | undefined,
  academicYearId: string | undefined,
) {
  return useQuery(subjectChoiceOptionsQueryOptions(studentId, academicYearId));
}

export function useSetSubjectChoice(studentId: string, academicYearId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetSubjectChoiceInput) => {
      await apiClient.put(`/students/${studentId}/subject-choices`, input);
    },
    // Choice-group picks update optimistically: the picked member becomes
    // chosen and its siblings are cleared (the server replaces the pick).
    onMutate: async (input) => {
      const key = subjectChoiceOptionsKey(studentId, academicYearId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SubjectChoiceOption[]>(key);
      const group = previous?.find(
        (o) => o.class_subject_id === input.class_subject_id,
      )?.choice_group;
      if (previous && group && !input.is_fourth) {
        queryClient.setQueryData<SubjectChoiceOption[]>(
          key,
          previous.map((o) =>
            o.choice_group === group
              ? { ...o, chosen: o.class_subject_id === input.class_subject_id }
              : o,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous)
        queryClient.setQueryData(subjectChoiceOptionsKey(studentId, academicYearId), ctx.previous);
    },
    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: subjectChoiceOptionsKey(studentId, academicYearId),
      }),
  });
}

// --- Marks grid [19.7.1] ---

export type MarkStatus = 'PRESENT' | 'ABSENT' | 'EXEMPT';
export type MarkGridState = 'DRAFT' | 'SUBMITTED';

export interface MarkGridStudent {
  id: string;
  roll_number: number;
  full_name: string;
  /** Enrolled after the last sitting with no marks: never counts as blank. */
  joined_after_exam?: boolean;
  /** Another stream, or an optional / choice subject not picked: never counts as blank. */
  not_taking?: boolean;
}

export interface MarkGridComponent {
  id: string;
  name: string;
  kind: string;
  source: 'MANUAL' | 'DERIVED';
  full_marks: string;
  pass_marks: string | null;
  sequence: number;
}

export interface MarkGridCell {
  student_id: string;
  component_id: string;
  value: string | null;
  status: MarkStatus;
}

export interface MarkGrid {
  exam_id: string;
  section_id: string;
  subject_id: string;
  state: MarkGridState;
  submitted_by: string | null;
  submitted_at: string | null;
  students: MarkGridStudent[];
  components: MarkGridComponent[];
  cells: MarkGridCell[];
  derived: Record<string, { reason: string | null; values: Record<string, string | null> }>;
}

export function markGridKey(
  examId: string | undefined,
  sectionId: string | undefined,
  subjectId: string | undefined,
) {
  return [...examKeys.all, 'marks-grid', examId, sectionId, subjectId] as const;
}

export function markGridQueryOptions(
  examId: string | undefined,
  sectionId: string | undefined,
  subjectId: string | undefined,
) {
  return queryOptions({
    queryKey: markGridKey(examId, sectionId, subjectId),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<MarkGrid>(`/exams/${examId}/marks`, {
        params: { section_id: sectionId, subject_id: subjectId },
        signal,
      });
      return res.data;
    },
    enabled: examId !== undefined && sectionId !== undefined && subjectId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useMarkGrid(
  examId: string | undefined,
  sectionId: string | undefined,
  subjectId: string | undefined,
) {
  return useQuery(markGridQueryOptions(examId, sectionId, subjectId));
}

export interface SavedMarkCell extends MarkGridCell {
  saved_at: string;
}

/** Not a `useMutation` — `autosave.ts` owns its own retry/backoff loop
 * (D19), so this is a plain async function the grid/stepper pass as that
 * hook's `save` callback rather than TanStack Query's single-shot retry. */
export function saveMarkBatch(
  examId: string,
  sectionId: string,
  subjectId: string,
  cells: MarkGridCell[],
): Promise<{ cells: SavedMarkCell[] }> {
  return apiClient
    .patch<{ cells: SavedMarkCell[] }>(`/exams/${examId}/marks`, {
      section_id: sectionId,
      subject_id: subjectId,
      cells,
    })
    .then((res) => res.data);
}

export function useSubmitMarkGrid(examId: string, sectionId: string, subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<MarkGrid>(`/exams/${examId}/marks/submit`, {
        section_id: sectionId,
        subject_id: subjectId,
      });
      return res.data;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: markGridKey(examId, sectionId, subjectId) }),
  });
}

export function useReopenMarkGrid(examId: string, sectionId: string, subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<MarkGrid>(`/exams/${examId}/marks/reopen`, {
        section_id: sectionId,
        subject_id: subjectId,
      });
      return res.data;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: markGridKey(examId, sectionId, subjectId) }),
  });
}

// --- Results [19.8.1] ---
// Hand-typed against `ResultsService.list`/`getStudentResult` — no
// `@ApiResponse` decoration server-side yet, same gap `ExamProgress`
// above documents.

export interface ResultRow {
  student_id: string;
  roll_number: number;
  full_name: string;
  total_marks: number;
  gpa: number;
  grade: string;
  position: number | null;
  is_fail: boolean;
}

export interface ResultSubjectDetail {
  subject_id: string;
  subject_name: string;
  obtained: number;
  grade: string;
  gpa: number;
  is_fail: boolean;
  is_fourth_subject: boolean;
  components: Array<{ name: string; full_marks: number; obtained: number | null }>;
}

export interface ResultDetail {
  student: { id: string; full_name: string; roll_number: number };
  result: {
    total_marks: number;
    gpa: number;
    grade: string;
    position: number | null;
    is_fail: boolean;
    grading_scale_id: string;
  };
  subjects: ResultSubjectDetail[];
}

export function resultsKey(examId: string | undefined) {
  return [...examKeys.all, 'results', examId] as const;
}

export function resultsQueryOptions(examId: string | undefined) {
  return queryOptions({
    queryKey: resultsKey(examId),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ResultRow[]>(`/exams/${examId}/results`, { signal })).data,
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useResults(examId: string | undefined) {
  return useQuery(resultsQueryOptions(examId));
}

export function resultDetailKey(examId: string | undefined, studentId: string | undefined) {
  return [...examKeys.all, 'results', examId, studentId] as const;
}

export function resultDetailQueryOptions(
  examId: string | undefined,
  studentId: string | undefined,
) {
  return queryOptions({
    queryKey: resultDetailKey(examId, studentId),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ResultDetail>(`/exams/${examId}/results/${studentId}`, { signal })).data,
    enabled: examId !== undefined && studentId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useResultDetail(examId: string | undefined, studentId: string | undefined) {
  return useQuery(resultDetailQueryOptions(examId, studentId));
}

// --- Exam schedule [19.11.1] ---
// Hand-typed against `ExamSchedulesService`/`ExamSchedulesController` —
// same no-`@ApiResponse` gap `ExamProgress` above documents.

export interface ExamScheduleRow {
  id: string;
  exam_id: string;
  subject_id: string;
  subject: { id: string; name_en: string; name_bn: string } | null;
  date: string;
  starts_at: string;
  ends_at: string;
  venue: string | null;
}

export interface ExamScheduleWriteResult {
  schedule: ExamScheduleRow;
  warnings: string[];
}

export interface CreateExamScheduleInput {
  subject_id: string;
  date: string;
  starts_at: string;
  ends_at: string;
  venue?: string | null;
}

export interface UpdateExamScheduleInput {
  date?: string;
  starts_at?: string;
  ends_at?: string;
  venue?: string | null;
}

export function examScheduleKey(examId: string | undefined) {
  return [...examKeys.all, 'schedule', examId] as const;
}

export function examScheduleQueryOptions(examId: string | undefined) {
  return queryOptions({
    queryKey: examScheduleKey(examId),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ExamScheduleRow[]>(`/exams/${examId}/schedule`, { signal })).data,
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useExamSchedule(examId: string | undefined) {
  return useQuery(examScheduleQueryOptions(examId));
}

export function useCreateExamSchedule(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExamScheduleInput) =>
      (await apiClient.post<ExamScheduleWriteResult>(`/exams/${examId}/schedule`, input)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: examScheduleKey(examId) }),
  });
}

export function useUpdateExamSchedule(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateExamScheduleInput }) =>
      (await apiClient.patch<ExamScheduleWriteResult>(`/exams/${examId}/schedule/${id}`, input))
        .data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: examScheduleKey(examId) }),
  });
}

export function useDeleteExamSchedule(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/exams/${examId}/schedule/${id}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: examScheduleKey(examId) }),
  });
}

// --- Student exam schedule (portal) [19.11.1] ---

export interface StudentExamScheduleRow extends ExamScheduleRow {
  exam: { id: string; name: string; kind: string };
}

export function studentExamScheduleKey(studentId: string | undefined) {
  return ['students', studentId, 'exam-schedule'] as const;
}

export function studentExamScheduleQueryOptions(studentId: string | undefined) {
  return queryOptions({
    queryKey: studentExamScheduleKey(studentId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<StudentExamScheduleRow[]>(`/students/${studentId}/exam-schedule`, {
          signal,
        })
      ).data,
    enabled: studentId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useStudentExamSchedule(studentId: string | undefined) {
  return useQuery(studentExamScheduleQueryOptions(studentId));
}

/** After process, publish or reopen: the exam's results, its detail, and every
 * per-student result card/list (`['students', id, 'results', …]`), which the
 * staff report card reads [#2922]. */
function invalidateExamResults(queryClient: QueryClient, examId: string) {
  void queryClient.invalidateQueries({ queryKey: resultsKey(examId) });
  void queryClient.invalidateQueries({ queryKey: examKeys.detail(examId) });
  void queryClient.invalidateQueries({
    predicate: (q) => q.queryKey[0] === 'students' && q.queryKey[2] === 'results',
  });
}

/** [19.8.1] step 2: if any grid is still DRAFT the server refuses with a
 * 409 unless `force` is set — the process dialog lists those and offers
 * "process anyway" (audited server-side via `forced: true`). */
export function useProcessResults(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (force: boolean) =>
      (await apiClient.post<{ processed: number }>(`/exams/${examId}/results/process`, { force }))
        .data,
    onSuccess: () => {
      invalidateExamResults(queryClient, examId);
    },
  });
}

export function usePublishResults(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.post(`/exams/${examId}/results/publish`);
    },
    onSuccess: () => {
      invalidateExamResults(queryClient, examId);
    },
  });
}

/** Step-up approval-gated (`ApprovalScope.RESULTS_REOPEN`) — the server's
 * `@RequireApproval` on `POST /exams/:examId/results/reopen`.
 * `useApprovedMutation` (`ui/src/hooks/approval.tsx`) opens the existing
 * step-up modal on the first `403 APPROVAL_REQUIRED`; callers never drive
 * that modal themselves. */
export function useReopenResults(examId: string): ApprovedMutationResult<void, void> {
  const queryClient = useQueryClient();
  return useApprovedMutation<void, void>(
    async (_variables, options) => {
      await apiClient.post(`/exams/${examId}/results/reopen`, undefined, options);
    },
    {
      approvalScope: ApprovalScope.RESULTS_REOPEN,
      onSuccess: () => {
        invalidateExamResults(queryClient, examId);
      },
    },
  );
}

export interface ResultSmsOutcome {
  queued: number;
  skipped: Array<{ student_id: string; reason: string }>;
}

export function useSendResultSms(examId: string) {
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<ResultSmsOutcome>(`/exams/${examId}/results/sms`)).data,
  });
}

// --- Student results [19.9.1] ---
// `GET /students/:studentId/results(/:examId)` — shared by the family
// portal (published-only, server-enforced) and the staff results panel on
// student detail (every exam, `published` on each row lets the client
// label the unpublished ones). Hand-typed against
// `ResultsService.listForStudent`/`getStudentResultCard` — same
// no-`@ApiResponse` gap `ResultRow`/`ResultDetail` above document.

export interface StudentResultRow {
  exam_id: string;
  exam_name: string;
  exam_kind: string;
  published: boolean;
  total_marks: number;
  gpa: number;
  grade: string;
  position: number | null;
  is_fail: boolean;
}

export function studentResultsKey(studentId: string | undefined) {
  return ['students', studentId, 'results'] as const;
}

export function studentResultsQueryOptions(studentId: string | undefined) {
  return queryOptions({
    queryKey: studentResultsKey(studentId),
    queryFn: async ({ signal }) =>
      (await apiClient.get<StudentResultRow[]>(`/students/${studentId}/results`, { signal })).data,
    enabled: studentId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useStudentResults(studentId: string | undefined) {
  return useQuery(studentResultsQueryOptions(studentId));
}

/** The report-card shape `ui/src/components/print/report-card.tsx` takes
 * as `data` directly, plus `exam_name` — see
 * `ResultsService.getStudentResultCard`'s own doc comment for why the
 * legend is baked into this response rather than a second, ADMIN-only
 * `/grading/scales/:id` call a PARENT/STUDENT could never make. */
export interface StudentResultCard {
  exam_name: string;
  student: { full_name: string; roll_number: number };
  result: {
    total_marks: number;
    gpa: number;
    grade: string;
    position: number | null;
    is_fail: boolean;
  };
  subjects: ResultSubjectDetail[];
  legend: Array<{ grade: string; gpa: number | null; comment: string | null }>;
  issuer: IssuerSnapshot;
  logo_url: string | null;
  /** [34.2.3/D22] Opted-in programs; omitted/empty when none. */
  programs?: ReportCardProgramRow[];
}

export function studentResultCardKey(studentId: string | undefined, examId: string | undefined) {
  return ['students', studentId, 'results', examId] as const;
}

export function studentResultCardQueryOptions(
  studentId: string | undefined,
  examId: string | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: studentResultCardKey(studentId, examId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<StudentResultCard>(`/students/${studentId}/results/${examId}`, {
          signal,
        })
      ).data,
    enabled: enabled && studentId !== undefined && examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useStudentResultCard(
  studentId: string | undefined,
  examId: string | undefined,
  enabled = true,
) {
  return useQuery(studentResultCardQueryOptions(studentId, examId, enabled));
}

// --- Analysis [26.4.2] ---
// Hand-typed against `AnalysisService`'s row shapes (`MeritRow`,
// `DefaultedRow`, `SubjectPassFailRow`/`OverallPassFailRow`,
// `ComponentPassFailRow`) — same no-`@ApiResponse` gap `ResultRow` above
// documents. Every endpoint replies `{status, rows}`: `status` is the
// exam's `ExamStatus` so the screen can render "process results first"
// while the exam is still DRAFT instead of an empty table.

export interface MeritRow {
  student_id: string;
  roll_number: number;
  full_name: string;
  section_id: string | null;
  section_name: string | null;
  total_marks: number;
  gpa: number;
  grade: string;
  position: number | null;
  section_position: number | null;
  is_fail: boolean;
}

export interface DefaultedRow extends MeritRow {
  failed_subjects: Array<{ subject_id: string; name: string }>;
  absent_subjects: Array<{ subject_id: string; name: string }>;
}

export interface SubjectPassFailRow {
  subject_id: string;
  subject_name: string;
  appeared: number;
  passed: number;
  failed: number;
  absent: number;
  pass_pct: number;
  highest: number | null;
  average: number | null;
  grade_distribution: Record<string, number>;
}

export interface OverallPassFailRow {
  subject_id: null;
  subject_name: 'Overall';
  appeared: number;
  passed: number;
  failed: number;
  absent: number;
  pass_pct: number;
  highest: number | null;
  average: number | null;
  grade_distribution: Record<string, number>;
}

export interface PassFailResult {
  status: string;
  subjects: SubjectPassFailRow[];
  overall: OverallPassFailRow;
}

export interface ComponentPassFailRow {
  subject_id: string;
  subject_name: string;
  component_id: string;
  component_name: string;
  sequence: number;
  appeared: number;
  absent: number;
  below_pass: number | null;
  highest: number | null;
  average: number | null;
}

export function analysisKey(kind: string, examId: string | undefined, sectionId?: string) {
  return [...examKeys.all, 'analysis', kind, examId, sectionId] as const;
}

export function meritListQueryOptions(examId: string | undefined, sectionId?: string) {
  return queryOptions({
    queryKey: analysisKey('merit', examId, sectionId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<{ status: string; rows: MeritRow[] }>(
          `/exams/${examId}/analysis/merit`,
          { params: sectionId ? { section_id: sectionId } : {}, signal },
        )
      ).data,
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useMeritList(examId: string | undefined, sectionId?: string) {
  return useQuery(meritListQueryOptions(examId, sectionId));
}

export function defaultedListQueryOptions(examId: string | undefined, sectionId?: string) {
  return queryOptions({
    queryKey: analysisKey('defaulted', examId, sectionId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<{ status: string; rows: DefaultedRow[] }>(
          `/exams/${examId}/analysis/defaulted`,
          { params: sectionId ? { section_id: sectionId } : {}, signal },
        )
      ).data,
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useDefaultedList(examId: string | undefined, sectionId?: string) {
  return useQuery(defaultedListQueryOptions(examId, sectionId));
}

export function passFailQueryOptions(examId: string | undefined, sectionId?: string) {
  return queryOptions({
    queryKey: analysisKey('pass-fail', examId, sectionId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<{
          status: string;
          subjects: SubjectPassFailRow[];
          overall: OverallPassFailRow;
        }>(`/exams/${examId}/analysis/pass-fail`, {
          params: sectionId ? { section_id: sectionId } : {},
          signal,
        })
      ).data,
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function usePassFail(examId: string | undefined, sectionId?: string) {
  return useQuery(passFailQueryOptions(examId, sectionId));
}

export function passFailByComponentQueryOptions(examId: string | undefined, sectionId?: string) {
  return queryOptions({
    queryKey: analysisKey('pass-fail-components', examId, sectionId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<{ status: string; rows: ComponentPassFailRow[] }>(
          `/exams/${examId}/analysis/pass-fail/components`,
          { params: sectionId ? { section_id: sectionId } : {}, signal },
        )
      ).data,
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function usePassFailByComponent(examId: string | undefined, sectionId?: string) {
  return useQuery(passFailByComponentQueryOptions(examId, sectionId));
}

/** A plain `<a href>` never runs `apiClient`'s interceptor, so a request
 * built that way carries no `Authorization` bearer token and no
 * `X-Tenant-ID` — `AuthGuard('jwt')`/`ContextGuard` reject it. Fetch the
 * CSV through `apiClient` as a blob instead and trigger the download from
 * a temporary object URL, same pattern as `downloadCollectionsReportCsv`
 * (`reports.ts`). */
export async function downloadAnalysisCsv(
  examId: string,
  kind: 'merit' | 'defaulted' | 'pass-fail',
  sectionId?: string,
  examName?: string,
): Promise<void> {
  const res = await apiClient.get<Blob>(`/exams/${examId}/analysis/${kind}.csv`, {
    params: sectionId ? { section_id: sectionId } : {},
    responseType: 'blob',
  });
  const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  // The server's `res.attachment()` filename is set for a direct-navigation
  // download, but an SPA blob download always names the file from `.download`
  // instead — name it the same way so a fetched CSV isn't just "merit.csv".
  anchor.download = examName ? `${examName}-${kind}.csv` : `${kind}.csv`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// --- Marks sheet import ([81.2.2]) ---

type MarksSheetValidateResult = components['schemas']['MarksSheetValidateResultDto'];
export type MarksSheetChange = components['schemas']['MarksSheetChangeDto'];
export type MarksSheetSummary = components['schemas']['MarksSheetSummaryDto'];
export type MarksSheetCommitResult = components['schemas']['MarksSheetCommitResultDto'];

/** What the preview screen needs beyond the shared `PreviewResult`: the counts and the cell diff. */
export interface MarksSheetPreviewSummary {
  summary: MarksSheetSummary;
  changes: MarksSheetChange[];
}

/** `GET /exams/:examId/marks/sheet` — the pre-filled .xlsx for one section-subject grid, saved to disk. */
export function useDownloadMarksSheet(examId: string, sectionId: string, subjectId: string) {
  return useMutation({
    mutationFn: async (): Promise<void> => {
      try {
        const res = await apiClient.get<Blob>(`/exams/${examId}/marks/sheet`, {
          params: { section_id: sectionId, subject_id: subjectId },
          responseType: 'blob',
        });
        const filename = filenameFromContentDisposition(
          res.headers['content-disposition'] as string | undefined,
          'marks-sheet.xlsx',
        );
        saveBlob(res.data, filename);
      } catch (error) {
        throw withHttpStatusShape(error);
      }
    },
    retry: false,
  });
}

/**
 * `POST /exams/:examId/marks/sheet/validate`, multipart field `file`. Writes nothing.
 * Row errors come back in `errors[]`. Whole-file problems arrive as HTTP 400 with `details.code`
 * set to an `ImportFileErrorCode` value (`IMPORT_FILE_UNREADABLE`, `IMPORT_FILE_TOO_LARGE`, …) or a
 * `MarksSheetFileErrorCode` (`WRONG_SHEET`, `DUPLICATE_COMPONENT`); multer's size cap is a 413 with
 * no code. The import page maps those to `marksImport.errors.*` itself.
 */
export function useValidateMarksSheet(examId: string, sectionId: string, subjectId: string) {
  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress?: (percent: number) => void;
    }): Promise<PreviewResult<MarksSheetPreviewSummary>> => {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await apiClient.post<MarksSheetValidateResult>(
          `/exams/${examId}/marks/sheet/validate`,
          formData,
          {
            params: { section_id: sectionId, subject_id: subjectId },
            onUploadProgress: (event) => {
              if (onProgress && event.total) {
                onProgress(Math.round((event.loaded / event.total) * 100));
              }
            },
          },
        );
        const body = res.data;
        // The server sends a code, never prose: the screen translates `code`. `value` stays
        // unset on purpose: the error table shows it as the "offending value" column, and the
        // roll is not that. The sheet row number is the identity; `roll` is dropped here.
        const errors: BulkImportError[] = body.errors.map((e) => ({
          row: e.row,
          column: e.component_name,
          message: e.code,
          severity: 'error',
          code: e.code,
        }));
        return {
          // null only when no cell was staged (every row failed, or nothing changed). Row errors
          // next to staged cells still get an id (D7).
          staging_id: body.staging_id ?? '',
          expires_at: body.expires_at ?? '',
          errors,
          // D7: row errors never block the rest. Only a sheet where nothing was staged is stuck;
          // `BulkUploadPreview` disables Save on any hard error, so staged sheets report 0.
          hard_error_count: body.staging_id ? 0 : errors.length,
          summary: { summary: body.summary, changes: body.changes },
        };
      } catch (error) {
        throw withHttpStatusShape(error);
      }
    },
    retry: false,
  });
}

/** `POST /exams/:examId/marks/sheet/commit` — Rule 25: `retry: false`, one `Idempotency-Key` per attempt. */
export function useCommitMarksSheet(examId: string, sectionId: string, subjectId: string) {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (stagingId: string): Promise<MarksSheetCommitResult> => {
      const body = { staging_id: stagingId, section_id: sectionId, subject_id: subjectId };
      try {
        const res = await apiClient.post<MarksSheetCommitResult>(
          `/exams/${examId}/marks/sheet/commit`,
          body,
          { headers: { 'Idempotency-Key': keyFor(body) } },
        );
        return res.data;
      } catch (error) {
        throw withHttpStatusShape(error);
      }
    },
    retry: false,
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: markGridKey(examId, sectionId, subjectId) });
      void queryClient.invalidateQueries({ queryKey: examProgressQueryOptions(examId).queryKey });
    },
  });
}
