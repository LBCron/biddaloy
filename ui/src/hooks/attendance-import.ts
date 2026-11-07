/**
 * [76.4.01] Attendance sheet upload: template download, validate, commit and
 * the past-uploads list. Types come straight from `schema.d.ts`.
 *
 * `importFileErrorKey` is re-exported so a screen maps a whole-file 400 from
 * `useValidateAttendanceSheet` to its `common:importFileErrors.*` text.
 */
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';
import { importFileErrorKey } from '../utils/import-file-error';

import { attendanceKeys } from './attendance';
import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { filenameFromContentDisposition, saveBlob } from './reports';
import { shouldRetryQuery } from './retry';

export { importFileErrorKey };

export type AttendanceSheetValidateResult =
  components['schemas']['ValidateAttendanceImportResultDto'];
export type AttendanceSheetCommitInput = components['schemas']['CommitAttendanceImportDto'];
export type AttendanceSheetCommitResult = components['schemas']['CommitAttendanceImportResultDto'];
export type AttendanceImportSummary = components['schemas']['AttendanceImportSummaryDto'];
export type AttendanceImportList = components['schemas']['AttendanceImportListDto'];
export type AttendanceImportDetail = components['schemas']['AttendanceImportDetailDto'];

export const attendanceImportKeys = createEntityKeys<{ page: number }>('attendance-imports');

/** `GET /attendance/import/template`: a pre-filled sheet for up to 10 sections
 * on one date. Fetched as a blob because a plain link can't carry auth headers. */
export function useDownloadAttendanceSheet() {
  return useMutation({
    mutationFn: async (input: { sectionIds: string[]; date: string }): Promise<void> => {
      const res = await apiClient.get<Blob>('/attendance/import/template', {
        params: { sectionIds: input.sectionIds.join(','), date: input.date },
        responseType: 'blob',
      });
      // `filename*` first: the plain `filename=` has the Bangla class/section names as `_`.
      const filename = filenameFromContentDisposition(
        res.headers['content-disposition'] as string | undefined,
        `attendance-${input.date}.xlsx`,
      );
      saveBlob(res.data, filename);
    },
    retry: false,
  });
}

/** `POST /attendance/import/validate`: multipart; stages the good rows, writes nothing. */
export function useValidateAttendanceSheet() {
  return useMutation({
    mutationFn: async (file: File): Promise<AttendanceSheetValidateResult> => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<AttendanceSheetValidateResult>(
        '/attendance/import/validate',
        formData,
      );
      return res.data;
    },
    retry: false,
  });
}

/** `POST /attendance/import/commit`: the server requires an `Idempotency-Key`.
 * `keyFor` keys on the body, which carries the single-use `staging_id`, so one
 * staged sheet keeps one key however often the user re-presses Save. */
export function useCommitAttendanceSheet() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: AttendanceSheetCommitInput): Promise<AttendanceSheetCommitResult> => {
      const res = await apiClient.post<AttendanceSheetCommitResult>(
        '/attendance/import/commit',
        input,
        { headers: { 'Idempotency-Key': keyFor(input) } },
      );
      return res.data;
    },
    retry: false,
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
      void queryClient.invalidateQueries({ queryKey: attendanceImportKeys.all });
    },
  });
}

export function attendanceImportsQueryOptions(page = 1) {
  return queryOptions({
    queryKey: attendanceImportKeys.list({ page }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<AttendanceImportList>('/attendance/imports', {
        params: { page },
        signal,
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

/** `GET /attendance/imports`: past uploads, newest first. */
export function useAttendanceImports(page = 1) {
  return useQuery(attendanceImportsQueryOptions(page));
}

/** `GET /attendance/imports/:id`: one upload with every row. */
export function useAttendanceImport(id: string | undefined) {
  return useQuery({
    queryKey: attendanceImportKeys.detail(id ?? ''),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<AttendanceImportDetail>(`/attendance/imports/${id}`, {
        signal,
      });
      return res.data;
    },
    enabled: id !== undefined,
    retry: shouldRetryQuery,
  });
}
