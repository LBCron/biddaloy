import type {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  ReminderBatchStatus,
} from '@biddaloy/shared';
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { communicationLogKeys } from './communications';
import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type SendBulkReminderInput = components['schemas']['SendBulkReminderDto'];
export type ReminderBatchResponse = components['schemas']['ReminderBatchResponseDto'];

/**
 * `POST /communications/reminder/bulk` — not a financial mutation, so `useCreatePayment`'s
 * `onMutate`-ban doesn't apply here. Still no optimistic write, though:
 * there's no reminder-batch cache in this ticket's scope for an optimistic
 * value to land in, so a plain mutation is the whole story. The caller
 * (`send-reminder-dialog.tsx`) reads `isPending`/`isError` directly rather
 * than this hook pre-computing UI state — same "hook owns the request,
 * caller owns the presentation" split every other mutation hook here uses.
 */
export function useSendBulkReminder() {
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: SendBulkReminderInput) => {
      const res = await apiClient.post<ReminderBatchResponse>(
        '/communications/reminder/bulk',
        input,
        { headers: { 'Idempotency-Key': keyFor(input) } },
      );
      return res.data;
    },
    onSuccess: rotate,
    // The send dialog says "could not confirm" itself.
    meta: { handlesUnknownOutcome: true },
    // Not `shouldRetryQuery` like every other mutation here: this endpoint
    // isn't idempotent — a retry after a dropped response (not just a
    // dropped request) creates a second ReminderBatch, a second set of
    // communication logs, and a second batch of outbound queue jobs for
    // the same students, not just a harmless re-send of an identical one.
    retry: false,
  });
}

export type SendSingleReminderInput = components['schemas']['SendSingleReminderDto'];
export type ReminderPreview = components['schemas']['ReminderPreviewResponseDto'];
export type ReminderPreviewRecipient = components['schemas']['ReminderPreviewRecipientDto'];
export type SkippedGuardian = components['schemas']['SkippedGuardianDto'];
export type SingleReminderResult = components['schemas']['SingleReminderResponseDto'];

export interface SingleReminderVariables {
  studentId: string;
  input: SendSingleReminderInput;
}

/**
 * `POST /communications/reminder/single/{studentId}/preview` — [8.11.9]'s
 * mandatory review step. A mutation rather than a query on purpose: a
 * preview is an explicit user action against the inputs *as composed right
 * now* (the page's staleness guard hashes those inputs), not a cacheable
 * read that background refetching should ever re-run on its own. Returns
 * 200 with `recipients[]` and `skipped[]`; sends nothing.
 */
export function useSingleReminderPreview() {
  return useMutation({
    mutationFn: async ({ studentId, input }: SingleReminderVariables) => {
      const res = await apiClient.post<ReminderPreview>(
        `/communications/reminder/single/${studentId}/preview`,
        input,
      );
      return res.data;
    },
  });
}

/**
 * `POST /communications/reminder/single/{studentId}` — the send half of
 * the preview/send pair above. `retry: false` for the same reason
 * `useSendBulkReminder` gives: a retry after a dropped *response* would
 * queue a second, identical reminder to the same guardians.
 */
export function useSendSingleReminder() {
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async ({ studentId, input }: SingleReminderVariables) => {
      const res = await apiClient.post<SingleReminderResult>(
        `/communications/reminder/single/${studentId}`,
        input,
        { headers: { 'Idempotency-Key': keyFor({ studentId, input }) } },
      );
      return res.data;
    },
    onSuccess: rotate,
    retry: false,
  });
}

export type BulkReminderPreview = components['schemas']['BulkReminderPreviewResponseDto'];
export type BulkPreviewStudent = components['schemas']['BulkPreviewStudentDto'];
export type BulkPreviewSkipped = components['schemas']['BulkPreviewSkippedDto'];
export type ReminderBatchListItem = components['schemas']['ReminderBatchListItemDto'];
export type PaginatedReminderBatches = components['schemas']['ReminderBatchListResponseDto'];
export type ReminderBatchLog = components['schemas']['ReminderBatchLogDto'];
export type PaginatedReminderBatchLogs = components['schemas']['ReminderBatchLogListResponseDto'];
export type SkippedRecipient = components['schemas']['SkippedRecipientDto'];

/**
 * `POST /communications/reminder/bulk/preview` — the bulk wizard's
 * mandatory review step. Write-free on the server, but still a mutation
 * for the same reason `useSingleReminderPreview` gives: a preview is an
 * explicit user action against the inputs as composed right now (the
 * wizard fingerprints them), never a background-refetchable read.
 */
export function useBulkReminderPreview() {
  return useMutation({
    mutationFn: async (input: SendBulkReminderInput) => {
      const res = await apiClient.post<BulkReminderPreview>(
        '/communications/reminder/bulk/preview',
        input,
      );
      return res.data;
    },
  });
}

// [8.14.10] Mirrors `QueryReminderBatchesDto`
// (`server/src/modules/communications/dto/reminders.dto.ts`) exactly.
export interface ReminderBatchListFilters {
  search?: string;
  status?: ReminderBatchStatus;
  from_date?: string;
  to_date?: string;
  sort?: 'created_at' | 'batch_name' | 'total_recipients';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export const reminderBatchKeys = createEntityKeys<ReminderBatchListFilters>('reminder-batches');

export function reminderBatchesQueryOptions(filters: ReminderBatchListFilters = {}) {
  return queryOptions({
    queryKey: reminderBatchKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedReminderBatches>('/communications/reminder/bulk', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
    // [8.14.6] Filter/page/sort changes keep the previous page's rows on
    // screen (and `isFetching` true) instead of the whole table collapsing
    // to one "Loading…" row height. v5 dropped `keepPreviousData: true`;
    // this is its replacement.
    placeholderData: keepPreviousData,
  });
}

export function useReminderBatches(filters: ReminderBatchListFilters = {}) {
  return useQuery(reminderBatchesQueryOptions(filters));
}

// [87.SD] Mirrors `QueryCommunicationLogsDto` (reminders.dto.ts).
export interface CommunicationLogListFilters {
  search?: string;
  /** [#3343] One student's or guardian's messages (their detail pages' Messages link). */
  student_id?: string;
  guardian_id?: string;
  trigger?: CommunicationTrigger;
  sent_by?: string;
  provider?: string;
  status?: CommunicationStatus;
  medium?: CommunicationMedium;
  from_date?: string;
  to_date?: string;
  page?: number;
  limit?: number;
}

export const messageLogKeys = createEntityKeys<CommunicationLogListFilters>('message-log');

/** `GET /communications/logs` — the tenant-wide message log. */
export function communicationLogsQueryOptions(filters: CommunicationLogListFilters = {}) {
  return queryOptions({
    queryKey: messageLogKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedReminderBatchLogs>('/communications/logs', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
    placeholderData: keepPreviousData,
  });
}

export function useCommunicationLogs(filters: CommunicationLogListFilters = {}) {
  return useQuery(communicationLogsQueryOptions(filters));
}

export type MessageLogFilterOptions = components['schemas']['MessageLogFilterOptionsDto'];

/** [97.4.02] `GET /communications/logs/filter-options` — the Company and Sent-by choices, on the
 * log's own permission (every role that opens the page can read it). */
export function useMessageLogFilterOptions() {
  return useQuery(
    queryOptions({
      queryKey: [...messageLogKeys.all, 'filter-options'] as const,
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<MessageLogFilterOptions>(
          '/communications/logs/filter-options',
          { signal },
        );
        return res.data;
      },
      retry: shouldRetryQuery,
      staleTime: 5 * 60_000,
    }),
  );
}

/**
 * [97.4.02] `POST /communications/logs/{id}/check-status` — asks the sending company whether a
 * SENT message arrived. One Idempotency-Key per message until a success (Rule 25), `retry: false`;
 * the caller picks its own translated sentence from the status code, never the server's or the
 * vendor's text. The fresh row replaces the one in every cached log page.
 */
export function useCheckMessageStatus() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<ReminderBatchLog>(
        `/communications/logs/${id}/check-status`,
        undefined,
        { headers: { 'Idempotency-Key': keyFor({ id }) } },
      );
      return res.data;
    },
    onSuccess: (row) => {
      rotate();
      queryClient.setQueriesData<PaginatedReminderBatchLogs>(
        { queryKey: messageLogKeys.lists() },
        (old) => old && { ...old, data: old.data.map((r) => (r.id === row.id ? row : r)) },
      );
      // A new status moves the row between status-filtered pages, and changes the student and
      // guardian Communication tabs and the dashboard's Failed messages count.
      void queryClient.invalidateQueries({ queryKey: messageLogKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: communicationLogKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'widget', 'failed-messages'] });
    },
    // Asks, never writes anything to double: the page shows its own sentence for a 5xx.
    meta: { handlesUnknownOutcome: true },
    retry: false,
  });
}

/** How often the batch detail page re-asks the server about a batch that
 * is still being worked through. */
export const REMINDER_BATCH_POLL_MS = 3000;

/**
 * `GET /communications/reminder/bulk/{id}` — polls every
 * `REMINDER_BATCH_POLL_MS` **only while the batch is `PROCESSING`** and
 * stops the moment it settles (COMPLETED / PARTIALLY_FAILED / FAILED):
 * the `refetchInterval` callback re-evaluates against the freshest data
 * after every fetch, so the last PROCESSING response schedules exactly
 * one more poll and a settled response schedules none. [8.11.9]'s
 * "polling runs only while the batch is in progress" AC, in one line.
 */
export function reminderBatchQueryOptions(id: string) {
  return queryOptions({
    queryKey: reminderBatchKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ReminderBatchResponse>(
        `/communications/reminder/bulk/${id}`,
        { signal },
      );
      return res.data;
    },
    retry: shouldRetryQuery,
    refetchInterval: (query) =>
      query.state.data?.status === 'PROCESSING' ? REMINDER_BATCH_POLL_MS : false,
  });
}

export function useReminderBatch(id: string | undefined) {
  return useQuery({
    ...reminderBatchQueryOptions(id ?? ''),
    enabled: id !== undefined,
  });
}

/** Logs keys nest under the batch's own detail key — invalidating one
 * batch's `detail(id)` subtree takes its log pages with it, without a
 * second parallel entity family to keep in sync. */
export function reminderBatchLogsKeyPrefix(id: string) {
  return [...reminderBatchKeys.detail(id), 'logs'] as const;
}

export function reminderBatchLogsKey(id: string, filters: ReminderBatchListFilters = {}) {
  return [...reminderBatchLogsKeyPrefix(id), filters] as const;
}

export interface ReminderBatchLogsOptions {
  /** Poll the log pages on the same cadence as the batch itself. Callers
   * pass `batch.status === 'PROCESSING'`: the batch header's counters tick
   * up as the worker gets through the queue, so a delivery table frozen on
   * the first response — 50 QUEUED rows under a header reading "48 sent,
   * 2 failed" — is the page contradicting itself. */
  poll?: boolean;
}

export function reminderBatchLogsQueryOptions(
  id: string,
  filters: ReminderBatchListFilters = {},
  { poll = false }: ReminderBatchLogsOptions = {},
) {
  return queryOptions({
    queryKey: reminderBatchLogsKey(id, filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedReminderBatchLogs>(
        `/communications/reminder/bulk/${id}/logs`,
        { params: filters, signal },
      );
      return res.data;
    },
    retry: shouldRetryQuery,
    refetchInterval: poll ? REMINDER_BATCH_POLL_MS : false,
    // [8.14.6] Filter/page/sort changes keep the previous page's rows on
    // screen (and `isFetching` true) instead of the whole table collapsing
    // to one "Loading…" row height. v5 dropped `keepPreviousData: true`;
    // this is its replacement.
    placeholderData: keepPreviousData,
  });
}

export function useReminderBatchLogs(
  id: string | undefined,
  filters: ReminderBatchListFilters = {},
  options: ReminderBatchLogsOptions = {},
) {
  return useQuery({
    ...reminderBatchLogsQueryOptions(id ?? '', filters, options),
    enabled: id !== undefined,
  });
}

/** The server caps `limit` at 100 (`QueryReminderBatchesDto`) — paging
 * for `collectFailedStudentIds` walks in the biggest strides allowed. */
const LOGS_PAGE_LIMIT = 100;

/**
 * Walks every page of a batch's logs and returns the distinct
 * `student_id`s whose delivery FAILED — the exact `student_ids` a retry
 * composes its fresh `POST /reminder/bulk` from. A plain async function
 * rather than a hook: the batch detail page calls it inside its retry
 * confirm handler, one shot, no cache involvement wanted (a stale cached
 * page must never decide who gets re-messaged).
 */
export async function collectFailedStudentIds(batchId: string): Promise<string[]> {
  const failed = new Set<string>();
  let page = 1;
  let totalPages: number;
  do {
    const res = await apiClient.get<PaginatedReminderBatchLogs>(
      `/communications/reminder/bulk/${batchId}/logs`,
      { params: { page, limit: LOGS_PAGE_LIMIT } },
    );
    for (const log of res.data.data) {
      if (log.status === 'FAILED' && log.student_id !== null) failed.add(log.student_id);
    }
    totalPages = res.data.totalPages;
    page += 1;
  } while (page <= totalPages);
  return Array.from(failed);
}
