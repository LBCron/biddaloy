/**
 * [53.3.03] The reader's notice list (`/portal/notices`): চলতি · পুরনো tabs, title search and a
 * year filter (D17) over `GET /notices/mine`. A row opens the detail in a dialog (which is the
 * "seen" write). Filter state is local, so any route can mount it.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import { formatDate, renderDigits } from '@biddaloy/ui/utils';
import { useState } from 'react';

import { MyNoticeDetail } from './my-notice-detail';
import { useMyNotices, type MyNoticeItem } from './use-my-notices';

const PAGE_SIZE = 20;
const YEARS_BACK = 5;

const badge = 'rounded-full px-2 py-0.5 text-caption';

export function MyNoticesList() {
  const { t } = useTranslation('portalNotices');
  const config = useRegionConfig();
  const [tab, setTab] = useState<'current' | 'archive'>('current');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const year = filters.year ? Number(filters.year) : undefined;
  const query = useMyNotices({
    tab,
    page,
    limit: PAGE_SIZE,
    ...(filters.q ? { q: filters.q } : {}),
    ...(year ? { year } : {}),
  });

  // The year list is the last few calendar years; the server clamps to the notices that exist.
  const thisYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: YEARS_BACK }, (_, i) => String(thisYear - i)).map(
    (y) => ({ value: y, label: renderDigits(y, config.numerals) }),
  );

  const columns: DataTableColumn<MyNoticeItem>[] = [
    {
      id: 'title',
      header: t('list.colTitle'),
      card: 'title',
      accessorFn: (n) => (
        <span className="flex flex-col gap-1">
          <button
            type="button"
            className={`min-h-11 text-start underline-offset-2 hover:underline ${
              n.seen ? '' : 'font-bold'
            }`}
            onClick={() => setOpenId(n.id)}
          >
            {n.title}
          </button>
          {n.forStudents.length > 0 ? (
            <span className="text-caption text-text-secondary">
              {t('forStudents', { names: n.forStudents.join('; ') })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'badges',
      header: t('list.colBadges'),
      card: 'badge',
      accessorFn: (n) => (
        <span className="flex flex-wrap gap-1">
          {n.important ? (
            <span className={`${badge} bg-status-overdue-bg text-status-overdue-fg`}>
              {t('badge.important')}
            </span>
          ) : null}
          {n.edited ? (
            <span className={`${badge} bg-muted text-text-secondary`}>{t('badge.edited')}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'date',
      header: t('list.colDate'),
      card: 'field',
      accessorFn: (n) => formatDate(n.published_at, config),
    },
  ];

  return (
    <>
      <ListShell
        title={t('title')}
        tabs={
          <Tabs
            value={tab}
            onValueChange={(next) => {
              setTab(next as 'current' | 'archive');
              setPage(1);
            }}
          >
            <TabsList variant="line" aria-label={t('title')}>
              <TabsTrigger value="current">{t('tabs.current')}</TabsTrigger>
              <TabsTrigger value="archive">{t('tabs.archive')}</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        filters={{
          fields: [
            {
              kind: 'text',
              key: 'q',
              label: t('list.search'),
              placeholder: t('list.searchPlaceholder'),
              primary: true,
            },
            {
              kind: 'select',
              key: 'year',
              label: t('list.year'),
              allLabel: t('list.allYears'),
              options: yearOptions,
            },
          ],
          values: filters,
          onChange: (patch) => {
            setFilters((prev) => {
              const next = { ...prev };
              for (const [k, v] of Object.entries(patch)) {
                if (v === null || v === '') delete next[k];
                else next[k] = v;
              }
              return next;
            });
            setPage(1);
          },
        }}
        tableId="portal-notices"
        caption={t('title')}
        columns={columns}
        data={query.data?.data ?? []}
        getRowId={(n) => n.id}
        sorting={null}
        onSortingChange={() => undefined}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={query.data?.total ?? 0}
        onPageChange={setPage}
        loading={query.isPending}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('error.message') } : {})}
        emptyState={{
          title: tab === 'current' ? t('list.emptyCurrent') : t('list.emptyArchive'),
          explanation: t('list.emptyExplanation'),
        }}
      />
      <Dialog open={openId !== null} onOpenChange={(open) => (open ? undefined : setOpenId(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="sr-only">{t('title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('detail.description')}</DialogDescription>
          </DialogHeader>
          {openId ? <MyNoticeDetail id={openId} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
