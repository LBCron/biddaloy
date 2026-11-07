/**
 * [53.3.g1.01] Staff notice list: title search, status filter, one row per
 * notice with who sees it and how many did. Withdraw asks first. The route
 * (53.4.01) mounts this at /communications/notices.
 */
import {
  ConfirmDialog,
  StatusBadge,
  toast,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDate, renderDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

import {
  useCopyNotice,
  useNotices,
  useWithdrawNotice,
  type Notice,
  type NoticeStatus,
} from './use-notices';

const STATUSES: readonly NoticeStatus[] = ['DRAFT', 'PUBLISHED', 'WITHDRAWN'];
const STATUS_TONE = { DRAFT: 'neutral', PUBLISHED: 'success', WITHDRAWN: 'warning' } as const;

export function NoticeStatusBadge({ status }: { status: NoticeStatus }) {
  const { t } = useTranslation('notices');
  return <StatusBadge tone={STATUS_TONE[status]} label={t(`manage.status.${status}`)} />;
}

export function NoticeList() {
  const { t } = useTranslation('notices');
  const config = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: 25 });
  const [withdrawing, setWithdrawing] = React.useState<Notice | null>(null);
  const withdraw = useWithdrawNotice();
  const copy = useCopyNotice();
  const fmt = (n: number) => renderDigits(String(n), config.numerals);

  const status = STATUSES.find((s) => s === state.filters.status);
  const q = state.filters.q?.trim() || undefined;
  const onWebsite = state.filters.onWebsite === 'true';
  const query = useNotices({
    page: state.page,
    limit: state.limit,
    status,
    q,
    ...(onWebsite ? { isPublic: true } : {}),
  });
  const filtered = status !== undefined || q !== undefined || onWebsite;

  const columns: DataTableColumn<Notice>[] = [
    {
      id: 'title',
      header: t('manage.colTitle'),
      accessorFn: (n) => <span className="font-medium">{n.title}</span>,
      card: 'title',
    },
    {
      id: 'status',
      header: t('manage.colStatus'),
      accessorFn: (n) => <NoticeStatusBadge status={n.status} />,
      card: 'badge',
    },
    {
      id: 'who',
      header: t('manage.colWho'),
      accessorFn: (n) => fmt(n.recipientCount),
      align: 'end',
    },
    {
      id: 'seen',
      header: t('manage.colSeen'),
      accessorFn: (n) =>
        n.status === 'DRAFT'
          ? '—'
          : t('manage.seenValue', { seen: fmt(n.seenCount), total: fmt(n.recipientCount) }),
      card: 'subtitle',
    },
    {
      id: 'published',
      header: t('manage.colPublished'),
      accessorFn: (n) => (n.publishedAt ? formatDate(n.publishedAt, config) : '—'),
    },
  ];

  const rowActions = (n: Notice): RowAction[] => [
    {
      intent: 'view',
      label: t('manage.open', { title: n.title }),
      to: `/communications/notices/${n.id}`,
      'data-focus-anchor': n.id,
    },
    {
      intent: 'duplicate',
      label: t('manage.copy', { title: n.title }),
      busy: copy.isPending && copy.variables === n.id,
      onClick: () =>
        copy.mutate(n.id, {
          onSuccess: () => toast.success(t('manage.copied')),
          onError: () => toast.error(t('manage.actionError')),
        }),
    },
    {
      intent: 'remove',
      label: t('manage.withdraw'),
      allowed: n.status === 'PUBLISHED',
      onClick: () => setWithdrawing(n),
    },
  ];

  return (
    <>
      <ListShell
        title={t('manage.listTitle')}
        subtitle={t('manage.listCaption')}
        actions={[
          {
            id: 'give',
            label: t('manage.give'),
            priority: 'primary',
            to: '/communications/notices/new',
          },
        ]}
        filters={{
          fields: [
            {
              kind: 'text',
              key: 'q',
              label: t('manage.searchLabel'),
              placeholder: t('manage.searchPlaceholder'),
              primary: true,
            },
            {
              kind: 'select',
              key: 'status',
              label: t('manage.statusFilter'),
              allLabel: t('manage.allStatuses'),
              options: STATUSES.map((s) => ({ value: s, label: t(`manage.status.${s}`) })),
            },
            {
              kind: 'select',
              key: 'onWebsite',
              label: t('filters.onWebsiteLabel'),
              allLabel: t('filters.allNotices'),
              options: [{ value: 'true', label: t('filters.onWebsite') }],
            },
          ],
          values: state.filters,
          onChange: actions.setFilters,
          resultCount: query.data?.total ?? 0,
        }}
        tableId="staff-notices"
        caption={t('manage.tableCaption')}
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(n) => n.id}
        sorting={null}
        onSortingChange={() => undefined}
        page={state.page}
        pageSize={state.limit}
        totalCount={query.data?.total ?? 0}
        onPageChange={actions.setPage}
        loading={query.isLoading}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('manage.loadError') } : {})}
        rowActions={rowActions}
        emptyState={
          filtered
            ? { title: t('manage.noMatch'), explanation: t('manage.noMatchBody') }
            : { title: t('manage.emptyTitle'), explanation: t('manage.emptyBody') }
        }
      />
      <WithdrawDialog
        notice={withdrawing}
        onClose={() => setWithdrawing(null)}
        busy={withdraw.isPending}
        onConfirm={(n) =>
          withdraw.mutate(n.id, {
            onSuccess: () => toast.success(t('manage.withdrawn')),
            onError: () => toast.error(t('manage.actionError')),
            onSettled: () => setWithdrawing(null),
          })
        }
      />
    </>
  );
}

/** Shared by the list row and the detail header: nothing is withdrawn without this question. */
export function WithdrawDialog({
  notice,
  onClose,
  onConfirm,
  busy,
}: {
  notice: Notice | null;
  onClose: () => void;
  onConfirm: (n: Notice) => void;
  busy: boolean;
}) {
  const { t } = useTranslation('notices');
  const config = useTenantRegionConfig();
  return (
    <ConfirmDialog
      open={notice !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('manage.withdrawTitle')}
      description={t('manage.withdrawBody', {
        n: renderDigits(String(notice?.recipientCount ?? 0), config.numerals),
      })}
      confirmLabel={t('manage.withdraw')}
      busy={busy}
      onConfirm={() => {
        if (notice) onConfirm(notice);
      }}
    />
  );
}
