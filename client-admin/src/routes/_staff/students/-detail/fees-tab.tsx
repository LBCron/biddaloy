import { FeeStatus, Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  DataTable,
  StatusBadge,
  TableCount,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import {
  useHasPermission,
  useStudentFeeSummary,
  useStudentWallet,
  type StudentFee,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatDate,
  formatMonth,
  formatNumber,
  formatServerAmount,
  isPastDueDate,
  parseServerDate,
} from '@biddaloy/ui/utils';
import {
  BadgeMinusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HandCoinsIcon,
  ReceiptIcon,
} from 'lucide-react';
import * as React from 'react';

import { DEFAULT_PAGE_SIZE } from '../-constants';

import { DiscountsSection } from './discounts-section';
import { StatementSection } from './statement-section';
import { TabQueryState } from './tab-query-state';
import { WalletPayoutDialog } from './wallet-payout-dialog';
import { WriteOffBillDialog } from './write-off-bill-dialog';

export interface FeesTabProps {
  studentId: string;
}

const OPEN_STATUSES: string[] = [FeeStatus.PENDING, FeeStatus.PARTIALLY_PAID, FeeStatus.OVERDUE];
const HISTORY_PAGE_SIZE = DEFAULT_PAGE_SIZE;

/** `StudentFee`'s money columns are Postgres `decimal` — the pg driver
 * (and this ticket's mocked fixtures) send those as **strings**, even
 * though `schema.d.ts` types them `number` because it's generated from
 * the entity column type, not the wire shape. `+` on two such fields
 * concatenates ("0.00" + "0.00" -> "0.000.00") instead of adding, which
 * throws once the result reaches `formatServerAmount`'s parser. Every
 * other reader of `fee_breakdown` (`portal/fees.tsx`'s `balanceOf`,
 * `getInvoiceSummary` in `fees.service.ts`) goes through `Number()`
 * first — same fix here. */
function discountOf(fee: StudentFee): number {
  return Number(fee.standing_discount_amount) + Number(fee.one_off_discount_amount);
}

function balanceOf(fee: StudentFee): number {
  return Number(fee.total_amount) - Number(fee.paid_amount) - Number(fee.discount_amount);
}

/**
 * **Never trust `fee.status` to say "overdue".** Nothing server-side ever
 * writes `OVERDUE` into `student_fees` — the only mention of it there is a
 * read filter — so rendering `fee.status` verbatim would badge a bill six
 * months late as neutral "Pending". Same derivation as
 * `portal/fees.tsx`'s `deriveMonthStatus` / `dues.tsx`'s `deriveRowStatus`.
 */
function deriveFeeStatus(fee: StudentFee, now: Date): FeeStatus {
  if (balanceOf(fee) <= 0) return fee.status as FeeStatus;
  if (isPastDueDate(fee.due_date, now)) return FeeStatus.OVERDUE;
  return fee.status as FeeStatus;
}

/** [16.4.5]'s per-fee-line table, shared by the "Open bills" and "History"
 * sections — built from the `StudentFee` shape (`fee_breakdown`). Unpaginated:
 * the History section slices its own pages. */
function FeeLinesTable({
  fees,
  tableId,
  emptyTitle,
  emptyExplanation,
  onWriteOff,
}: {
  fees: StudentFee[];
  tableId: string;
  emptyTitle: string;
  emptyExplanation: string;
  /** Present only on the Open bills table, for a user who may write bills off. */
  onWriteOff?: ((fee: StudentFee) => void) | undefined;
}) {
  const { t } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const now = new Date();

  const columns: DataTableColumn<StudentFee>[] = [
    {
      id: 'fee',
      header: t('detail.fees.columnFee'),
      accessorFn: (fee) => (
        <span className="flex flex-wrap items-center gap-2">
          {fee.fee_structure.name}
          {fee.late_fee_for_student_fee_id !== null && (
            <StatusBadge tone="danger" label={t('detail.fees.lateFeeBadge')} />
          )}
        </span>
      ),
      card: 'title',
    },
    {
      id: 'period',
      header: t('detail.fees.columnPeriod'),
      accessorFn: (fee) =>
        `${formatMonth(parseServerDate(fee.period_start), regionConfig)}${
          fee.occurrence > 1 ? ` (${formatNumber(fee.occurrence, regionConfig)})` : ''
        }`,
    },
    {
      id: 'dueDate',
      header: t('detail.fees.columnDueDate'),
      accessorFn: (fee) =>
        fee.due_date ? formatDate(parseServerDate(fee.due_date), regionConfig) : '—',
    },
    {
      id: 'amount',
      header: t('detail.fees.columnAmount'),
      align: 'end',
      accessorFn: (fee) => formatServerAmount(fee.total_amount, regionConfig),
    },
    {
      id: 'discount',
      header: t('detail.fees.columnDiscount'),
      align: 'end',
      accessorFn: (fee) => formatServerAmount(discountOf(fee), regionConfig),
    },
    {
      id: 'paid',
      header: t('detail.fees.columnPaid'),
      align: 'end',
      accessorFn: (fee) => formatServerAmount(fee.paid_amount, regionConfig),
    },
    {
      id: 'balance',
      header: t('detail.fees.columnBalance'),
      align: 'end',
      accessorFn: (fee) => formatServerAmount(balanceOf(fee), regionConfig),
    },
    {
      id: 'status',
      header: t('detail.fees.columnStatus'),
      accessorFn: (fee) => <StatusBadge domain="fee" status={deriveFeeStatus(fee, now)} />,
      card: 'badge',
    },
  ];

  return (
    <DataTable
      tableId={tableId}
      caption={t('detail.fees.columnFee')}
      paginated={false}
      sorting={null}
      onSortingChange={() => {}}
      columns={columns}
      {...(onWriteOff && {
        rowActions: (fee: StudentFee): RowAction[] => [
          {
            intent: 'edit',
            icon: <BadgeMinusIcon aria-hidden="true" />,
            label: t('detail.fees.writeOff.actionFor', { name: fee.fee_structure.name }),
            onClick: () => onWriteOff(fee),
            allowed: OPEN_STATUSES.includes(fee.status),
          },
        ],
      })}
      data={fees}
      getRowId={(fee) => fee.id}
      totalCount={fees.length}
      emptyState={{
        title: emptyTitle,
        explanation: emptyExplanation,
        icon: <ReceiptIcon aria-hidden="true" />,
      }}
    />
  );
}

function WalletSection({ studentId }: { studentId: string }) {
  const { t } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const walletQuery = useStudentWallet(studentId);
  const canPayout = useHasPermission(Permission.PAYMENT_REVERSE);
  const [payingOut, setPayingOut] = React.useState(false);

  return (
    <TabQueryState
      query={walletQuery}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.fees.walletErrorMessage')}
    >
      {(wallet) => {
        // "last 10 transactions" per [16.4.5]'s Step 2 — the endpoint
        // itself pages at 50, newest first; sliced further here.
        const recent = wallet.transactions.slice(0, 10);
        const columns: DataTableColumn<(typeof recent)[number]>[] = [
          {
            id: 'date',
            header: t('detail.fees.walletColumnDate'),
            accessorFn: (tx) => formatDate(new Date(tx.created_at), regionConfig),
          },
          {
            id: 'kind',
            header: t('detail.fees.walletColumnKind'),
            accessorFn: (tx) =>
              t(`walletTransactionKind.${tx.kind}`, { ns: 'common', defaultValue: tx.kind }),
            card: 'title',
          },
          {
            id: 'amount',
            header: t('detail.fees.walletColumnAmount'),
            align: 'end',
            accessorFn: (tx) => formatServerAmount(tx.amount, regionConfig),
          },
          {
            id: 'note',
            header: t('detail.fees.walletColumnNote'),
            // [16.8.2] `note` is staff free text, only on the staff variant.
            accessorFn: (tx) => ('note' in tx && typeof tx.note === 'string' ? tx.note : '—'),
          },
        ];
        return (
          <div className="flex flex-col gap-4">
            <Card padded>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-caption text-text-secondary">
                    {t('detail.fees.walletBalance')}
                  </p>
                  <p className="mt-1 text-h2 tabular-nums">
                    {formatServerAmount(wallet.balance, regionConfig)}
                  </p>
                </div>
                {canPayout && Number(wallet.balance) > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full md:w-auto"
                    onClick={() => setPayingOut(true)}
                  >
                    <HandCoinsIcon className="size-4" aria-hidden />
                    {t('detail.fees.payout.action')}
                  </Button>
                )}
              </div>
            </Card>
            <WalletPayoutDialog
              open={payingOut}
              onOpenChange={setPayingOut}
              studentId={studentId}
              balance={wallet.balance}
            />
            <DataTable
              tableId="student-wallet"
              caption={t('detail.fees.walletTab')}
              paginated={false}
              sorting={null}
              onSortingChange={() => {}}
              columns={columns}
              data={recent}
              // Staff transactions carry `id`; the reduced family shape does
              // not, so a composite key stands in.
              getRowId={(tx) =>
                'id' in tx && typeof tx.id === 'string'
                  ? tx.id
                  : `${tx.created_at}-${tx.kind}-${tx.amount}`
              }
              totalCount={recent.length}
              emptyState={{
                title: t('detail.fees.walletEmptyMessage'),
                explanation: t('detail.fees.walletEmptyExplanation'),
                icon: <ReceiptIcon aria-hidden="true" />,
              }}
            />
          </div>
        );
      }}
    </TabQueryState>
  );
}

function HistorySection({ fees }: { fees: StudentFee[] }) {
  const { t } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const paid = React.useMemo(
    () => fees.filter((fee) => !OPEN_STATUSES.includes(fee.status)),
    [fees],
  );
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(1, Math.ceil(paid.length / HISTORY_PAGE_SIZE));
  // The paid set can shrink between renders (refetch after a payment is
  // reversed, etc.) — clamp so a stale `page` never strands the user.
  const clampedPage = Math.min(page, totalPages);
  const from = (clampedPage - 1) * HISTORY_PAGE_SIZE;
  const pageItems = paid.slice(from, clampedPage * HISTORY_PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      <FeeLinesTable
        fees={pageItems}
        tableId="student-fee-history"
        emptyTitle={t('detail.fees.historyEmptyMessage')}
        emptyExplanation={t('detail.fees.historyEmptyExplanation')}
      />
      {paid.length > HISTORY_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2">
          <TableCount total={paid.length} from={from + 1} to={from + pageItems.length} />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('detail.fees.previousPage')}
              disabled={clampedPage <= 1}
              onClick={() => setPage(clampedPage - 1)}
            >
              <ChevronLeftIcon className="size-4" aria-hidden />
            </Button>
            <span className="text-text-secondary">
              {t('detail.fees.pageOf', {
                page: formatNumber(clampedPage, regionConfig),
                totalPages: formatNumber(totalPages, regionConfig),
              })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('detail.fees.nextPage')}
              disabled={clampedPage >= totalPages}
              onClick={() => setPage(clampedPage + 1)}
            >
              <ChevronRightIcon className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** [8.10.2]'s AC: "Fees tab shows outstanding, paid balance clearly."
 * [16.4.5] rewrites the breakdown below the summary tiles into three
 * sections — Open bills / Wallet / History — plus a disabled "Recurring
 * fees" placeholder tab reserved for 16.7.5 (not implemented here). */
export function FeesTab({ studentId }: FeesTabProps) {
  const { t } = useTranslation('students');
  const { t: tFees } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const query = useStudentFeeSummary(studentId);
  const canWriteOff = useHasPermission(Permission.FEE_APPROVE);
  // [8.15.38] The statement route needs both; a role with only one would get a 403 frame.
  const canReadInvoices = useHasPermission(Permission.INVOICE_READ);
  const canReadPayments = useHasPermission(Permission.PAYMENT_READ);
  const canSeeStatement = canReadInvoices && canReadPayments;
  const [writingOff, setWritingOff] = React.useState<StudentFee | null>(null);

  function money(amount: number | string): string {
    return formatServerAmount(amount, regionConfig);
  }

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.fees.errorMessage')}
    >
      {(feeSummary) => {
        const openBills = feeSummary.fee_breakdown.filter((fee) =>
          OPEN_STATUSES.includes(fee.status),
        );
        const owes = Number(feeSummary.summary.balance) > 0;
        return (
          <div className="flex flex-col gap-6">
            <Card aria-label={t('detail.fees.summaryLabel')}>
              <dl className="grid grid-cols-3 divide-x divide-border-subtle">
                <div className="p-4 md:p-5">
                  <dt className="text-caption text-text-secondary">
                    {t('detail.fees.totalBilled')}
                  </dt>
                  <dd className="mt-1 text-h3 tabular-nums md:text-h2">
                    {money(feeSummary.summary.total_due)}
                  </dd>
                </div>
                <div className="p-4 md:p-5">
                  <dt className="text-caption text-text-secondary">{t('detail.fees.totalPaid')}</dt>
                  <dd className="mt-1 text-h3 tabular-nums md:text-h2">
                    {money(feeSummary.summary.total_paid)}
                  </dd>
                </div>
                <div className="p-4 md:p-5">
                  <dt className="text-caption text-text-secondary">
                    {t('detail.fees.outstanding')}
                  </dt>
                  <dd
                    // Joined, not a template literal: the Tailwind prettier plugin trims a
                    // leading space inside the string, which fused the two classes before.
                    className={[
                      'mt-1 text-h3 tabular-nums md:text-h2',
                      owes && 'text-status-overdue-fg',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {money(feeSummary.summary.balance)}
                  </dd>
                </div>
              </dl>
            </Card>
            <Tabs defaultValue="open-bills" className="space-y-4">
              <TabsList
                className={[
                  'grid w-full md:inline-grid md:w-auto',
                  canSeeStatement ? 'grid-cols-5' : 'grid-cols-4',
                ].join(' ')}
              >
                <TabsTrigger value="open-bills" className="h-11 md:h-8">
                  {t('detail.fees.openBillsTab')}
                </TabsTrigger>
                <TabsTrigger value="wallet" className="h-11 md:h-8">
                  {t('detail.fees.walletTab')}
                </TabsTrigger>
                <TabsTrigger value="history" className="h-11 md:h-8">
                  {t('detail.fees.historyTab')}
                </TabsTrigger>
                <TabsTrigger value="discounts" className="h-11 md:h-8">
                  {t('detail.fees.discountsTab')}
                </TabsTrigger>
                {canSeeStatement && (
                  <TabsTrigger value="statement" className="h-11 md:h-8">
                    {tFees('statement.tabLabel')}
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="open-bills">
                <FeeLinesTable
                  fees={openBills}
                  tableId="student-fee-lines"
                  emptyTitle={t('detail.fees.emptyMessage')}
                  emptyExplanation={t('detail.fees.emptyExplanation')}
                  onWriteOff={canWriteOff ? setWritingOff : undefined}
                />
                {writingOff && (
                  <WriteOffBillDialog
                    open
                    onOpenChange={(next) => !next && setWritingOff(null)}
                    bill={writingOff}
                  />
                )}
              </TabsContent>
              <TabsContent value="wallet">
                <WalletSection studentId={studentId} />
              </TabsContent>
              <TabsContent value="history">
                <HistorySection fees={feeSummary.fee_breakdown} />
              </TabsContent>
              <TabsContent value="discounts">
                <DiscountsSection studentId={studentId} />
              </TabsContent>
              {canSeeStatement && (
                <TabsContent value="statement">
                  <StatementSection studentId={studentId} />
                </TabsContent>
              )}
            </Tabs>
          </div>
        );
      }}
    </TabQueryState>
  );
}
