/**
 * [53.3.g1.01] "Who has read it": five counts, then a paged table of people by
 * name (never ids) with a status filter.
 */
import {
  Button,
  Card,
  DataTable,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, renderDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

import { useNoticeReport, type NoticeReport, type NoticeReportStatus } from './use-notices';

const PAGE_SIZE = 25;
const ALL = 'ALL';
const STATUSES: readonly NoticeReportStatus[] = ['SEEN', 'UNSEEN', 'ACKNOWLEDGED', 'UNREACHABLE'];

type Person = NoticeReport['items'][number];

export function NoticeReportTab({ noticeId }: { noticeId: string }) {
  const { t } = useTranslation('notices');
  const config = useTenantRegionConfig();
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<NoticeReportStatus | undefined>(undefined);
  const query = useNoticeReport(noticeId, { page, limit: PAGE_SIZE, status });
  const fmt = (n: number) => renderDigits(String(n), config.numerals);
  const totals = query.data?.totals;

  const counts = [
    ['total', totals?.people],
    ['seen', totals?.seen],
    ['linkOpened', totals?.linkOpened],
    ['acknowledged', totals?.acknowledged],
    ['unreachable', totals?.unreachable],
  ] as const;

  const when = (v: string | null) => (v ? formatDateTime(v, config) : t('manage.report.no'));
  const columns: DataTableColumn<Person>[] = [
    {
      id: 'name',
      header: t('manage.report.colName'),
      accessorFn: (p) => <span className="font-medium">{p.name}</span>,
      card: 'title',
    },
    {
      id: 'for',
      header: t('manage.report.colFor'),
      accessorFn: (p) => p.forStudent ?? '—',
      card: 'subtitle',
    },
    { id: 'seen', header: t('manage.report.colSeen'), accessorFn: (p) => when(p.seenAt) },
    { id: 'link', header: t('manage.report.colLink'), accessorFn: (p) => when(p.linkOpenedAt) },
    {
      id: 'read',
      header: t('manage.report.colRead'),
      accessorFn: (p) => (p.acknowledgedAt ? t('manage.report.yes') : t('manage.report.no')),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label={t('manage.tabReport')}>
        {counts.map(([key, value]) => (
          <Card key={key} padded className="flex flex-col gap-1">
            <dt className="text-caption text-text-secondary">{t(`manage.report.${key}`)}</dt>
            <dd className="text-h2">{value === undefined ? '—' : fmt(value)}</dd>
          </Card>
        ))}
      </dl>
      <div className="flex max-w-xs flex-col gap-1">
        <label htmlFor="notice-report-status" className="text-label font-medium">
          {t('manage.report.filter')}
        </label>
        <Select
          value={status ?? ALL}
          onValueChange={(v) => {
            setStatus(STATUSES.find((s) => s === v));
            setPage(1);
          }}
        >
          <SelectTrigger id="notice-report-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('manage.report.all')}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`manage.report.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        tableId="notice-report"
        caption={t('manage.report.tableCaption')}
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(p) => p.id}
        sorting={null}
        onSortingChange={() => undefined}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={query.data?.total ?? 0}
        onPageChange={setPage}
        loading={query.isLoading}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('manage.report.loadError') } : {})}
        emptyState={{ title: t('manage.report.empty'), explanation: t('manage.report.emptyBody') }}
      />
      {query.isError && (
        <Button variant="outline" className="self-start" onClick={() => void query.refetch()}>
          {t('manage.retry')}
        </Button>
      )}
    </div>
  );
}
