/**
 * [8.15.38] A student's statement — `GET /students/:id/statement` (staff) and
 * `GET /portal/students/:id/statement` (a guardian, linked children only). Both answer with the same
 * `StudentStatementDto`, so a closing balance is the same number on either screen.
 *
 * Money words: the API names the columns `debit` / `credit` / `balance`; screens say
 * বিল (charged) / জমা (paid) / বাকি (still owed). See `docs/ux-research/8.15-reports-glossary.md`.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { paymentKeys } from './payments';
import { shouldRetryQuery } from './retry';

type S = components['schemas'];
export type StudentStatement = S['StudentStatementDto'];
export type StatementEntry = S['StatementEntryDto'];
export type StatementWalletMove = S['WalletMoveDto'];

export type StatementAudience = 'staff' | 'portal';

export interface StudentStatementParams {
  studentId: string;
  /** `staff` for the student's Fees tab, `portal` for a guardian. */
  audience: StatementAudience;
  /** First day shown, `YYYY-MM-DD`. Earlier entries fold into the opening balance. */
  from?: string | undefined;
  /** Last day shown, `YYYY-MM-DD`. Leave out for everything. */
  to?: string | undefined;
}

/**
 * Under `paymentKeys.all` on purpose: recording or reversing a payment already invalidates that
 * prefix, so an open statement refreshes without a second invalidation call anywhere.
 */
export const studentStatementKeys = {
  all: [...paymentKeys.all, 'statement'] as const,
  detail: (params: StudentStatementParams) =>
    [
      ...paymentKeys.all,
      'statement',
      params.audience,
      params.studentId,
      { from: params.from ?? null, to: params.to ?? null },
    ] as const,
};

export function studentStatementQueryOptions(params: StudentStatementParams) {
  const base = params.audience === 'portal' ? '/portal/students' : '/students';
  return queryOptions({
    queryKey: studentStatementKeys.detail(params),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StudentStatement>(`${base}/${params.studentId}/statement`, {
        params: {
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
        },
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/** `enabled: false` keeps the query parked until the caller knows the student and may read it. */
export function useStudentStatement(
  params: Omit<StudentStatementParams, 'studentId'> & { studentId: string | undefined },
  options: { enabled?: boolean } = {},
) {
  const { studentId } = params;
  return useQuery({
    ...studentStatementQueryOptions({ ...params, studentId: studentId ?? '' }),
    enabled: studentId !== undefined && (options.enabled ?? true),
  });
}
