/**
 * [8.11.4]'s standalone Guardians list — server-side debounced search,
 * paginated, mirroring `students/index.tsx`'s own list page. `Guardian`
 * has no class/section of its own the way `Student` does, so this page
 * has no equivalent filter dropdowns — search is the only filter.
 */
import { CommunicationMedium, Permission } from '@biddaloy/shared';
import {
  ExportMenu,
  RoutePending,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  downloadListExport,
  guardiansQueryOptions,
  useGuardians,
  useHasPermission,
  type Guardian,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatNumber, formatPhone } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { SendIcon } from 'lucide-react';
import { z } from 'zod';

import { useLandingFlag } from '../-use-landing-flag';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { InviteGuardiansDialog } from './-invite-guardians-dialog';
import { RELATIONSHIP_VALUES, relationshipLabel } from './-relationship-label';

interface GuardianFilters {
  search?: string | undefined;
  relationship?: string | undefined;
  preferred_communication?: string | undefined;
  is_primary_contact?: string | undefined;
  incomplete?: string | undefined;
}

const guardiansSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  invite: z.coerce.string().optional().catch(undefined),
  limit: z.number().int().positive().max(100).optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  relationship: z.string().optional().catch(undefined),
  preferred_communication: z.string().optional().catch(undefined),
  is_primary_contact: z.string().optional().catch(undefined),
  // [8.10.7.5.05] D33 — only `1` is meaningful (dashboard card deep link).
  incomplete: z.coerce.number().int().pipe(z.literal(1)).optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under —
  // must be declared here or TanStack Router's `validateSearch` strips it
  // from the URL. This page wires no bulk actions today, but keeping the
  // key here matches every other list route's search schema.
  selected: z.string().optional().catch(undefined),
});

const SORT_FIELD_BY_COLUMN: Partial<Record<string, 'full_name' | 'created_at'>> = {
  name: 'full_name',
};

export const Route = createFileRoute('/_staff/guardians/')({
  validateSearch: guardiansSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 25,
    sort: search.sort,
    order: search.order,
    search: search.search,
    relationship: search.relationship,
    preferredCommunication: search.preferred_communication,
    isPrimaryContact: search.is_primary_contact,
    incomplete: search.incomplete,
  }),
  loader: ({ context: { queryClient }, deps }) => {
    const sortField = deps.sort !== undefined ? SORT_FIELD_BY_COLUMN[deps.sort] : undefined;
    return Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          guardiansQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...(deps.search !== undefined ? { search: deps.search } : {}),
            ...(deps.relationship !== undefined ? { relationship: deps.relationship } : {}),
            ...(deps.preferredCommunication !== undefined
              ? { preferred_communication: deps.preferredCommunication as CommunicationMedium }
              : {}),
            ...(deps.isPrimaryContact !== undefined
              ? { is_primary_contact: deps.isPrimaryContact === 'true' }
              : {}),
            ...(deps.incomplete === 1 ? { incomplete: true } : {}),
            ...(sortField !== undefined ? { sort: sortField } : {}),
            ...(deps.order !== undefined ? { order: deps.order } : {}),
          }),
        )
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('guardians'),
    ]);
  },
  pendingComponent: GuardiansListPending,
  component: GuardiansListPage,
});

function GuardiansListPage() {
  const { t } = useTranslation('guardians');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState();
  const filters = state.filters as GuardianFilters;
  const canInvite = useHasPermission(Permission.USER_CREATE);
  const canExportAll = useHasPermission(Permission.REPORTS_EXPORT);
  const [inviteOpen, setInviteOpen] = useLandingFlag('invite', canInvite);

  const sortField = state.sorting ? SORT_FIELD_BY_COLUMN[state.sorting.id] : undefined;
  const guardianListFilters = {
    page: state.page,
    limit: state.limit,
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(filters.relationship !== undefined ? { relationship: filters.relationship } : {}),
    ...(filters.preferred_communication !== undefined
      ? {
          preferred_communication: filters.preferred_communication as CommunicationMedium,
        }
      : {}),
    ...(filters.is_primary_contact !== undefined
      ? { is_primary_contact: filters.is_primary_contact === 'true' }
      : {}),
    ...(filters.incomplete === '1' ? { incomplete: true } : {}),
    ...(sortField !== undefined ? { sort: sortField } : {}),
    ...(state.sorting ? { order: state.sorting.desc ? ('desc' as const) : ('asc' as const) } : {}),
  };
  const guardiansQuery = useGuardians(guardianListFilters);

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'search',
      label: t('list.searchLabel'),
      placeholder: t('list.searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'relationship',
      label: t('list.columnRelationship'),
      allLabel: t('list.allRelationships'),
      options: RELATIONSHIP_VALUES.map((value) => ({
        value,
        label: relationshipLabel(value, t),
      })),
    },
    {
      kind: 'select',
      key: 'preferred_communication',
      label: t('list.columnPreferredCommunication'),
      allLabel: t('list.allPreferredCommunication'),
      options: Object.values(CommunicationMedium).map((value) => ({
        value,
        label: t(`preferredCommunicationOptions.${value}`),
      })),
    },
    {
      kind: 'checkbox',
      key: 'is_primary_contact',
      label: t('list.primaryOnlyFilter'),
    },
    {
      // Select (not checkbox) so the URL value stays `1` — the checkbox kind
      // hard-codes `'true'`, but the dashboard card links `?incomplete=1`.
      kind: 'select',
      key: 'incomplete',
      label: t('filters.recordCompleteness'),
      allLabel: t('filters.allRecords'),
      options: [{ value: '1', label: t('filters.incompleteOnly') }],
    },
  ];

  const columns: DataTableColumn<Guardian>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => row.full_name,
      sortable: true,
      // [8.14.10] Row's own name is the natural card title.
      card: 'title',
    },
    {
      id: 'relationship',
      header: t('list.columnRelationship'),
      accessorFn: (row) => relationshipLabel(row.relationship, t),
      card: 'subtitle',
    },
    {
      id: 'phone',
      header: t('list.columnPhone'),
      accessorFn: (row) =>
        row.phone ? formatPhone(row.phone, regionConfig) : t('list.emptyValue'),
    },
    {
      id: 'preferredCommunication',
      header: t('list.columnPreferredCommunication'),
      accessorFn: (row) => t(`preferredCommunicationOptions.${row.preferred_communication}`),
    },
    {
      id: 'linkedStudents',
      header: t('list.columnLinkedStudents'),
      accessorFn: (row) =>
        row.students.length === 0 ? (
          t('list.emptyValue')
        ) : (
          <>
            {row.students
              .slice(0, 2)
              .map((student) => student.full_name)
              .join(', ')}
            {row.students.length > 2 && (
              <span className="text-text-secondary">
                {' '}
                {t('list.moreStudents', {
                  n: formatNumber(row.students.length - 2, regionConfig),
                })}
              </span>
            )}
          </>
        ),
    },
    {
      id: 'primaryContact',
      header: t('list.columnPrimaryContact'),
      accessorFn: (row) => (
        <StatusBadge domain="guardian" status={row.is_primary_contact ? 'PRIMARY' : 'SECONDARY'} />
      ),
      card: 'badge',
    },
  ];

  return (
    <RegionConfigProvider value={regionConfig}>
      <ListShell
        title={t('list.title')}
        actions={[
          {
            id: 'invite',
            helpId: 'people.guardians.action.invite',
            label: t('invite.trigger'),
            icon: <SendIcon aria-hidden="true" />,
            priority: 'primary',
            allowed: canInvite,
            onClick: () => setInviteOpen(true),
          },
        ]}
        // [8.15.17] Everything matching the filters below, as Excel (or CSV from the arrow).
        tabs={
          <ExportMenu
            totalCount={guardiansQuery.data?.total ?? 0}
            canExportAll={canExportAll}
            unit="people"
            onExportAll={(format) =>
              downloadListExport('/guardians/export', guardianListFilters, format)
            }
          />
        }
        filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
        tableId="guardians-list"
        caption={t('list.caption')}
        columns={columns}
        rowActions={(row) => [
          {
            intent: 'view',
            label: t('list.view'),
            to: `/guardians/${row.id}`,
            'data-focus-anchor': row.id,
          },
        ]}
        data={guardiansQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={guardiansQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={guardiansQuery.isLoading}
        isFetching={guardiansQuery.isFetching}
        {...(guardiansQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyState={{
          title: t('list.emptyMessage'),
          explanation: t('list.emptyExplanation'),
          ...(canInvite
            ? { action: { label: t('invite.trigger'), onClick: () => setInviteOpen(true) } }
            : {}),
        }}
        announceResults={(count, total) => t('list.announceResults', { count, total })}
      />
      <InviteGuardiansDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </RegionConfigProvider>
  );
}

function GuardiansListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
