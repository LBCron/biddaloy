/**
 * [53.3.03] "সাম্প্রতিক নোটিশ": the latest 3 current notices (the server lists pinned first).
 * Cloned from the portal homework card. `LatestNoticesCardView` is presentational (stories);
 * `LatestNoticesCard` owns the query and mounts the phone and desktop renderings.
 * `portalLinks` (the portal Overview) makes each row a router link to `/portal/notices/<id>` and adds
 * "সব নোটিশ" to `/portal/notices` (#3437). The staff dashboard widget passes none: the staff notice
 * routes are gated by NOTICE_POST, and staff with only NOTICE_READ have no reader route yet (#3448),
 * so a link there would bounce them; `/portal/notices` would bounce staff to the dashboard too.
 */
import { WidgetCard } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { BellIcon } from 'lucide-react';

import { useMyNotices, type MyNoticeItem } from './use-my-notices';

const ROWS = 3;

export interface LatestNoticesCardViewProps {
  variant: 'full' | 'compact';
  items: MyNoticeItem[];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  /** Portal reader: rows open the notice, footer opens the list. Omitted (staff): plain rows, no link. */
  portalLinks?: boolean | undefined;
}

export function LatestNoticesCardView({
  variant,
  items,
  loading = false,
  failed = false,
  onRetry,
  portalLinks = false,
}: LatestNoticesCardViewProps) {
  const { t } = useTranslation('portalNotices');
  const config = useRegionConfig();
  const link = portalLinks ? (
    <Link to="/portal/notices" className="text-primary underline">
      {t('card.link')}
    </Link>
  ) : undefined;
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
        ? { empty: { reason: t('card.empty'), ...(link ? { action: link } : {}) } }
        : {})}
      {...(first && variant === 'compact' ? { summary: first.title } : {})}
      {...(link && items.length > 0 ? { footer: link } : {})}
    >
      <ul className="divide-y divide-border-subtle">
        {items.slice(0, ROWS).map((n) => {
          const row = (
            <>
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
            </>
          );
          const rowClass = 'flex min-h-11 items-start gap-3 py-2.5';
          return (
            <li key={n.id} className={portalLinks ? undefined : rowClass}>
              {portalLinks ? (
                <Link
                  to="/portal/notices/$noticeId"
                  params={{ noticeId: n.id }}
                  className={`${rowClass} hover:bg-muted/50`}
                >
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
    </WidgetCard>
  );
}

/** `variant` pins one rendering (the dashboard grid already picks per breakpoint); omitted = both, for the portal page. */
export function LatestNoticesCard({
  variant,
  portalLinks,
}: {
  variant?: 'full' | 'compact';
  portalLinks?: boolean;
}) {
  const query = useMyNotices({ tab: 'current', page: 1, limit: ROWS });
  const props = {
    portalLinks,
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
