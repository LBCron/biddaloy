import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type CommunicationLog = components['schemas']['CommunicationResponseDto'];

export const communicationLogKeys = createEntityKeys<
  { studentId: string } | { guardianId: string }
>('communication-logs');

/** [8.10.2]'s Communication tab — read-only message history for one
 * student. Distinct file from `reminders.ts`, which is the *write* side
 * (the bulk-send mutation `/students`'s list page fires) — this is the
 * read side neither that file nor `students.ts` has any reason to own. */
export function useStudentCommunicationLogs(studentId: string) {
  return useQuery(
    queryOptions({
      queryKey: communicationLogKeys.list({ studentId }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<CommunicationLog[]>(
          `/communications/student/${studentId}`,
          { signal },
        );
        return res.data;
      },
      // An empty id would hit `GET /communications/student/` (the message log's unused branch).
      enabled: Boolean(studentId),
      retry: shouldRetryQuery,
    }),
  );
}

/** [8.11.4]'s Communication History tab — read-only message history for
 * one guardian, direct mirror of `useStudentCommunicationLogs` above,
 * backed by `communications.controller.ts`'s `GET
 * communications/guardian/:guardianId`. */
export function useGuardianCommunicationLogs(guardianId: string) {
  return useQuery(
    queryOptions({
      queryKey: communicationLogKeys.list({ guardianId }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<CommunicationLog[]>(
          `/communications/guardian/${guardianId}`,
          { signal },
        );
        return res.data;
      },
      enabled: Boolean(guardianId),
      retry: shouldRetryQuery,
    }),
  );
}

export type LastReminder = components['schemas']['LastReminderDto'];

/** [8.10.4]'s dues queue "Last reminder" column — one batch request for a
 * page's worth of students instead of one per row. Disabled when
 * `studentIds` is empty, since `GET /communications/last-reminders`
 * requires at least one id and an empty page shouldn't fire it. */
export function useLastReminders(studentIds: string[]) {
  return useQuery(
    queryOptions({
      queryKey: [...communicationLogKeys.all, 'last-reminders', [...studentIds].sort()] as const,
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<LastReminder[]>('/communications/last-reminders', {
          params: { student_ids: studentIds.join(',') },
          signal,
        });
        return new Map(res.data.map((reminder) => [reminder.student_id, reminder]));
      },
      enabled: studentIds.length > 0,
      retry: shouldRetryQuery,
    }),
  );
}

export type SendCommunicationInput = components['schemas']['SendGuardianMessageDto'];

/**
 * [8.11.9]'s Send Message page — one staff-composed message to one
 * recipient via `POST /communications/send`. The 201 body's `status` is
 * `QUEUED` (dispatch happens async via BullMQ), so the page pairs this
 * with `useCommunicationLog` below to show where the message actually
 * got to. `retry: false` — same non-idempotency reasoning as
 * `reminders.ts`'s send mutations: a retry after a dropped response
 * would queue the same message twice.
 */
export function useSendCommunication() {
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: SendCommunicationInput) => {
      const res = await apiClient.post<CommunicationLog>('/communications/send', input, {
        headers: { 'Idempotency-Key': keyFor(input) },
      });
      return res.data;
    },
    onSuccess: rotate,
    retry: false,
  });
}

/**
 * `GET /communications/{id}` — one log entry, used by the Send Message
 * page's post-send panel to show the queued message's current delivery
 * status. `enabled` gates it until a send has actually produced an id.
 * [2683] Re-reads every 2s while QUEUED, so a later FAILED (and its reason)
 * shows up. ponytail: stops after 30 reads (~1 min) so a stuck row does not
 * poll forever; the page still shows "on its way" then.
 */
export function useCommunicationLog(id: string | undefined) {
  return useQuery(
    queryOptions({
      queryKey: communicationLogKeys.detail(id ?? ''),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<CommunicationLog>(`/communications/${id}`, { signal });
        return res.data;
      },
      enabled: id !== undefined,
      refetchInterval: (query) =>
        query.state.data?.status === 'QUEUED' && query.state.dataUpdateCount < 30 ? 2_000 : false,
      retry: shouldRetryQuery,
    }),
  );
}
