/**
 * [53.3.g1.01] Staff notice detail: header with badges and actions, tab
 * "Notice" (the text) and tab "Who has read it". The tab lives in `?tab=`.
 * The route (53.4.01) passes `noticeId`.
 */
import { Button, StatusBadge, toast } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab, type DetailShellAction } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import { NoticeStatusBadge, WithdrawDialog } from './notice-list';
import { NoticeReportTab } from './notice-report-tab';
import { useCopyNotice, useNotice, useWithdrawNotice } from './use-notices';

const TABS = ['notice', 'report'] as const;

export function NoticeDetail({ noticeId }: { noticeId: string }) {
  const { t } = useTranslation('notices');
  const config = useTenantRegionConfig();
  const query = useNotice(noticeId);
  const [tab, setTab] = useDetailShellTab(TABS);
  const [confirming, setConfirming] = React.useState(false);
  const withdraw = useWithdrawNotice();
  const copy = useCopyNotice();
  const notice = query.data;

  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-4">
        <p>{t('manage.notFound')}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t('manage.retry')}
        </Button>
      </div>
    );
  }
  if (!notice) return <div aria-busy="true" className="p-4" />;

  const facts = [
    ...(notice.publishedAt
      ? [{ label: t('manage.colPublished'), value: formatDate(notice.publishedAt, config) }]
      : []),
    ...(notice.editedAt
      ? [{ label: t('manage.colEdited'), value: formatDate(notice.editedAt, config) }]
      : []),
    ...(notice.authorName ? [{ label: t('manage.colAuthor'), value: notice.authorName }] : []),
  ];

  const actions: DetailShellAction[] = [
    {
      id: 'edit',
      label: t('manage.edit'),
      to: `/communications/notices/${notice.id}/edit`,
      allowed: notice.status !== 'WITHDRAWN',
    },
    {
      id: 'copy',
      label: t('manage.copyAction'),
      busy: copy.isPending,
      onClick: () =>
        copy.mutate(notice.id, {
          onSuccess: () => toast.success(t('manage.copied')),
          onError: () => toast.error(t('manage.actionError')),
        }),
    },
    {
      id: 'withdraw',
      label: t('manage.withdraw'),
      priority: 'destructive',
      allowed: notice.status === 'PUBLISHED',
      onClick: () => setConfirming(true),
    },
  ];

  return (
    <>
      <DetailShell
        name={notice.title}
        facts={facts}
        statusBadge={
          <span className="flex flex-wrap items-center gap-2">
            <NoticeStatusBadge status={notice.status} />
            {notice.important && <StatusBadge tone="danger" label={t('manage.important')} />}
            {notice.isPublic && <StatusBadge tone="info" label={t('manage.public')} />}
          </span>
        }
        actions={actions}
        activeTab={tab}
        onTabChange={setTab}
        tabs={[
          {
            id: 'notice',
            label: t('manage.tabNotice'),
            content: (
              <div className="flex flex-col gap-4">
                {/* 53.6.01 mounts the public-link and SMS panels here. */}
                <div data-slot="notice-extras" />
                <p className="whitespace-pre-line">{notice.body || t('manage.noBody')}</p>
              </div>
            ),
          },
          {
            id: 'report',
            label: t('manage.tabReport'),
            content: <NoticeReportTab noticeId={notice.id} />,
          },
        ]}
      />
      <WithdrawDialog
        notice={confirming ? notice : null}
        onClose={() => setConfirming(false)}
        busy={withdraw.isPending}
        onConfirm={(n) =>
          withdraw.mutate(n.id, {
            onSuccess: () => toast.success(t('manage.withdrawn')),
            onError: () => toast.error(t('manage.actionError')),
            onSettled: () => setConfirming(false),
          })
        }
      />
    </>
  );
}
