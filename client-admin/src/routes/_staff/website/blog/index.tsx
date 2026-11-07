/**
 * [40.3.07] Website › Blog list. One row per post (kind POST): title, draft or published, date.
 * Gated by `route-permissions.ts` (`WEBSITE_MANAGE`); the component checks nothing itself.
 */
import {
  RoutePending,
  StatusBadge,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import { usePosts, type SitePost } from '@biddaloy/ui/hooks';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/website/blog/')({
  loader: () => loadRouteNamespaces('website', 'nav'),
  pendingComponent: BlogPending,
  component: BlogList,
});

function BlogPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label')} />;
}

function BlogList() {
  const { t } = useTranslation('website');
  const { locale } = useLocale();
  const config = useTenantRegionConfig();
  const query = usePosts();
  const posts = (query.data?.items ?? []).filter((p) => p.kind === 'POST');
  const titleOf = (p: SitePost) => p.title[locale] || p.title.bn || t('blog.untitled');

  const columns: DataTableColumn<SitePost>[] = [
    {
      id: 'title',
      header: t('blog.colTitle'),
      accessorFn: (p) => <span className="font-medium">{p.title.bn || t('blog.untitled')}</span>,
      card: 'title',
    },
    {
      id: 'status',
      header: t('blog.colStatus'),
      accessorFn: (p) => (
        <StatusBadge
          tone={p.published_at ? 'success' : 'neutral'}
          label={p.published_at ? t('blog.published') : t('blog.draft')}
        />
      ),
      card: 'badge',
    },
    {
      id: 'date',
      header: t('blog.colDate'),
      accessorFn: (p) => formatDate(p.published_at ?? p.updated_at, config),
    },
  ];

  const rowActions = (p: SitePost): RowAction[] => [
    {
      intent: 'view',
      label: t('blog.openPost', { title: titleOf(p) }),
      to: `/website/blog/${p.id}`,
      'data-focus-anchor': p.id,
    },
  ];

  return (
    <ListShell
      title={t('blog.title')}
      subtitle={t('blog.listCaption')}
      actions={[{ id: 'new', label: t('blog.new'), priority: 'primary', to: '/website/blog/new' }]}
      tableId="website-blog"
      caption={t('blog.tableCaption')}
      data={posts}
      getRowId={(p) => p.id}
      sorting={null}
      onSortingChange={() => undefined}
      // ponytail: the list API has no paging and a school writes tens of posts, so one page.
      paginated={false}
      page={1}
      pageSize={Math.max(posts.length, 1)}
      totalCount={posts.length}
      onPageChange={() => undefined}
      loading={query.isLoading}
      isFetching={query.isFetching}
      columns={columns}
      rowActions={rowActions}
      {...(query.isError ? { error: t('blog.loadError') } : {})}
      emptyState={{ title: t('blog.emptyTitle'), explanation: t('blog.emptyBody') }}
    />
  );
}
