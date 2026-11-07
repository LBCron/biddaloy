import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { userKeys } from './users';

/**
 * [23.9] client types for [23.2]'s `staff-hr-records`/`designations`
 * endpoints. `schema.d.ts` hasn't been regenerated for these routes yet
 * (23.2 merged after the last `generate:api-types` run), so these are
 * hand-typed from the actual entities/DTOs
 * (`server/src/modules/staff-hr/entities/*.entity.ts`,
 * `server/src/modules/staff-hr/dto/staff-hr-record.dto.ts`) rather than
 * `components['schemas'][...]`. Replace with the generated types once
 * `schema.d.ts` catches up — field names here already match the server's
 * actual response shape, so that swap should be a type-only change.
 */
export interface StaffHrRecord {
  id: string;
  user_id: string;
  index_no: string | null;
  salary_code: string | null;
  mpo_date: string | null;
  salary_scale: string | null;
  department: string | null;
  blood_group: string | null;
  /** Bangla name, printed on staff ID cards (Epic 32, D49). */
  name_bn: string | null;
  religion: string | null;
  /** Attendance card number (Epic 76), unique per school. */
  card_no: string | null;
  created_at: string;
  updated_at: string;
}

export type StaffEmploymentStatus = 'REGULAR' | 'IRREGULAR' | 'RESIGNED';

export interface StaffDesignationHistory {
  id: string;
  user_id: string;
  designation_id: string;
  effective_date: string;
  end_date: string | null;
  status: StaffEmploymentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Designation {
  id: string;
  title_en: string;
  title_bn: string | null;
  is_teaching: boolean;
}

/** The designation title in the UI's current locale, falling back to
 * English when there's no Bengali title (or the locale isn't Bengali). */
export const designationTitle = (
  designation: Pick<Designation, 'title_en' | 'title_bn'>,
  locale: string,
): string =>
  locale === 'bn' ? (designation.title_bn ?? designation.title_en) : designation.title_en;

export interface CreateStaffHrRecordInput {
  user_id: string;
  index_no?: string;
  salary_code?: string;
  mpo_date?: string;
  salary_scale?: string;
  department?: string;
  blood_group?: string;
  name_bn?: string;
  religion?: string;
}

export interface UpdateStaffHrRecordInput {
  index_no?: string | null;
  salary_code?: string | null;
  mpo_date?: string | null;
  salary_scale?: string | null;
  department?: string | null;
  blood_group?: string | null;
  name_bn?: string | null;
  religion?: string | null;
  card_no?: string | null;
}

export interface PromoteStaffInput {
  designation_id: string;
  effective_date: string;
  notes?: string;
}

/** [23.6]'s `StaffDocument` — one row per (staff, document_type); the
 * unique index means a second upload of the same type replaces the row
 * rather than adding another. */
export type StaffDocumentType = 'NID' | 'BIRTH_CERTIFICATE' | 'PHOTO' | 'OTHER';

export interface StaffDocument {
  id: string;
  staff_user_id: string;
  document_type: StaffDocumentType;
  original_filename: string;
  content_type: string;
  created_at: string;
  updated_at: string;
}

export const staffHrRecordKeys = createEntityKeys<{ user_id?: string }>('staff-hr-records');
export const designationHistoryKeys = createEntityKeys<{ user_id: string }>(
  'staff-designation-history',
);
export const designationKeys = createEntityKeys('designations');
export const staffDocumentKeys = createEntityKeys<{ staff_user_id: string }>('staff-documents');

/** One user's HR record, if one exists yet — [23.9]'s job-info section.
 * `GET /staff-hr-records` has no single-record-by-user route, so this
 * filters server-side with `user_id` (same shape as `useTeachers`'s
 * `user_id` filter) and takes the one row a tenant-scoped unique index
 * guarantees is at most one. */
export function staffHrRecordQueryOptions(userId: string) {
  return queryOptions({
    queryKey: staffHrRecordKeys.list({ user_id: userId }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StaffHrRecord[]>('/staff-hr-records', {
        params: { user_id: userId },
        signal,
      });
      return res.data[0] ?? null;
    },
    retry: shouldRetryQuery,
  });
}

export function useStaffHrRecord(userId: string) {
  return useQuery(staffHrRecordQueryOptions(userId));
}

/** Every designation-history row for one user, newest first — [23.9]'s
 * promotion timeline. */
export function staffDesignationHistoryQueryOptions(userId: string) {
  return queryOptions({
    queryKey: designationHistoryKeys.list({ user_id: userId }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StaffDesignationHistory[]>(
        `/staff-hr-records/${userId}/designation-history`,
        { signal },
      );
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStaffDesignationHistory(userId: string) {
  return useQuery(staffDesignationHistoryQueryOptions(userId));
}

/** The tenant's designation (job title) list — needed to label a history
 * row's `designation_id` and to populate the promote dialog's picker.
 * Small, tenant-wide, no pagination needed (same "whole list fits one
 * page" reasoning as `teachers.ts`'s `TEACHER_FILTER_LIMIT`). */
export function designationsQueryOptions() {
  return queryOptions({
    queryKey: designationKeys.lists(),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Designation[]>('/designations', { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useDesignations() {
  return useQuery(designationsQueryOptions());
}

export function useCreateStaffHrRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateStaffHrRecordInput) => {
      const res = await apiClient.post<StaffHrRecord>('/staff-hr-records', input);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: staffHrRecordKeys.list({ user_id: variables.user_id }),
      });
    },
  });
}

export function useUpdateStaffHrRecord(id: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateStaffHrRecordInput) => {
      const res = await apiClient.patch<StaffHrRecord>(`/staff-hr-records/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: staffHrRecordKeys.list({ user_id: userId }),
      });
    },
  });
}

/** [23.2]'s atomic close-then-insert promotion (D7). */
export function usePromoteStaff(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PromoteStaffInput) => {
      const res = await apiClient.post<StaffDesignationHistory>(
        `/staff-hr-records/${userId}/promote`,
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: designationHistoryKeys.list({ user_id: userId }),
      });
      void queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

/** One staff member's uploaded documents — [23.11]'s documents section. */
export function staffDocumentsQueryOptions(staffUserId: string) {
  return queryOptions({
    queryKey: staffDocumentKeys.list({ staff_user_id: staffUserId }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StaffDocument[]>(`/staff-documents/${staffUserId}`, {
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStaffDocuments(staffUserId: string) {
  return useQuery(staffDocumentsQueryOptions(staffUserId));
}

/** `POST /staff-documents/:staffUserId/:documentType` (23.6) — also the
 * *replace* flow: the server upserts on the tenant/staff/type unique
 * index, so uploading over an existing slot just swaps the file. */
export function useUploadStaffDocument(staffUserId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      documentType,
      file,
      onProgress,
    }: {
      documentType: StaffDocumentType;
      file: File;
      onProgress?: (percent: number) => void;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<StaffDocument>(
        `/staff-documents/${staffUserId}/${documentType}`,
        formData,
        {
          onUploadProgress: (event) => {
            if (onProgress && event.total) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          },
        },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: staffDocumentKeys.list({ staff_user_id: staffUserId }),
      });
    },
  });
}

/**
 * [23.10] Generic client half of [23.3]'s "GET the list, PUT the full
 * replacement array" pattern — one `GET`/`PUT /staff/:userId/<resource>`
 * pair per HR section (family/address/experience/education/training/
 * achievement/language), all with the identical `{ rows: T[] }` shape.
 * Row types below are hand-typed from the actual DTOs
 * (`server/src/modules/staff-hr/dto/repeatable-row.dto.ts`), same
 * `schema.d.ts`-not-regenerated-yet reasoning as `StaffHrRecord` above.
 */
export interface FamilyMemberRow {
  id?: string;
  relation: string;
  name: string;
  occupation?: string;
  contact?: string;
}

export interface AddressRow {
  id?: string;
  type: 'PRESENT' | 'PERMANENT';
  village_street?: string;
  post_office?: string;
  upazila?: string;
  district?: string;
}

export interface ExperienceRow {
  id?: string;
  institution: string;
  designation: string;
  from_date: string;
  to_date?: string;
  description?: string;
}

export interface EducationRow {
  id?: string;
  degree: string;
  institution: string;
  board_university?: string;
  result?: string;
  passing_year?: string;
}

export interface TrainingRow {
  id?: string;
  title: string;
  institution: string;
  from_date: string;
  to_date?: string;
  certificate_no?: string;
}

export interface AchievementRow {
  id?: string;
  title: string;
  description?: string;
  date?: string;
  issued_by?: string;
}

export interface LanguageRow {
  id?: string;
  language_name: string;
  proficiency?: string;
}

/** One entry per section's `PUT` path segment — the only thing that
 * differs between the 7 endpoints. */
export const STAFF_ROW_RESOURCES = [
  'family',
  'address',
  'experience',
  'education',
  'training',
  'achievement',
  'language',
] as const;
export type StaffRowResource = (typeof STAFF_ROW_RESOURCES)[number];

function staffRowKeys(resource: StaffRowResource) {
  return createEntityKeys<{ user_id: string }>(`staff-${resource}`);
}

export function staffRowsQueryOptions<T>(resource: StaffRowResource, userId: string) {
  return queryOptions({
    queryKey: staffRowKeys(resource).list({ user_id: userId }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<T[]>(`/staff/${userId}/${resource}`, { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStaffRows<T>(resource: StaffRowResource, userId: string) {
  return useQuery(staffRowsQueryOptions<T>(resource, userId));
}

export function useReplaceStaffRows<T>(resource: StaffRowResource, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: T[]) => {
      const res = await apiClient.put<T[]>(`/staff/${userId}/${resource}`, { rows });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: staffRowKeys(resource).list({ user_id: userId }),
      });
    },
  });
}

/** Reads the filename `Content-Disposition` carries, same parsing as
 * `backup.ts`'s (module-private there — three lines, not worth an import
 * for). */
function filenameFromContentDisposition(header: string | undefined, fallback: string): string {
  if (!header) return fallback;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // fall through to the plain filename= match below
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(header);
  return plainMatch?.[1] ?? fallback;
}

/** `GET /staff-documents/download/:id` — authenticated download via
 * `apiClient` (auth headers, 401-refresh) rather than a bare `fetch`,
 * saved with a throwaway anchor, same mechanism as `backup.ts`'s
 * `downloadBackup`. */
export async function downloadStaffDocument(doc: StaffDocument): Promise<void> {
  const res = await apiClient.get<Blob>(`/staff-documents/download/${doc.id}`, {
    responseType: 'blob',
  });
  const filename = filenameFromContentDisposition(
    res.headers['content-disposition'] as string | undefined,
    doc.original_filename,
  );
  const url = URL.createObjectURL(res.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
