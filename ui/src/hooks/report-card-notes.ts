/** [70.4.1] Remark + conduct grades for one section, per exam or final result (D7, D13).
 * Class-teacher route: `/my-class/sections/:sectionId/report-card-notes`. The target goes
 * in the query as `exam_id` or `final_result_id` (exactly one). Saves are upserts by
 * (student, target), so they carry no `Idempotency-Key`. */
import type { ConductGrade, ConductItem } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type ReportCardNotesTarget = { exam_id: string } | { final_result_id: string };

export interface ReportCardNotesRow {
  student_id: string;
  full_name: string;
  full_name_bn: string | null;
  roll_number: number;
  remark: string | null;
  conduct: Record<string, ConductGrade>;
}

export interface ReportCardNotesView {
  target: { exam_id: string | null; final_result_id: string | null };
  section_id: string;
  /** True once the exam / final result is published (a reopen unlocks it). */
  locked: boolean;
  conduct_items: ConductItem[];
  rows: ReportCardNotesRow[];
}

export interface ReportCardNotesMissing {
  total: number;
  missing_remark: number;
  missing_conduct: number;
}

export type SaveReportCardNotesInput = components['schemas']['SaveReportCardNotesBodyDto'];

export const reportCardNotesKeys = createEntityKeys('report-card-notes');
const notesKey = (sectionId: string, target: ReportCardNotesTarget) =>
  [...reportCardNotesKeys.all, sectionId, target] as const;

const base = (sectionId: string) => `/my-class/sections/${sectionId}/report-card-notes`;

export function reportCardNotesQueryOptions(sectionId: string, target: ReportCardNotesTarget) {
  return queryOptions({
    queryKey: notesKey(sectionId, target),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ReportCardNotesView>(base(sectionId), { params: target, signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useReportCardNotes(
  sectionId: string | undefined,
  target: ReportCardNotesTarget | undefined,
) {
  return useQuery({
    ...reportCardNotesQueryOptions(sectionId ?? '', target ?? { exam_id: '' }),
    enabled: Boolean(sectionId && target),
  });
}

/** How many students of the section still lack a remark or full conduct grades. */
export function useReportCardNotesMissing(
  sectionId: string | undefined,
  target: ReportCardNotesTarget | undefined,
) {
  return useQuery({
    queryKey: [...notesKey(sectionId ?? '', target ?? { exam_id: '' }), 'missing'] as const,
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<ReportCardNotesMissing>(`${base(sectionId ?? '')}/missing`, {
          params: target,
          signal,
        })
      ).data,
    enabled: Boolean(sectionId && target),
    retry: shouldRetryQuery,
  });
}

export function useSaveReportCardNotes(sectionId: string, target: ReportCardNotesTarget) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveReportCardNotesInput) => {
      await apiClient.put(base(sectionId), input, { params: target });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['final-results'] });
      return queryClient.invalidateQueries({ queryKey: reportCardNotesKeys.all });
    },
    retry: false,
  });
}
