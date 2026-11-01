import { FeeStatus, FeeType, Permission, PeriodType } from '@biddaloy/shared';
import {
  Button,
  HelpHint,
  RoutePending,
  StatusBadge,
  statusLabelKey,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  feeDuesQueryOptions,
  useClasses,
  useClassSections,
  useFeeDues,
  useHasPermission,
  useLastReminders,
  useStudentWallet,
  type FeeDueEntry,
  type FeeDueRow,
  type FeeDuesSortBy,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import {
  downloadCsv,
  formatDate,
  formatMonth,
  formatMonthName,
  formatNumber,
  formatServerAmount,
  parseServerDate,
  renderDigits,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { BanknoteIcon, DownloadIcon, SendIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';
import { SendReminderDialog } from '../students/-send-reminder-dialog';

/** `DataTableSort.id` values that map onto a server-sortable field —
 * `QueryFeeDuesDto.sort_by`'s own allowlist, keyed by this page's column
 * ids. Only sortable when `flagged` is off — `QueryFlaggedDuesDto` has no
 * sort fields at all; the service fixes months-overdue-desc server-side. */
const SORT_FIELD_BY_COLUMN: Partial<Record<string, FeeDuesSortBy>> = {
  student: 'name',
  class: 'class',
  due: 'due_amount',
};

interface DuesFilters {
  search?: string | undefined;
  class_id?: string | undefined;
  section_id?: string | undefined;
  month?: string | undefined;
  year?: string | undefined;
  status?: string | undefined;
  fee_type?: FeeType | undefined;
  flagged?: string | undefined;
}

const duesSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().max(100).optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  section_id: z.string().optional().catch(undefined),
  month: z.string().optional().catch(undefined),
  year: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  fee_type: z.enum(FeeType).optional().catch(undefined),
  flagged: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores the row selection under
  // — must be declared here or TanStack Router's `validateSearch` strips
  // it from the URL on every navigation.
  selected: z.string().optional().catch(undefined),
});

function toFeeDuesFilters(
  filters: DuesFilters,
  sortColumnId: string | undefined,
  flagged: boolean,
) {
  // The flagged endpoint accepts no sort fields (see the QueryFeeDuesDto
  // note above) — never send sort_by/sort_order alongside flagged=true.
  const sortField = !flagged && sortColumnId ? SORT_FIELD_BY_COLUMN[sortColumnId] : undefined;
  return {
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(filters.class_id !== undefined ? { class_id: filters.class_id } : {}),
    ...(filters.section_id !== undefined ? { section_id: filters.section_id } : {}),
    ...(filters.month !== undefined ? { month: Number(filters.month) } : {}),
    ...(filters.year !== undefined ? { year: Number(filters.year) } : {}),
    ...(filters.status !== undefined
      ? { status: filters.status as FeeStatus.PENDING | FeeStatus.PARTIALLY_PAID }
      : {}),
    ...(filters.fee_type !== undefined ? { fee_type: filters.fee_type } : {}),
    ...(sortField !== undefined ? { sort_by: sortField } : {}),
  };
}

export const Route = createFileRoute('/_staff/fees/dues')({
  validateSearch: duesSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 25,
    sort: search.sort,
    order: search.order,
    search: search.search,
    classId: search.class_id,
    sectionId: search.section_id,
    month: search.month,
    year: search.year,
    status: search.status,
    feeType: search.fee_type,
    flagged: search.flagged === 'true',
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          feeDuesQueryOptions(
            {
              page: deps.page,
              limit: deps.limit,
              ...toFeeDuesFilters(
                {
                  search: deps.search,
                  class_id: deps.classId,
                  section_id: deps.sectionId,
                  month: deps.month,
                  year: deps.year,
                  status: deps.status,
                  fee_type: deps.feeType,
                },
                deps.sort,
                deps.flagged,
              ),
              ...(deps.order !== undefined && !deps.flagged
                ? { sort_order: deps.order === 'desc' ? 'DESC' : 'ASC' }
                : {}),
            },
            deps.flagged,
          ),
        )
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('fees', 'feeStructures'),
    ]),
  pendingComponent: DuesQueuePending,
  component: DuesQueuePage,
});

/** `months_overdue > 0` (the flagged endpoint's own definition of
 * "overdue") wins over the per-fee-month status mix, since it's the
 * stronger signal — a partially-paid fee that's also overdue is
 * overdue, not merely partial. No single status field exists on the
 * aggregate itself (`StudentDueAggregate` has none), so this derives
 * one from what the row already carries. */
function deriveRowStatus(row: FeeDueRow): FeeStatus {
  if (row.months_overdue > 0) return FeeStatus.OVERDUE;
  return row.dues.some((due) => due.status === FeeStatus.PARTIALLY_PAID)
    ? FeeStatus.PARTIALLY_PAID
    : FeeStatus.PENDING;
}

/** [16.4.5] credit balance — no batched wallet endpoint exists, so one
 * `useStudentWallet` call per visible row (React Query dedupes per student). */
function WalletChip({ studentId }: { studentId: string }) {
  const regionConfig = useRegionConfig();
  const walletQuery = useStudentWallet(studentId);

  if (walletQuery.isLoading) {
    return <span aria-hidden="true" className="inline-block h-3 w-16 rounded-sm bg-muted" />;
  }
  if (walletQuery.isError || walletQuery.data === undefined) return <span>—</span>;
  const { balance } = walletQuery.data;
  return (
    <span className={Number(balance) === 0 ? 'text-text-secondary' : undefined}>
      {formatServerAmount(balance, regionConfig)}
    </span>
  );
}

/** [16.4.5] the expanded row's per-fee list — one item per `FeeDueEntry`. A list
 * (not a table) because it must read in both table and card mode. */
function DuesFeeLines({ name, dues }: { name: string; dues: FeeDueEntry[] }) {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();

  return (
    <div className="px-4 pb-2">
      <ul
        aria-label={t('dues.expandLabel', {
          name,
          count: dues.length,
          n: formatNumber(dues.length, regionConfig),
        })}
        className="divide-y divide-border-subtle"
      >
        {dues.map((due) => {
          const periodStart = parseServerDate(due.period_start);
          const period =
            due.period_type === PeriodType.MONTH
              ? formatMonth(periodStart, regionConfig)
              : formatDate(periodStart, regionConfig);
          const date = due.due_date ? formatDate(parseServerDate(due.due_date), regionConfig) : '—';
          return (
            <li key={due.student_fee_id} className="py-2">
              <div className="flex items-start justify-between gap-4">
                <p className="flex min-w-0 flex-wrap items-center gap-2 font-medium">
                  {due.occurrence > 1
                    ? `${due.fee_name} (${formatNumber(due.occurrence, regionConfig)})`
                    : due.fee_name}
                  {due.is_late_fee && (
                    <StatusBadge tone="warning" label={t('dues.expanded.lateFeeBadge')} />
                  )}
                </p>
                <p className="shrink-0 font-medium tabular-nums">
                  {formatServerAmount(due.balance, regionConfig)}
                </p>
              </div>
              <p className="text-caption text-text-secondary">
                {t('dues.expanded.periodAndDue', { period, date })}
              </p>
              <p className="text-caption text-text-secondary">
                {t('dues.expanded.breakdown', {
                  total: formatServerAmount(due.total_amount, regionConfig),
                  discount: formatServerAmount(
                    due.standing_discount_amount + due.one_off_discount_amount,
                    regionConfig,
                  ),
                  paid: formatServerAmount(due.paid_amount, regionConfig),
                })}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Its own component: `DataTable` caches a cell's value per row, so a string built before the
 * last-reminders response arrived would never update. Same query key as the page's, so React
 * Query dedupes the request. */
function LastReminderCell({ studentId, studentIds }: { studentId: string; studentIds: string[] }) {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const reminder = useLastReminders(studentIds).data?.get(studentId);
  return reminder ? (
    <>{formatDate(new Date(reminder.sent_at), regionConfig)}</>
  ) : (
    <span className="text-text-secondary">{t('dues.neverReminded')}</span>
  );
}

function DuesQueuePage() {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const [state, actions] = useListShellState();
  const filters = state.filters as DuesFilters;
  const flagged = filters.flagged === 'true';

  const duesQuery = useFeeDues(
    {
      page: state.page,
      limit: state.limit,
      ...toFeeDuesFilters(filters, state.sorting?.id, flagged),
      ...(state.sorting && !flagged ? { sort_order: state.sorting.desc ? 'DESC' : 'ASC' } : {}),
    },
    flagged,
  );
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(filters.class_id);

  const rows = React.useMemo(() => duesQuery.data?.data ?? [], [duesQuery.data]);

  // Bulk actions (Generate Invoice, Export) need each selected row's full
  // dues breakdown, not just its id — and `selectedIds` persists across
  // pages while `duesQuery.data` only holds the current one. There's no
  // `GET /fees/dues/:studentId` to re-fetch a row by id (unlike
  // `students/index.tsx`'s CSV export, which resolves stale selections
  // via `studentQueryOptions`), so this accumulates every row this
  // session has actually loaded into view instead — a selection made on
  // an earlier page during this visit is still resolvable; one from a
  // stale bookmark/reload is not, and drops silently from those two
  // actions (Send Reminder is unaffected — it only needs student ids).
  const rowCacheRef = React.useRef(new Map<string, FeeDueRow>());
  React.useEffect(() => {
    for (const row of rows) rowCacheRef.current.set(row.student_id, row);
  }, [rows]);

  const selectedRows = Array.from(state.selectedIds)
    .map((id) => rowCacheRef.current.get(id))
    .filter((row): row is FeeDueRow => row !== undefined);

  const visibleStudentIds = React.useMemo(() => rows.map((row) => row.student_id), [rows]);
  const lastRemindersQuery = useLastReminders(visibleStudentIds);
  const lastReminders = lastRemindersQuery.data;

  // `/payments/record` needs PAYMENT_RECORD as well, so both gate the record-payment buttons.
  const hasFeeCollect = useHasPermission(Permission.FEE_COLLECT);
  const hasPaymentRecord = useHasPermission(Permission.PAYMENT_RECORD);
  const canCollectFees = hasFeeCollect && hasPaymentRecord;
  const canSendReminder = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  const navigate = useNavigate();

  const [reminderTarget, setReminderTarget] = React.useState<{
    ids: string[];
    bulk: boolean;
  } | null>(null);

  const currentYear = new Date().getFullYear();
  const yearOptions = React.useMemo(
    () => [currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map(String),
    [currentYear],
  );

  // [8.14.10] FilterBar's `onChange` hands back a patch (string sets,
  // `null` clears) rather than the old hand-rolled `setFilter`'s
  // rebuild-the-whole-bag shape. `class_id` still needs its
  // `section_id`-invalidation side effect — same reasoning
  // `students/index.tsx` documents for its own class/section pair — so
  // that one key gets special-cased on top of the generic patch.
  function handleFilterChange(patch: Record<string, string | null>) {
    const next = { ...patch };
    if ('class_id' in next) next.section_id = null;
    // Flagged mode hides month/year/status/fee type — clear their values too.
    if (next.flagged === 'true') {
      next.month = null;
      next.year = null;
      next.status = null;
      next.fee_type = null;
      // The overdue endpoint ignores `search`, so the field is hidden and a typed name is dropped.
      next.search = null;
    }
    actions.setFilters(next);
  }

  function reminderIso(studentId: string): string {
    const reminder = lastReminders?.get(studentId);
    return reminder ? toIsoDate(new Date(reminder.sent_at)) : '';
  }

  function exportSelectedToCsv() {
    const header = [
      t('dues.columnStudent'),
      t('dues.columnClass'),
      t('dues.columnSection'),
      t('dues.columnTotal'),
      t('dues.columnPaid'),
      t('dues.columnDue'),
      t('dues.columnStatus'),
      t('dues.columnLastReminder'),
    ];
    const lines = selectedRows.map((row) => {
      const totalBilled = row.dues.reduce((sum, due) => sum + due.total_amount, 0);
      const paid = row.dues.reduce((sum, due) => sum + due.paid_amount, 0);
      return [
        row.full_name,
        row.class_name ?? '',
        row.section_name ?? '',
        formatServerAmount(totalBilled, regionConfig),
        formatServerAmount(paid, regionConfig),
        formatServerAmount(row.total_due, regionConfig),
        t(statusLabelKey('fee', deriveRowStatus(row)), { ns: 'common' }),
        reminderIso(row.student_id),
      ];
    });
    downloadCsv('dues.csv', [header, ...lines]);
  }

  const columns: DataTableColumn<FeeDueRow>[] = [
    {
      id: 'student',
      header: t('dues.columnStudent'),
      accessorFn: (row) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.full_name}</span>
          <span className="text-caption text-text-secondary">
            {t('dues.studentCaption', {
              registration: row.registration_number,
              roll: formatNumber(row.roll_number, regionConfig),
            })}
          </span>
        </span>
      ),
      sortable: !flagged,
      card: 'title',
    },
    {
      id: 'class',
      header: t('dues.columnClass'),
      accessorFn: (row) => `${row.class_name ?? '—'} · ${row.section_name ?? '—'}`,
      sortable: !flagged,
      card: 'subtitle',
    },
    {
      id: 'total',
      header: t('dues.columnTotal'),
      // `row.total_due` is the *balance*; gross billed is recomputed from the
      // per-fee breakdown for this column.
      accessorFn: (row) =>
        formatServerAmount(
          row.dues.reduce((sum, due) => sum + due.total_amount, 0),
          regionConfig,
        ),
      align: 'end',
    },
    {
      id: 'paid',
      header: t('dues.columnPaid'),
      accessorFn: (row) =>
        formatServerAmount(
          row.dues.reduce((sum, due) => sum + due.paid_amount, 0),
          regionConfig,
        ),
      align: 'end',
    },
    {
      id: 'due',
      header: t('dues.columnDue'),
      accessorFn: (row) => (
        <span className="font-medium">{formatServerAmount(row.total_due, regionConfig)}</span>
      ),
      sortable: !flagged,
      align: 'end',
    },
    {
      id: 'status',
      header: t('dues.columnStatus'),
      accessorFn: (row) => <StatusBadge domain="fee" status={deriveRowStatus(row)} />,
      card: 'badge',
    },
    {
      id: 'wallet',
      header: t('dues.columnWallet'),
      accessorFn: (row) => <WalletChip studentId={row.student_id} />,
      align: 'end',
    },
    {
      id: 'lastReminder',
      header: t('dues.columnLastReminder'),
      accessorFn: (row) => (
        <LastReminderCell studentId={row.student_id} studentIds={visibleStudentIds} />
      ),
    },
  ];

  // Flagged mode: `QueryFlaggedDuesDto` accepts none of month/year/status/fee_type,
  // so those controls are not rendered at all.
  const FLAGGED_HIDDEN = new Set(['search', 'month', 'year', 'status', 'fee_type']);
  const allFilterFields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'search',
      label: t('dues.searchLabel'),
      placeholder: t('dues.searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'class_id',
      label: t('dues.classLabel'),
      allLabel: t('dues.allClasses'),
      options: (classesQuery.data?.data ?? []).map((klass) => ({
        value: klass.id,
        label: klass.name,
      })),
    },
    {
      kind: 'select',
      key: 'section_id',
      label: t('dues.sectionLabel'),
      allLabel: t('dues.allSections'),
      // Empty until a class is chosen — `useClassSections` itself only
      // fetches once `class_id` is set, so `sectionsQuery.data` is
      // naturally `undefined` until then.
      options: (sectionsQuery.data ?? []).map((section) => ({
        value: section.id,
        label: section.section_name,
      })),
    },
    {
      kind: 'select',
      key: 'month',
      label: t('dues.monthLabel'),
      allLabel: t('dues.allMonths'),
      options: Array.from({ length: 12 }, (_, i) => ({
        value: String(i + 1),
        label: formatMonthName(i + 1, regionConfig),
      })),
    },
    {
      kind: 'select',
      key: 'year',
      label: t('dues.yearLabel'),
      allLabel: t('dues.allYears'),
      options: yearOptions.map((year) => ({
        value: year,
        label: renderDigits(year, regionConfig.numerals),
      })),
    },
    {
      kind: 'select',
      key: 'status',
      label: t('dues.statusLabel'),
      allLabel: t('dues.allStatuses'),
      options: [
        {
          value: FeeStatus.PENDING,
          label: t(statusLabelKey('fee', FeeStatus.PENDING), { ns: 'common' }),
        },
        {
          value: FeeStatus.PARTIALLY_PAID,
          label: t(statusLabelKey('fee', FeeStatus.PARTIALLY_PAID), { ns: 'common' }),
        },
      ],
    },
    {
      kind: 'select',
      key: 'fee_type',
      label: t('dues.feeTypeLabel'),
      allLabel: t('dues.allFeeTypes'),
      options: Object.values(FeeType).map((feeType) => ({
        value: feeType,
        label: t(`feeTypes.${feeType}`, { ns: 'feeStructures' }),
      })),
    },
    {
      kind: 'checkbox',
      key: 'flagged',
      label: t('dues.flaggedToggleLabel'),
      helpId: 'finance.dues.field.flagged',
    },
  ];

  const filterFields = flagged
    ? allFilterFields.filter((field) => !('key' in field && FLAGGED_HIDDEN.has(field.key)))
    : allFilterFields;

  return (
    <>
      <ListShell
        title={t('dues.title')}
        subtitle={t('dues.subtitle')}
        actions={[
          {
            id: 'record',
            helpId: 'finance.dues.action.collect',
            label: t('dues.recordPayment'),
            icon: <BanknoteIcon />,
            priority: 'primary',
            allowed: canCollectFees,
            onClick: () => void navigate({ to: '/payments/record' }),
          },
        ]}
        filters={{ fields: filterFields, values: state.filters, onChange: handleFilterChange }}
        tableId="fees-dues"
        caption={t('dues.caption')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.student_id}
        expandRowLabel={(row) =>
          t('dues.expandLabel', {
            name: row.full_name,
            count: row.dues.length,
            n: formatNumber(row.dues.length, regionConfig),
          })
        }
        renderExpandedRow={(row) => <DuesFeeLines name={row.full_name} dues={row.dues} />}
        rowActions={(row) => [
          { intent: 'view', label: t('dues.view'), to: `/students/${row.student_id}?tab=fees` },
          {
            intent: 'pay',
            label: t('dues.collect'),
            to: `/payments/record?student_id=${row.student_id}`,
            allowed: canCollectFees,
          },
          {
            intent: 'send',
            label: t('dues.remindShort'),
            allowed: canSendReminder,
            onClick: () => setReminderTarget({ ids: [row.student_id], bulk: false }),
          },
        ]}
        defaultColumnVisibility={{ total: false, paid: false }}
        sorting={flagged ? null : state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={duesQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        selectedIds={state.selectedIds}
        onSelectedIdsChange={actions.setSelectedIds}
        columnsMenu
        columnsMenuLabel={t('dues.columnsButton')}
        loading={duesQuery.isLoading}
        isFetching={duesQuery.isFetching}
        {...(duesQuery.isError ? { error: t('dues.errorMessage') } : {})}
        emptyState={{ title: t('dues.emptyMessage'), explanation: t('dues.emptyExplanation') }}
        announceResults={(count, total) =>
          t('dues.announceResults', {
            count: total,
            visible: formatNumber(count, regionConfig),
            total: formatNumber(total, regionConfig),
          })
        }
        bulkActions={
          <>
            {canSendReminder && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setReminderTarget({ ids: Array.from(state.selectedIds), bulk: true })
                }
              >
                <SendIcon aria-hidden="true" />
                {t('dues.sendReminder')}
              </Button>
            )}
            {canSendReminder && <HelpHint helpId="finance.dues.action.sendReminder" />}
            <Button type="button" variant="outline" onClick={exportSelectedToCsv}>
              <DownloadIcon aria-hidden="true" />
              {t('dues.exportCsv')}
            </Button>
            <HelpHint helpId="finance.dues.action.exportCsv" />
            <Button type="button" variant="ghost" onClick={() => actions.setSelectedIds(new Set())}>
              <XIcon aria-hidden="true" />
              {t('dues.clearSelection')}
            </Button>
          </>
        }
      />
      <SendReminderDialog
        open={reminderTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReminderTarget(null);
        }}
        studentIds={reminderTarget?.ids ?? []}
        onSent={() => {
          if (reminderTarget?.bulk) actions.setSelectedIds(new Set());
        }}
      />
    </>
  );
}

function DuesQueuePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
