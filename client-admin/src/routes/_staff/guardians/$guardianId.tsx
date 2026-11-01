import { Permission } from '@biddaloy/shared';
import { ApiError, isNotFoundError } from '@biddaloy/ui/api';
import {
  ErrorState,
  RecordNotFoundState,
  RoutePending,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import { guardianQueryOptions, useGuardian, useHasPermission } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useCloseFullPage, useDetailShellTab } from '@biddaloy/ui/shells';
import { formatNumber, formatPhone } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { HandCoinsIcon, MessageSquareTextIcon, PencilIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { CommunicationTab } from './-detail/communication-tab';
import { InformationTab } from './-detail/information-tab';
import { LinkedStudentsTab } from './-detail/linked-students-tab';
import { PaymentsTab } from './-detail/payments-tab';
import { EditGuardianDialog } from './-edit-guardian-dialog';
import { relationshipLabel } from './-relationship-label';

const guardianDetailSearchSchema = z.object({
  // `useDetailShellTab` falls back to the first tab for anything not in
  // its own `tabIds` list, so an invalid value here isn't validated away
  // by the schema — it's handled once, there, not duplicated here.
  tab: z.string().optional(),
  // `?edit=1` opens the full-page edit form (there is no edit route, D1).
  edit: z.number().optional().catch(undefined),
});

const TAB_IDS = ['information', 'linkedStudents', 'communication', 'payments'] as const;

/**
 * [8.11.4] — a standalone guardian page (Information, Linked Students,
 * Communication History, Payment History), mirroring
 * `students/$studentId.tsx`'s own `DetailShell`/`useDetailShellTab`
 * structure, so staff can find a guardian and see every student they're
 * responsible for without going through a student first.
 */
export const Route = createFileRoute('/_staff/guardians/$guardianId')({
  validateSearch: guardianDetailSearchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient
        .ensureQueryData(guardianQueryOptions(params.guardianId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('guardians', 'common', 'payments'),
    ]),
  pendingComponent: GuardianDetailPending,
  component: GuardianDetailPage,
});

function GuardianDetailPage() {
  const { guardianId } = Route.useParams();
  const { t } = useTranslation('guardians');
  const guardianQuery = useGuardian(guardianId);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);

  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const closeEdit = useCloseFullPage(
    React.useCallback(
      () => void navigate({ search: (prev) => ({ ...prev, edit: undefined }), replace: true }),
      [navigate],
    ),
  );

  const canUpdate = useHasPermission(Permission.GUARDIAN_UPDATE);
  const canSeeMessages = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  const canRecord = useHasPermission(Permission.PAYMENT_RECORD);
  // Payment/Communication tabs format currency and dates against the
  // active tenant's own region — same reasoning as `students/$studentId
  // .tsx`'s own `RegionConfigProvider` wrap: without it, every phone
  // number and amount on this page would silently fall back to
  // `RegionConfigProvider`'s hardcoded default region rather than the
  // active tenant's actual one.
  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <div className="flex flex-col gap-4">
        {guardianQuery.isPending ? (
          <Skeleton className="h-7 w-64" />
        ) : isNotFoundError(guardianQuery.error) ? (
          <RecordNotFoundState onBack={() => void navigate({ to: '/guardians' })} />
        ) : guardianQuery.isError ? (
          <ErrorState
            message={
              guardianQuery.error instanceof ApiError && guardianQuery.error.statusCode === 403
                ? t('detail.forbidden')
                : t('detail.loadError')
            }
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void guardianQuery.refetch()}
          />
        ) : (
          <>
            <DetailShell
              name={guardianQuery.data.full_name}
              facts={[
                {
                  label: t('detail.information.columnRelationship'),
                  value: relationshipLabel(guardianQuery.data.relationship, t),
                },
                {
                  label: t('detail.information.columnPhone'),
                  value: guardianQuery.data.phone
                    ? formatPhone(guardianQuery.data.phone, regionConfig)
                    : t('detail.information.emptyValue'),
                },
                {
                  label: t('detail.information.columnPreferredCommunication'),
                  value: t(
                    `preferredCommunicationOptions.${guardianQuery.data.preferred_communication}`,
                  ),
                },
                {
                  label: t('list.columnLinkedStudents'),
                  value: t('detail.facts.studentCount', {
                    count: guardianQuery.data.students.length,
                    n: formatNumber(guardianQuery.data.students.length, regionConfig),
                  }),
                },
              ]}
              statusBadge={
                <StatusBadge
                  domain="guardian"
                  status={guardianQuery.data.is_primary_contact ? 'PRIMARY' : 'SECONDARY'}
                />
              }
              actions={[
                {
                  id: 'edit',
                  label: t('detail.actions.edit'),
                  icon: <PencilIcon aria-hidden="true" />,
                  allowed: canUpdate,
                  priority: 'secondary',
                  onClick: () => void navigate({ search: (prev) => ({ ...prev, edit: 1 }) }),
                },
                {
                  id: 'record-payment',
                  helpId: 'people.guardians.action.recordPayment',
                  label: t('recordAction', { ns: 'payments' }),
                  icon: <HandCoinsIcon aria-hidden="true" />,
                  allowed: canRecord,
                  priority: 'primary',
                  onClick: () =>
                    void navigate({
                      to: '/payments',
                      search: { record: '1', guardian_id: guardianId },
                    }),
                },
                {
                  id: 'messages',
                  label: t('detail.actions.messages'),
                  icon: <MessageSquareTextIcon aria-hidden="true" />,
                  allowed: canSeeMessages,
                  priority: 'secondary',
                  to: '/communications/message-log',
                  search: { guardian: guardianId },
                },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              tabs={[
                {
                  id: 'information',
                  label: t('detail.tabs.information'),
                  content: <InformationTab guardianId={guardianId} />,
                },
                {
                  id: 'linkedStudents',
                  label: t('detail.tabs.linkedStudents'),
                  content: <LinkedStudentsTab guardianId={guardianId} />,
                },
                {
                  id: 'communication',
                  label: t('detail.tabs.communication'),
                  content: <CommunicationTab guardianId={guardianId} />,
                },
                {
                  id: 'payments',
                  label: t('detail.tabs.payments'),
                  content: <PaymentsTab guardianId={guardianId} />,
                },
              ]}
            />

            {search.edit === 1 && canUpdate && (
              <EditGuardianDialog
                guardian={guardianQuery.data}
                config={regionConfig}
                onClose={closeEdit}
              />
            )}
          </>
        )}
      </div>
    </RegionConfigProvider>
  );
}

function GuardianDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
