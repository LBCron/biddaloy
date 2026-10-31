/** Collections report — `GET /reports/collections` (JSON) and `.csv` (same query). Types come from `schema.d.ts`. */
import type { ReportDefinitionJson } from '@biddaloy/shared';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components, operations } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

type S = components['schemas'];
export type CollectionsReportResponse = S['CollectionsReportDto'];
export type CollectionsReportTotals = S['CollectionsReportTotals'];
export type CollectionsByMethod = S['CollectionsByMethod'];
export type CollectionsByCollector = S['CollectionsByCollector'];
export type CollectionsByFeeType = S['CollectionsByFeeType'];
export type CollectionsByDay = S['CollectionsByDay'];
export type CollectionsReportFilters =
  operations['ReportsController_getCollections_v1']['parameters']['query'];

export const collectionsReportKeys =
  createEntityKeys<CollectionsReportFilters>('reports-collections');

function toParams(filters: CollectionsReportFilters): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export function collectionsReportQueryOptions(filters: CollectionsReportFilters) {
  return queryOptions({
    queryKey: collectionsReportKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<CollectionsReportResponse>('/reports/collections', {
        params: toParams(filters),
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useCollectionsReport(filters: CollectionsReportFilters) {
  return useQuery(collectionsReportQueryOptions(filters));
}

/**
 * Fetches `/reports/collections.csv` through `apiClient` (so it carries
 * the same bearer-token/tenant headers every other request does — a
 * plain `<a href>` to this URL cannot, since auth here is a header set by
 * `apiClient`'s interceptor, not a cookie; see `ui/src/api/client.ts`)
 * and saves the response the same blob-URL way `ui/src/utils/csv.ts`'s
 * `downloadCsv` does for client-built CSVs.
 */
export async function downloadCollectionsReportCsv(
  filters: CollectionsReportFilters,
): Promise<void> {
  const res = await apiClient.get<Blob>('/reports/collections.csv', {
    params: toParams(filters),
    responseType: 'blob',
  });
  const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `collections-${filters.from}-to-${filters.to}.csv`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---------------------------------------------------------------------------
// [8.15.17] "Download everything that matches" on the six list screens
// ---------------------------------------------------------------------------

export type ListExportFormat = 'xlsx' | 'csv';

/** The six `GET <list>/export` routes (8.15.11). Each takes its list's own query plus `format`. */
export type ListExportPath =
  | '/students/export'
  | '/guardians/export'
  | '/invoices/export'
  | '/fees/dues/export'
  | '/payments/export'
  | '/audit-logs/export';

/** The server's synchronous export cap (more rows answer HTTP 413, `EXPORT_TOO_LARGE`). */
export const SYNC_EXPORT_MAX_ROWS = 5_000;

/**
 * More matching rows than one download holds. `rows` is the cap, not the number of matches.
 * Carries the machine code so a UI component can recognise it without importing this module.
 */
export class ExportTooLargeError extends Error {
  readonly code = 'EXPORT_TOO_LARGE' as const;
  readonly rows: number;

  constructor(rows: number = SYNC_EXPORT_MAX_ROWS) {
    super('EXPORT_TOO_LARGE');
    this.name = 'ExportTooLargeError';
    this.rows = rows;
  }
}

/** Keys an export never sends: it is every match, so the list's paging does not apply. */
const EXPORT_IGNORED_KEYS = new Set(['page', 'limit', 'format']);

function toExportParams(filters: object, format: ListExportFormat): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (EXPORT_IGNORED_KEYS.has(key)) continue;
    if (typeof value === 'string' && value !== '') params[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') params[key] = String(value);
  }
  params.format = format.toUpperCase();
  return params;
}

function filenameFromContentDisposition(header: string | undefined, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

/** Reads a 413 body (a `Blob`, since the request asked for one) and says whether it is `EXPORT_TOO_LARGE`. */
async function tooLargeFromBody(body: unknown): Promise<ExportTooLargeError | null> {
  try {
    const text = body instanceof Blob ? await body.text() : JSON.stringify(body);
    const details = (JSON.parse(text) as { details?: { code?: unknown; rows?: unknown } }).details;
    if (details?.code !== 'EXPORT_TOO_LARGE') return null;
    return new ExportTooLargeError(typeof details.rows === 'number' ? details.rows : undefined);
  } catch {
    return null;
  }
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // A later tick: Safari aborts an in-flight download if the URL is revoked in the same one.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Downloads every row that matches `filters` as Excel or CSV, through `apiClient` (a plain link
 * cannot carry the bearer and tenant headers). Throws `ExportTooLargeError` on HTTP 413
 * `EXPORT_TOO_LARGE`; any other failure is the usual `ApiError` / `Error` from `apiClient`.
 *
 * `validateStatus` lets the 413 resolve so its JSON body can be read: with `responseType: 'blob'`
 * a rejected response's body would be an unreadable blob that `apiClient` replaces with a generic
 * "too large to upload" error.
 */
export async function downloadListExport(
  path: ListExportPath,
  /** The list's own query (any of the list hooks' filter shapes); unset and empty values are dropped. */
  filters: object,
  format: ListExportFormat,
): Promise<void> {
  const res = await apiClient.get<Blob>(path, {
    params: toExportParams(filters, format),
    responseType: 'blob',
    validateStatus: (status) => (status >= 200 && status < 300) || status === 413,
  });
  if (res.status === 413) {
    throw (await tooLargeFromBody(res.data)) ?? new Error('Export refused (413)');
  }
  const blob =
    res.data instanceof Blob
      ? res.data
      : new Blob([res.data], {
          type: format === 'csv' ? 'text/csv' : 'application/octet-stream',
        });
  const base = path.split('/').filter(Boolean).slice(0, -1).pop() ?? 'export';
  saveBlob(
    blob,
    filenameFromContentDisposition(
      res.headers['content-disposition'] as string | undefined,
      `${base}.${format}`,
    ),
  );
}

// ---------------------------------------------------------------------------
// [8.15.54] Early BANBEIS student count (temporary — 8.15.32 replaces it)
// ---------------------------------------------------------------------------

export type StudentCountResponse = S['StudentCountDto'];
export type StudentCountRow = S['StudentCountRowDto'];
export type StaffCountRow = S['StaffCountRowDto'];

export const studentCountKeys = createEntityKeys<{ academic_year_id?: string }>('student-count');

/** `GET /reports/student-count` — the current year when no year is given. */
export function studentCountQueryOptions(academicYearId?: string) {
  return queryOptions({
    queryKey: studentCountKeys.list(academicYearId ? { academic_year_id: academicYearId } : {}),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StudentCountResponse>('/reports/student-count', {
        params: academicYearId ? { academic_year_id: academicYearId } : {},
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStudentCount(academicYearId?: string) {
  return useQuery(studentCountQueryOptions(academicYearId));
}

/** `GET /reports/student-count/export` — the class table or the staff table, as Excel or CSV. */
export async function downloadStudentCountExport(options: {
  academicYearId?: string;
  format?: ListExportFormat;
  table?: 'students' | 'staff';
}): Promise<void> {
  const format = options.format ?? 'xlsx';
  const table = options.table ?? 'students';
  const res = await apiClient.get<Blob>('/reports/student-count/export', {
    params: {
      ...(options.academicYearId ? { academic_year_id: options.academicYearId } : {}),
      format: format.toUpperCase(),
      table,
    },
    responseType: 'blob',
  });
  const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
  saveBlob(
    blob,
    filenameFromContentDisposition(
      res.headers['content-disposition'] as string | undefined,
      `student-count-${table}.${format}`,
    ),
  );
}

// ---------------------------------------------------------------------------
// [8.15.29] Reports hub and runner: the catalogue, one report's definition, a run, an export, and
// the one-tap "was this useful?" answer.
// ---------------------------------------------------------------------------

export type ReportCatalogueFolder = S['CatalogueFolderDto'];
export type ReportCatalogueEntry = S['CatalogueEntryDto'];
export type ReportDefinitionDetail = S['ReportDefinitionDetailDto'];

export const reportCatalogueKeys = createEntityKeys<Record<string, never>>('report-catalogue');
export const reportDefinitionKeys = createEntityKeys<Record<string, never>>('report-definition');

/** `GET /reports/catalogue` — the reports this role may run, grouped by folder (folder `null` first). */
export function reportCatalogueQueryOptions() {
  return queryOptions({
    queryKey: reportCatalogueKeys.list(),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ReportCatalogueFolder[]>('/reports/catalogue', { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useReportCatalogue() {
  return useQuery(reportCatalogueQueryOptions());
}

/**
 * `GET /reports/definitions/:id` — the layout and the prompts of one report. The server answers
 * only a caller who holds `REPORTS_DESIGN` (ADMIN), so everyone else gets a 403 here and the
 * runner shows a plain table instead. Follow-up: a catalogue-level endpoint for every viewer.
 */
export function reportDefinitionQueryOptions(id: string) {
  return queryOptions({
    queryKey: reportDefinitionKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ReportDefinitionDetail>(`/reports/definitions/${id}`, {
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useReportDefinition(id: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    ...reportDefinitionQueryOptions(id ?? ''),
    enabled: id !== undefined && options.enabled !== false,
  });
}

/** What a run returns. The server does not type it in `schema.d.ts`, so it is written here once. */
export interface ReportRunResponse {
  columns: {
    key: string;
    label_en: string;
    label_bn: string;
    type: 'TEXT' | 'NUMBER' | 'MONEY' | 'PERCENT' | 'DATE' | 'ENUM' | 'BOOLEAN';
    kind: 'dimension' | 'measure';
  }[];
  rows: Record<string, unknown>[];
  masked: string[];
  suppressed: boolean;
  truncated: boolean;
  total_rows: number;
  page: number;
  page_size: number;
  total_pages: number;
  run_id: string;
}

export interface RunReportInput {
  definitionId: string;
  /** The answers to the report's prompts, by parameter key. */
  params?: Record<string, unknown>;
  page?: number;
}

/**
 * `POST /reports/run`. A mutation, not a query: every run is written to the run log (and its
 * `run_id` is what "was this useful?" answers), so a refetch on focus or remount must never
 * start another one. The screen shows the failure in place, so the "could not confirm" toast is off.
 */
export function useRunReport() {
  return useMutation({
    mutationFn: async (input: RunReportInput) => {
      const res = await apiClient.post<ReportRunResponse>('/reports/run', {
        definitionId: input.definitionId,
        ...(input.params && Object.keys(input.params).length > 0 ? { params: input.params } : {}),
        ...(input.page && input.page > 1 ? { page: input.page } : {}),
      });
      return res.data;
    },
    meta: { handlesUnknownOutcome: true },
    retry: false,
  });
}

/** The code the server puts in `details.code` of a 422 run error (e.g. `REPORT_TOO_SLOW`). */
export function reportErrorCode(error: unknown): string | undefined {
  const details = (error as { details?: { code?: unknown } } | null | undefined)?.details;
  return typeof details?.code === 'string' ? details.code : undefined;
}

export interface ExportReportInput {
  definitionId: string;
  params?: Record<string, unknown>;
  format: ListExportFormat;
}

/** A file was saved, or the export was queued (HTTP 202) because it is large. */
export type ExportReportResult = { kind: 'file' } | { kind: 'queued'; runId: string };

async function queuedRunId(body: unknown): Promise<string | null> {
  try {
    const text = body instanceof Blob ? await body.text() : JSON.stringify(body);
    const runId = (JSON.parse(text) as { run_id?: unknown }).run_id;
    return typeof runId === 'string' ? runId : null;
  } catch {
    return null;
  }
}

/**
 * `POST /reports/runs/export` — everything the report matches (not only the shown page), as Excel
 * or CSV. Up to 5,000 rows come back as a file and are saved; more answer 202 and are queued.
 * Carries an `Idempotency-Key`, so a double click or a lost reply never starts two exports.
 */
export function useExportReport() {
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: ExportReportInput): Promise<ExportReportResult> => {
      const body = {
        definitionId: input.definitionId,
        ...(input.params ? { params: input.params } : {}),
        format: input.format.toUpperCase(),
      };
      const res = await apiClient.post<Blob>('/reports/runs/export', body, {
        headers: { 'Idempotency-Key': keyFor(body) },
        responseType: 'blob',
      });
      if (res.status === 202) {
        const runId = await queuedRunId(res.data);
        if (runId) return { kind: 'queued', runId };
      }
      const blob =
        res.data instanceof Blob
          ? res.data
          : new Blob([res.data], {
              type: input.format === 'csv' ? 'text/csv' : 'application/octet-stream',
            });
      saveBlob(
        blob,
        filenameFromContentDisposition(
          res.headers['content-disposition'] as string | undefined,
          `report.${input.format}`,
        ),
      );
      return { kind: 'file' };
    },
    onSuccess: rotate,
    // `ExportMenu` says what went wrong beside the button, so no "could not confirm" toast on top.
    meta: { handlesUnknownOutcome: true },
    retry: false,
  });
}

export interface ReportFeedbackInput {
  runId: string;
  helpful: boolean;
  comment?: string;
}

/**
 * `POST /reports/runs/:id/feedback` — "was this report useful?", once per run. A 409 means this run
 * was already answered; the screen treats it as done. Never retried, and the screen shows no toast.
 */
export function useReportFeedback() {
  return useMutation({
    mutationFn: async ({ runId, helpful, comment }: ReportFeedbackInput) => {
      const trimmed = comment?.trim();
      await apiClient.post(`/reports/runs/${runId}/feedback`, {
        helpful,
        ...(trimmed ? { comment: trimmed } : {}),
      });
    },
    meta: { handlesUnknownOutcome: true, handlesForbidden: true },
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// [8.15.41] The report designer: the fields a person may pick, a live preview, and saving
// ---------------------------------------------------------------------------

export type ReportMeta = S['ReportMetaDto'];
export type ReportMetaArea = S['MetaAreaDto'];
export type ReportDefinitionSummary = S['ReportDefinitionDto'];

export const reportMetaKeys = createEntityKeys<Record<string, never>>('report-meta');

/** `GET /reports/meta` — the fields and counts a report may use, in words, never SQL (D19). */
export function reportMetaQueryOptions() {
  return queryOptions({
    queryKey: reportMetaKeys.list(),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ReportMeta>('/reports/meta', { signal });
      return res.data;
    },
    // The registry changes only with a release.
    staleTime: 5 * 60 * 1000,
    retry: shouldRetryQuery,
  });
}

export function useReportMeta(options: { enabled?: boolean } = {}) {
  return useQuery({ ...reportMetaQueryOptions(), ...options });
}

export interface PreviewReportInput {
  /** The unsaved report, as the designer builds it. */
  definition: ReportDefinitionJson;
  /** Answers to the report's questions, by parameter key. */
  params?: Record<string, unknown>;
}

/**
 * `POST /reports/run` with an inline `definition`: a preview, which needs `REPORTS_DESIGN` and is
 * not written to the run log. A mutation so a refetch can never start one; the designer debounces
 * it and keeps the last good result itself. The screen shows the failure beside the control, so the
 * "could not confirm" toast is off.
 */
export function usePreviewReport() {
  return useMutation({
    mutationFn: async (input: PreviewReportInput) => {
      const res = await apiClient.post<ReportRunResponse>('/reports/run', {
        definition: input.definition,
        ...(input.params && Object.keys(input.params).length > 0 ? { params: input.params } : {}),
      });
      return res.data;
    },
    meta: { handlesUnknownOutcome: true },
    retry: false,
  });
}

export interface CreateReportInput {
  key: string;
  name_en: string;
  name_bn: string;
  folder?: string;
  visible_roles?: S['CreateReportDefinitionDto']['visible_roles'];
  definition: ReportDefinitionJson;
}

export interface UpdateReportInput {
  id: string;
  name_en?: string;
  name_bn?: string;
  folder?: string;
  visible_roles?: S['CreateReportDefinitionDto']['visible_roles'];
  definition?: ReportDefinitionJson;
}

/** A change to the catalogue or to one report: the hub, the runner and the editor read it again. */
function invalidateReports(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: reportCatalogueKeys.all });
  void queryClient.invalidateQueries({ queryKey: reportDefinitionKeys.all });
}

/**
 * `POST /reports/definitions` — a new draft. One `Idempotency-Key` per body, so a double click or a
 * lost reply never makes a second report. Never retried.
 */
export function useCreateReportDefinition() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: CreateReportInput) => {
      const res = await apiClient.post<ReportDefinitionDetail>('/reports/definitions', input, {
        headers: { 'Idempotency-Key': keyFor(input) },
      });
      return res.data;
    },
    onSuccess: () => {
      rotate();
      invalidateReports(queryClient);
    },
    meta: { handlesUnknownOutcome: true },
    retry: false,
  });
}

/** `PATCH /reports/definitions/:id` — change the draft (name, who sees it, the report itself). */
export function useUpdateReportDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateReportInput) => {
      const res = await apiClient.patch<ReportDefinitionDetail>(`/reports/definitions/${id}`, body);
      return res.data;
    },
    onSuccess: () => invalidateReports(queryClient),
    meta: { handlesUnknownOutcome: true },
    retry: false,
  });
}

/** `POST /reports/definitions/:id/publish` — "switch on for everyone": freezes the draft as the next version. */
export function usePublishReportDefinition() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ id: string; definition_id: string; version: number }>(
        `/reports/definitions/${id}/publish`,
        undefined,
        { headers: { 'Idempotency-Key': keyFor({ id }) } },
      );
      return res.data;
    },
    onSuccess: () => {
      rotate();
      invalidateReports(queryClient);
    },
    meta: { handlesUnknownOutcome: true },
    retry: false,
  });
}

/** `POST /reports/definitions/:id/clone` — a new draft from a ready report or one of your own. */
export function useCloneReportDefinition() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<ReportDefinitionDetail>(
        `/reports/definitions/${id}/clone`,
        undefined,
        { headers: { 'Idempotency-Key': keyFor({ id }) } },
      );
      return res.data;
    },
    onSuccess: () => {
      rotate();
      invalidateReports(queryClient);
    },
    meta: { handlesUnknownOutcome: true },
    retry: false,
  });
}
