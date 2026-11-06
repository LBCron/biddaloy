import { ApiError, isNotFoundError } from '@biddaloy/ui/api';
import { ErrorState, RecordNotFoundState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import { studentQueryOptions, useStudent, useUpdateStudent } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { StudentForm } from './-student-form';
import { buildUpdatePayload, studentToFormValues } from './-student-form-schema';

/**
 * `/students/$studentId/edit` — [8.10.3]'s real Edit Student form,
 * replacing the placeholder [8.10.2] left here (its detail page's Edit
 * action already links here). Same `StudentForm` as `new.tsx`, prefilled
 * from `useStudent`, whose `studentQueryOptions(studentId)` cache entry
 * `$studentId.tsx` (the detail page this is usually reached from) has
 * often already warmed — but [8.14.5] adds this route's own `loader`
 * anyway, for the deep-link case where a bookmark or a shared URL lands
 * here first, with nothing upstream to have warmed the cache.
 */
export const Route = createFileRoute('/_staff/students/$studentId_/edit')({
  staticData: { chromeless: true },
  // [76.5.07] `?focus=card` (the "Assign card" palette action) opens with the card field focused.
  validateSearch: (search: Record<string, unknown>): { focus?: 'card' } =>
    search.focus === 'card' ? { focus: 'card' } : {},
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient
        .ensureQueryData(studentQueryOptions(params.studentId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('students'),
    ]),
  pendingComponent: EditStudentPending,
  component: EditStudentPage,
});

function EditStudentPage() {
  const { studentId } = Route.useParams();
  const { focus } = Route.useSearch();
  const { t } = useTranslation('students');
  const navigate = useNavigate();
  const config = useTenantRegionConfig();
  const studentQuery = useStudent(studentId);
  const mutation = useUpdateStudent(studentId);
  // Built once per loaded student so a background refetch does not move the diff baseline.
  const initialValues = React.useMemo(
    () => (studentQuery.data ? studentToFormValues(studentQuery.data) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studentQuery.data?.id],
  );
  const toDetail = () => void navigate({ to: '/students/$studentId', params: { studentId } });

  return (
    <RegionConfigProvider value={config}>
      {studentQuery.isPending || studentQuery.isError ? (
        <FullPageShell
          title={t('edit.title')}
          onClose={toDetail}
          primary={{ label: t('edit.submitAction'), onClick: () => {}, disabled: true }}
        >
          {studentQuery.isPending ? (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl p-4">
              {isNotFoundError(studentQuery.error) ? (
                <RecordNotFoundState onBack={() => void navigate({ to: '/students' })} />
              ) : (
                <ErrorState
                  message={
                    studentQuery.error instanceof ApiError && studentQuery.error.statusCode === 403
                      ? t('detail.forbidden')
                      : t('detail.loadError')
                  }
                  onRetry={() => void studentQuery.refetch()}
                />
              )}
            </div>
          )}
        </FullPageShell>
      ) : initialValues ? (
        <StudentForm
          title={t('edit.title')}
          onClose={toDetail}
          initialValues={initialValues}
          initialGuardians={studentQuery.data.guardians}
          autosaveKey={studentId}
          submitLabel={t('edit.submitAction')}
          mutation={mutation}
          buildPayload={(values) => buildUpdatePayload(values, initialValues)}
          disableSubmitWhenClean
          focusCard={focus === 'card'}
          onSuccess={toDetail}
        />
      ) : null}
    </RegionConfigProvider>
  );
}

function EditStudentPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
