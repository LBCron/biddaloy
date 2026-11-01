/**
 * [53.3.03] "সাম্প্রতিক নোটিশ": the latest 3 current notices (the server lists pinned first).
 * Cloned from the portal homework card. `LatestNoticesCardView` is presentational (stories);
 * `LatestNoticesCard` owns the query and mounts the phone and desktop renderings.
 * ponytail: plain `<a>` to the list — `/portal/notices` joins the typed route tree with its route ticket.
 */
import { WidgetCard } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { BellIcon } from 'lucide-react';

import { useMyNotices, type MyNoticeItem } from './use-my-notices';

const ROWS = 3;
const LIST_HREF = '/portal/notices';

export interface LatestNoticesCardViewProps {
  variant: 'full' | 'compact';
  items: MyNoticeItem[];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function LatestNoticesCardView({
  variant,
  items,
  loading = false,
  failed = false,
  onRetry,
}: LatestNoticesCardViewProps) {
  const { t } = useTranslation('portalNotices');
  const config = useRegionConfig();
  const link = (
    <a href={LIST_HREF} className="text-primary underline">
      {t('card.link')}
    </a>
  );
  const first = items[0];
  return (
    <WidgetCard
      title={t('card.title')}
      variant={variant}
      loading={loading}
      loadingLabel={t('card.title')}
      {...(failed && onRetry
        ? { error: { message: t('error.message'), retryLabel: t('error.retry'), onRetry } }
        : {})}
      {...(!loading && !failed && items.length === 0
        ? { empty: { reason: t('card.empty'), action: link } }
        : {})}
      {...(first && variant === 'compact' ? { summary: first.title } : {})}
      {...(items.length > 0 ? { footer: link } : {})}
    >
      <ul className="divide-y divide-border-subtle">
        {items.slice(0, ROWS).map((n) => (
          <li key={n.id} className="flex min-h-11 items-start gap-3 py-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
              <BellIcon className="size-5" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={n.seen ? 'font-medium' : 'font-bold'}>{n.title}</span>
              <span className="text-caption text-text-secondary">
                {formatDate(n.published_at, config)}
                {n.important ? ` · ${t('badge.important')}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

/** `variant` pins one rendering (the dashboard grid already picks per breakpoint); omitted = both, for the portal page. */
export function LatestNoticesCard({ variant }: { variant?: 'full' | 'compact' }) {
  const query = useMyNotices({ tab: 'current', page: 1, limit: ROWS });
  const props = {
    items: query.data?.data ?? [],
    loading: query.isPending,
    failed: query.isError,
    onRetry: () => void query.refetch(),
  };
  if (variant) return <LatestNoticesCardView variant={variant} {...props} />;
  return (
    <>
      <div className="hidden h-full md:block">
        <LatestNoticesCardView variant="full" {...props} />
      </div>
      <div className="md:hidden">
        <LatestNoticesCardView variant="compact" {...props} />
      </div>
    </>
  );
}
