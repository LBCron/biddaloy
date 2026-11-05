/**
 * [48.3.03] Exam-document client hooks — admit-card roster, merit candidates,
 * tabulation, yearly transcript, and the family (portal) admit card.
 *
 * Response and body types come from `schema.d.ts` (the exam-documents
 * controllers declare `@ApiOkResponse`). The transcript and the family admit
 * card have no decorated response, so those are hand-typed here.
 *
 * `logDocumentPrint` and `printFamilyAdmitCard` are plain functions, not
 * hooks: the screens call them inside `openPrintWindow`'s `prepare` step
 * (log first, draw second — Epic 32 D9), where a hook cannot be called.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import type { StudentResultCard } from './exams';
import type { FinalCard } from './final-results';
import type { CreatePrintJobResult } from './print';
import { shouldRetryQuery } from './retry';

export type AdmitCardRoster = components['schemas']['AdmitCardRosterDto'];
export type AdmitCardStudent = components['schemas']['AdmitCardStudentDto'];
export type MeritCandidate = components['schemas']['MeritCandidateDto'];
export type Tabulation = components['schemas']['TabulationDto'];
export type DocumentPrintInput = components['schemas']['DocumentPrintDto'];

export type MeritScope = 'CLASS' | 'SECTION';

/** One student's published exams of a year, report-card data each. */
export interface Transcript {
  student: {
    id: string;
    full_name: string;
    roll_number: number;
    class_name: string;
    section_name: string | null;
  };
  academic_year: { id: string; name: string };
  exams: StudentResultCard[];
  /** The year's PUBLISHED final result for this student (D9, published-only for everyone);
   * null when there is none. Staff preview a PROCESSED final through `useStudentFinalCard`. */
  final: FinalCard | null;
}

export const examDocumentKeys = {
  admitCards: (examId: string | undefined) => ['exam-documents', examId, 'admit-cards'] as const,
  merit: (examId: string | undefined, scope: MeritScope | undefined, top: number | undefined) =>
    ['exam-documents', examId, 'merit', scope, top] as const,
  tabulation: (examId: string | undefined, sectionId: string | undefined) =>
    ['exam-documents', examId, 'tabulation', sectionId] as const,
  transcript: (studentId: string | undefined, yearId: string | undefined) =>
    ['students', studentId, 'transcript', yearId] as const,
};

export function admitCardRosterQueryOptions(examId: string | undefined) {
  return queryOptions({
    queryKey: examDocumentKeys.admitCards(examId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<AdmitCardRoster>(`/exams/${examId}/documents/admit-cards`, {
          signal,
        })
      ).data,
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useAdmitCardRoster(examId: string | undefined) {
  return useQuery(admitCardRosterQueryOptions(examId));
}

export function useMeritCandidates(
  examId: string | undefined,
  options: { scope?: MeritScope; top?: number } = {},
) {
  const { scope, top } = options;
  return useQuery({
    queryKey: examDocumentKeys.merit(examId, scope, top),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<MeritCandidate[]>(`/exams/${examId}/documents/merit-candidates`, {
          // `undefined` params are dropped by axios, so the server default applies.
          params: { scope, top },
          signal,
        })
      ).data,
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useTabulation(examId: string | undefined, sectionId: string | undefined) {
  return useQuery({
    queryKey: examDocumentKeys.tabulation(examId, sectionId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<Tabulation>(`/exams/${examId}/documents/tabulation`, {
          params: { section_id: sectionId },
          signal,
        })
      ).data,
    enabled: examId !== undefined && sectionId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useTranscript(studentId: string | undefined, academicYearId: string | undefined) {
  return useQuery({
    queryKey: examDocumentKeys.transcript(studentId, academicYearId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<Transcript>(`/students/${studentId}/transcript`, {
          params: { academic_year_id: academicYearId },
          signal,
        })
      ).data,
    enabled: studentId !== undefined && academicYearId !== undefined,
    retry: shouldRetryQuery,
  });
}

/** Audit-logs one report-card or transcript print; resolves on 204. */
export async function logDocumentPrint(studentId: string, body: DocumentPrintInput): Promise<void> {
  await apiClient.post(`/students/${studentId}/document-prints`, body);
}

/**
 * The family's own admit card. Each call is a logged copy. A 409 whose
 * `details.code` is `ADMIT_CARD_WITHHELD` means fees are due; the portal
 * reads that code to show the withheld message.
 */
export async function printFamilyAdmitCard(
  studentId: string,
  examId: string,
): Promise<CreatePrintJobResult> {
  return (
    await apiClient.post<CreatePrintJobResult>(
      `/students/${studentId}/exams/${examId}/admit-card`,
      {},
    )
  ).data;
}

/** The `assetPath` base `runPrint` fetches artwork and fonts from for this admit card. */
export function familyAdmitCardAssetBase(studentId: string, examId: string): string {
  return `/students/${studentId}/exams/${examId}/admit-card/assets`;
}
