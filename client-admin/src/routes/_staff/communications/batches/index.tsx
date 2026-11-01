/**
 * `/communications/batches` — [8.11.9]'s Reminder History: every bulk
 * batch, newest first, with its delivery counts and a `StatusBadge`
 * whose PROCESSING → COMPLETED / PARTIALLY_FAILED / FAILED lifecycle
 * the detail page keeps polling. Row → `/communications/batches/$batchId`.
 *
 * Gated on COMMUNICATION_BULK_SEND, not the plan's COMMUNICATION_LOG_READ:
 * the batch read routes are `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE)` and
 * ACCOUNTANT — the persona whose sends fill this page — holds BULK_SEND
 * but not LOG_READ, so a LOG_READ gate would hide this page from the
 * very role that creates its contents. Same UX-gate-not-security-boundary
 * framing as `/communications/reminders`.
 */
import { ReminderBatchStatus } from '@biddaloy/shared';
import {
  RoutePending,
  StatusBadge,
  statusLabelKey,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  reminderBatchesQueryOptions,
  useReminderBatches,
  type ReminderBatchListFilters,
  type ReminderBatchListItem,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { SendIcon } from 'lucide-react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

const batchesSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().max(100).optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  from_date: z.string().optional().catch(undefined),
  to_date: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores selection under — must
  // survive a raw TanStack search round-trip or FilterBar's selection
  // gets silently stripped, same reasoning `invoices/index.tsx` documents.
  selected: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/communications/batches/')({
  validateSearch: batchesSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 25,
    sort: search.sort,
    order: search.order,
    search: search.search,
    status: search.status,
    fromDate: search.from_date,
    toDate: search.to_date,
  }),
  loader: ({ context: { queryClient }, deps }) => {
    const sortField = deps.sort !== undefined ? SORT_FIELD_BY_COLUMN[deps.sort] : undefined;
    return Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          reminderBatchesQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...(deps.search ? { search: deps.search } : {}),
            ...(deps.status ? { status: deps.status as ReminderBatchStatus } : {}),
            ...(deps.fromDate ? { from_date: deps.fromDate } : {}),
            ...(deps.toDate ? { to_date: deps.toDate } : {}),
            ...(sortField !== undefined ? { sort: sortField } : {}),
            ...(deps.order !== undefined ? { order: deps.order } : {}),
          }),
        )
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('communications'),
    ]);
  },
  pendingComponent: ReminderHistoryPending,
  component: ReminderHistoryPage,
});

/** `DataTableSort.id` values that map onto a server-sortable field —
 * `ReminderBatchListFilters['sort']`'s own allowlist, keyed by this page's
 * column ids. [8.14.10]: `sorting`/`onSortingChange` used to be wired to
 * `ListShell` while the query itself never read `state.sorting` at all — a
 * silent no-op, same class of bug correction 9 flags for the other four
 * pages. Now actually threaded through to the request. */
const SORT_FIELD_BY_COLUMN: Partial<Record<string, ReminderBatchListFilters['sort']>> = {
  name: 'batch_name',
  created: 'created_at',
  recipients: 'total_recipients',
};

// [8.14.17]: the permission check that used to live at the top of
// `ReminderHistoryPage` (an `EmptyState` shown when the viewer lacked
// `COMMUNICATION_BULK_SEND`) is gone — `_staff.tsx`'s `RequirePermission`
// now refuses the whole route in place, keyed off the same permission
// (`route-permissions.ts`), before this component ever mounts.
function ReminderHistoryPage() {
  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <ReminderHistoryList />
    </RegionConfigProvider>
  );
}

function ReminderHistoryList() {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const [state, actions] = useListShellState();
  const openBulk = () =>
    void navigate({ to: '/communications/reminders', search: { mode: 'bulk' } });

  const filters = state.filters as {
    search?: string;
    status?: string;
    from_date?: string;
    to_date?: string;
  };

  const sortField = state.sorting !== null ? SORT_FIELD_BY_COLUMN[state.sorting.id] : undefined;
  const batchesQuery = useReminderBatches({
    page: state.page,
    limit: state.limit,
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.status ? { status: filters.status as ReminderBatchStatus } : {}),
    ...(filters.from_date ? { from_date: filters.from_date } : {}),
    ...(filters.to_date ? { to_date: filters.to_date } : {}),
    ...(sortField !== undefined ? { sort: sortField } : {}),
    ...(state.sorting ? { order: state.sorting.desc ? 'desc' : 'asc' } : {}),
  });

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'search',
      label: t('batches.searchLabel'),
      placeholder: t('batches.searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'status',
      label: t('batches.statusFilterLabel'),
      helpId: 'communications.reminderHistory.field.status',
      allLabel: t('batches.allStatuses'),
      options: Object.values(ReminderBatchStatus).map((status) => ({
        value: status,
        label: t(statusLabelKey('reminderBatch', status), { ns: 'common' }),
      })),
    },
    {
      kind: 'date-range',
      fromKey: 'from_date',
      toKey: 'to_date',
      label: t('batches.dateRangeLabel'),
      fromLabel: t('batches.fromDateLabel'),
      toLabel: t('batches.toDateLabel'),
    },
  ];

  const columns: DataTableColumn<ReminderBatchListItem>[] = [
    {
      id: 'name',
      header: t('batches.nameHeader'),
      accessorFn: (row) => <span className="font-medium">{row.batch_name}</span>,
      pinned: true,
      sortable: true,
      // [8.14.10] `pinned` alone would default this to card role
      // `'actions'` (see `DataTableCardRole`'s doc comment) — wrong for a
      // column that's the row's title, not an action.
      card: 'title',
    },
    {
      id: 'created',
      header: t('batches.createdHeader'),
      accessorFn: (row) => formatDate(new Date(row.created_at), config),
      sortable: true,
      card: 'subtitle',
    },
    {
      id: 'status',
      header: t('batches.statusHeader'),
      accessorFn: (row) => <StatusBadge domain="reminderBatch" status={row.status} />,
      card: 'badge',
    },
    {
      id: 'recipients',
      header: t('batches.recipientsHeader'),
      // [8.14.10] fix: raw `String(number)` always rendered ASCII digits,
      // even in `bn` — `formatNumber` runs it through the active region's
      // digit set, same fix applied to `classes/index.tsx`.
      accessorFn: (row) => formatNumber(row.total_recipients, config),
      sortable: true,
      align: 'end',
    },
    {
      id: 'successful',
      header: t('batches.successfulHeader'),
      accessorFn: (row) => formatNumber(row.successful_count, config),
      align: 'end',
    },
    {
      id: 'failed',
      header: t('batches.failedHeader'),
      accessorFn: (row) => formatNumber(row.failed_count, config),
      align: 'end',
    },
  ];

  return (
    <ListShell
      title={t('batches.title')}
      subtitle={t('batches.subtitle')}
      actions={[
        {
          id: 'bulk',
          label: t('bulk.entryAction'),
          icon: <SendIcon aria-hidden />,
          priority: 'primary',
          onClick: openBulk,
        },
      ]}
      filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
      tableId="reminder-batches"
      caption={t('batches.tableCaption')}
      columns={columns}
      rowActions={(row) => [
        {
          intent: 'view',
          label: t('batches.viewAction'),
          to: `/communications/batches/${row.id}`,
          'data-focus-anchor': row.id,
        },
      ]}
      data={batchesQuery.data?.data ?? []}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      page={state.page}
      pageSize={state.limit}
      totalCount={batchesQuery.data?.total ?? 0}
      onPageChange={actions.setPage}
      onPageSizeChange={actions.setLimit}
      pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
      loading={batchesQuery.isPending}
      isFetching={batchesQuery.isFetching}
      {...(batchesQuery.isError ? { error: t('batches.error') } : {})}
      emptyState={{
        icon: <SendIcon aria-hidden />,
        title: t('batches.empty'),
        explanation: t('batches.emptyHelp'),
      }}
    />
  );
}

function ReminderHistoryPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
