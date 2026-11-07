/**
 * Exam results on the school website (Epic 40, W5). Every type comes from the generated
 * `schema.d.ts`. Mutations: `retry: false` (Rule 25); publish and unpublish carry an
 * `Idempotency-Key`. Each one refreshes the exam, whose `website_published_at` and
 * `website_show_names` the detail page reads.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { examKeys } from './exams';
import { useIdempotencyKey } from './idempotency-key';

export type WebsiteResultsState = components['schemas']['WebsiteResultsStateDto'];
export type WebsiteNamesInput = components['schemas']['WebsiteNamesDto'];

function useInvalidateExam(examId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: examKeys.detail(examId) }),
      qc.invalidateQueries({ queryKey: examKeys.lists() }),
    ]);
}

export function usePublishExamWebsite(examId: string) {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateExam(examId);
  return useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<WebsiteResultsState>(`/exams/${examId}/website-publish`, undefined, {
          headers: { 'Idempotency-Key': keyFor({ examId, action: 'publish' }) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      return invalidate();
    },
    retry: false,
  });
}

export function useUnpublishExamWebsite(examId: string) {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateExam(examId);
  return useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<WebsiteResultsState>(`/exams/${examId}/website-unpublish`, undefined, {
          headers: { 'Idempotency-Key': keyFor({ examId, action: 'unpublish' }) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      return invalidate();
    },
    retry: false,
  });
}

export function useSetExamWebsiteNames(examId: string) {
  const invalidate = useInvalidateExam(examId);
  return useMutation({
    mutationFn: async (input: WebsiteNamesInput) =>
      (await apiClient.patch<WebsiteNamesInput>(`/exams/${examId}/website-names`, input)).data,
    onSuccess: invalidate,
    retry: false,
  });
}
