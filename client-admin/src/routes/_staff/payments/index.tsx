import { Permission, PaymentMethod } from '@biddaloy/shared';
import { RoutePending, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { useHasPermission, type Payment } from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, formatServerAmount, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Banknote, Receipt } from 'lucide-react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { usePaymentsList } from './-list/use-payments-list';

const paymentsSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().max(100).optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  // Coerced: a numeric-looking search ("2024") or `include_reversed=true`
  // would otherwise be parsed to a number/boolean by the router and dropped.
  search: z.coerce.string().optional().catch(undefined),
  payment_method: z.string().optional().catch(undefined),
  date_from: z.string().optional().catch(undefined),
  date_to: z.string().optional().catch(undefined),
  include_reversed: z.coerce.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under.
  selected: z.string().optional().catch(undefined),
  // `'1'` is the legacy "open the record form" link; `beforeLoad` redirects it to
  // `/payments/record`. `z.coerce.string()`, not `z.string()` — the
  // router's default search parser coerces a numeric-looking query value
  // (`?record=1`) to the *number* `1`, not the string `'1'`, before this
  // schema ever sees it; a plain `z.string()` would fail that and
  // silently fall back to `undefined` via `.catch()`.
  record: z.coerce.string().optional().catch(undefined),
  student_id: z.string().min(1).optional().catch(undefined),
  guardian_id: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/payments/')({
  validateSearch: paymentsSearchSchema,
  // Old `?record=1` links (and the fees dues deep link) land on the full-page form.
  beforeLoad: ({ search }) => {
    if (search.record === '1') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        to: '/payments/record',
        search: {
          ...(search.student_id !== undefined ? { student_id: search.student_id } : {}),
          ...(search.guardian_id !== undefined ? { guardian_id: search.guardian_id } : {}),
        },
      });
    }
  },
  loader: () => loadRouteNamespaces('payments', 'common'),
  pendingComponent: PaymentsPending,
  component: PaymentsPage,
});

function PaymentsPage() {
  const navigate = useNavigate();
  const canRecord = useHasPermission(Permission.PAYMENT_RECORD);
  // No ambient `RegionConfigProvider` above the route tree — every amount
  // the list renders would otherwise fall back to the provider's hardcoded
  // default region instead of the active tenant's.
  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <PaymentsList
        canRecord={canRecord}
        onRecord={() => void navigate({ to: '/payments/record' })}
      />
    </RegionConfigProvider>
  );
}

function PaymentsList({ canRecord, onRecord }: { canRecord: boolean; onRecord: () => void }) {
  const { t } = useTranslation('payments');
  const regionConfig = useRegionConfig();
  const [state, actions] = useListShellState();
  const filters = state.filters;
  const includeReversed = filters.include_reversed === 'true';

  const query = usePaymentsList({
    page: state.page,
    limit: state.limit,
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.payment_method ? { payment_method: filters.payment_method } : {}),
    ...(filters.date_from ? { date_from: filters.date_from } : {}),
    ...(filters.date_to ? { date_to: filters.date_to } : {}),
    ...(includeReversed ? { include_reversed: true } : {}),
  });

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
      key: 'payment_method',
      label: t('list.methodLabel'),
      allLabel: t('list.allMethods'),
      options: Object.values(PaymentMethod).map((method) => ({
        value: method,
        label: t(`record.method.methods.${method}`),
      })),
    },
    {
      kind: 'date-range',
      fromKey: 'date_from',
      toKey: 'date_to',
      label: t('list.dateLabel'),
      fromLabel: t('list.dateFromLabel'),
      toLabel: t('list.dateToLabel'),
    },
    {
      kind: 'checkbox',
      key: 'include_reversed',
      label: t('list.includeReversed'),
      helpId: 'finance.payments.field.includeReversed',
    },
  ];

  const columns: DataTableColumn<Payment>[] = [
    {
      id: 'date',
      header: t('list.columnDate'),
      accessorFn: (row) => formatDate(parseServerDate(row.payment_date), regionConfig),
      card: 'subtitle',
    },
    {
      id: 'student',
      header: t('list.columnStudent'),
      accessorFn: (row) =>
        row.student ? (
          <span>
            <span className="font-medium">{row.student.full_name}</span>
            <span className="text-text-secondary"> · {row.student.registration_number}</span>
          </span>
        ) : (
          <span className="font-medium">{t('list.deletedStudent')}</span>
        ),
      card: 'title',
    },
    {
      id: 'method',
      header: t('list.columnMethod'),
      accessorFn: (row) => t(`record.method.methods.${row.payment_method}`),
      card: 'field',
    },
    {
      id: 'reference',
      header: t('list.columnReference'),
      accessorFn: (row) => row.transaction_reference ?? '—',
      card: 'field',
    },
    {
      id: 'amount',
      header: t('list.columnAmount'),
      accessorFn: (row) => formatServerAmount(row.total_amount, regionConfig),
      align: 'end',
      card: 'field',
    },
    ...(includeReversed
      ? [
          {
            id: 'status',
            header: t('list.columnStatus'),
            accessorFn: (row: Payment) =>
              row.reversal_of_payment_id ? (
                <StatusBadge tone="info" label={t('list.reversal')} />
              ) : row.reversed_by_payment_id ? (
                <StatusBadge tone="neutral" label={t('list.reversed')} />
              ) : null,
            card: 'badge',
          } satisfies DataTableColumn<Payment>,
        ]
      : []),
  ];

  return (
    <ListShell
      title={t('title')}
      subtitle={t('subtitle')}
      actions={[
        {
          id: 'record',
          label: t('recordAction'),
          priority: 'primary',
          icon: <Banknote aria-hidden />,
          allowed: canRecord,
          onClick: onRecord,
        },
      ]}
      filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
      tableId="payments-list"
      caption={t('list.caption')}
      columns={columns}
      rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: `/payments/${row.id}` }]}
      data={query.data?.data ?? []}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      page={state.page}
      pageSize={state.limit}
      totalCount={query.data?.total ?? 0}
      onPageChange={actions.setPage}
      onPageSizeChange={actions.setLimit}
      pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
      loading={query.isLoading}
      isFetching={query.isFetching}
      {...(query.isError ? { error: t('list.error') } : {})}
      emptyState={{
        title: t('list.emptyTitle'),
        explanation: t('list.emptyText'),
        icon: <Receipt aria-hidden />,
        // The header already carries the primary "Record payment"; an
        // identical EmptyState action would duplicate its accessible name,
        // so the empty state stays action-less.
      }}
    />
  );
}

function PaymentsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
