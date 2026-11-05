/**
 * [8.9.8]'s notification centre — the bell keeps history of async outcomes
 * (a bulk import finishing, a reminder batch completing, an SMS delivery
 * failing) for anything a user missed while on another screen. Toasts
 * (`./toast.tsx`) already give immediate, polite-announced feedback; this
 * is the separate, longer-lived list, backed by `../api/notification-
 * state.ts` and its `useSyncExternalStore` hooks (`../hooks/
 * notifications.ts`).
 *
 * Built on `./popover.tsx`, not `./menu.tsx` — see that wrapper's own
 * comment for why a plain popover (ordinary Tab order) fits a
 * read/unread list better than `Menu`'s roving-tabindex command-list ARIA
 * pattern. Radix's own focus-trap-on-open/focus-return-on-close covers
 * keyboard operability, same as `Dialog` (`dialog.test.tsx` already
 * exercises that behaviour end to end for the primitive family).
 *
 * [8.14.11]: this component now resolves its own strings via
 * `useTranslation('nav')` instead of taking four label props, matching
 * `tenant-bar.tsx:65` and `sync-status.tsx:114`. The props are kept as
 * optional overrides so Storybook can pin copy.
 *
 * The badge count goes through `Intl.NumberFormat(locale)`, **not**
 * `useRegionConfig()`. This component renders in `_staff.tsx`'s app
 * chrome, outside every `RegionConfigProvider` in the app, so
 * `useRegionConfig()` would fall back to that context's default value
 * `REGION_BD_BN` and print Bengali digits to an English user. Locale is
 * the honest input here, same as `formatRelativeAge` already takes.
 */
import { Link } from '@tanstack/react-router';
import { BellIcon } from 'lucide-react';
import * as React from 'react';

import { markAllNotificationsRead, markNotificationRead } from '../api/notification-state';
import { useNotifications, useUnreadNotificationCount } from '../hooks/notifications';
import { useLocale, useTranslation } from '../i18n';

import { Button } from './button';
import { NotificationList } from './notification-list';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from './popover';
import { Skeleton } from './skeleton';

/** [67.2.04] The attention engine's view for the bell: badge = active count (D19). */
export interface NotificationBellAttention {
  count: number;
  /** OPEN items only (the badge also counts hidden ones): the "Show" button needs one to show. */
  openCount: number;
  topTitle: string | null;
  status: 'loading' | 'error' | 'ready';
  onRetry: () => void;
  onOpen: () => void;
  /** Route path (may carry `?tab=active`) for "See all to-do". */
  todoTo: string;
}

export interface NotificationBellProps {
  /** Overrides the translated trigger label. */
  label?: string;
  /** Overrides the translated panel title. */
  panelTitle?: string;
  /** Overrides the translated empty-state copy. */
  emptyLabel?: string;
  /** Overrides the translated "mark all read" label. */
  markAllReadLabel?: string;
  /** When set, the panel grows a footer link to the full history page.
   * A plain route path, untyped against any consumer's generated route
   * tree, for the same reason `AppShellNavItem['to']` (`./app-shell.tsx`)
   * is. */
  viewAllTo?: string;
  /** When set, the badge counts active alerts and a section lists the top one. */
  attention?: NotificationBellAttention;
}

export function NotificationBell({
  label,
  panelTitle,
  emptyLabel,
  markAllReadLabel,
  viewAllTo,
  attention,
}: NotificationBellProps) {
  const { t } = useTranslation('nav');
  const { locale } = useLocale();
  const notifications = useNotifications();
  const unreadCount = useUnreadNotificationCount();
  // Controlled only so the view-all link can close the panel on click, and
  // return focus to the trigger, the same as any other in-panel navigation
  // away from this popover.
  const [open, setOpen] = React.useState(false);
  const sectionId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const resolvedLabel = label ?? t('notifications.bellLabel');
  const resolvedPanelTitle = panelTitle ?? t('notifications.panelLabel');
  const resolvedEmptyLabel = emptyLabel ?? t('notifications.empty');
  const resolvedMarkAllReadLabel = markAllReadLabel ?? t('notifications.markAllRead');

  // The kit writes `9999`, not `9,999` — no grouping.
  const badgeCount = attention ? attention.count : unreadCount;
  const badgeText =
    badgeCount > 9999
      ? t('notifications.badgeOverflow', { count: 9999 })
      : new Intl.NumberFormat(locale, { useGrouping: false }).format(badgeCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          iconOnly
          aria-label={
            badgeCount > 0
              ? t(attention ? 'notifications.bellLabelActive' : 'notifications.bellLabelUnread', {
                  count: badgeCount,
                  // The exact badge text, so the name always contains what is on screen
                  // (WCAG 2.5.3); `count` only picks the plural form.
                  badge: badgeText,
                })
              : resolvedLabel
          }
          className="relative size-11 md:size-9"
        >
          <BellIcon />
          {badgeCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute start-1/2 top-0.5 ms-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-caption font-medium text-destructive-foreground md:-top-0.5"
            >
              {badgeText}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={resolvedPanelTitle} className="w-80">
        <PopoverHeader className="flex-row items-center justify-between">
          <PopoverTitle>{resolvedPanelTitle}</PopoverTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            onClick={() => markAllNotificationsRead()}
          >
            {resolvedMarkAllReadLabel}
          </Button>
        </PopoverHeader>
        {attention && (
          <section aria-labelledby={`${sectionId}-attention`} className="flex flex-col gap-2 p-2">
            <h3 id={`${sectionId}-attention`} className="text-label text-text-secondary">
              {t('notifications.attentionTitle')}
            </h3>
            {attention.status === 'loading' ? (
              <Skeleton className="h-5 w-full" />
            ) : attention.status === 'error' ? (
              <>
                <p className="text-sm">{t('notifications.attentionError')}</p>
                <Button type="button" variant="outline" size="sm" onClick={attention.onRetry}>
                  {t('notifications.attentionRetry')}
                </Button>
              </>
            ) : attention.count === 0 ? (
              <p className="text-sm text-text-secondary">{t('notifications.attentionNone')}</p>
            ) : (
              <>
                {attention.topTitle && <p className="truncate text-sm">{attention.topTitle}</p>}
                <div className="flex items-center justify-between gap-2">
                  {attention.openCount > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        // The panel animates out, so "Show" is still focused when the modal
                        // records its opener: hand focus to the bell first so Esc returns here.
                        triggerRef.current?.focus();
                        setOpen(false);
                        attention.onOpen();
                      }}
                    >
                      {t('notifications.attentionOpen')}
                    </Button>
                  )}
                  <Link
                    // The raw path: a split `search` object would JSON-quote values like `1`.
                    to={attention.todoTo}
                    onClick={() => setOpen(false)}
                    className="rounded-md p-2 text-sm text-primary hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {t('notifications.attentionTodo')}
                  </Link>
                </div>
              </>
            )}
          </section>
        )}
        {attention && (
          <h3 className="px-2 pt-2 text-label text-text-secondary">
            {t('notifications.deviceTitle')}
          </h3>
        )}
        <NotificationList
          notifications={notifications}
          onMarkRead={markNotificationRead}
          emptyLabel={resolvedEmptyLabel}
          className="max-h-80"
        />
        {viewAllTo !== undefined && (
          <Link
            to={viewAllTo}
            onClick={() => setOpen(false)}
            className="mt-1 block rounded-md p-2 text-sm text-primary hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t('notifications.viewAll')}
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
