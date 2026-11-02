/**
 * [67.2.06] The to-do list behind the attention bar: a dialog (full screen on a
 * phone) grouping alerts Urgent, Warning, Reminder. Keyboard (D16): arrows move
 * between cards, Enter does the main action, X closes a closable card. Focus
 * returns to whatever opened the dialog on close (then `returnFocusRef`, then
 * the shell's `<main>` if both are gone, e.g. the bar unmounted after the last
 * alert was hidden), except after the main action (the user is navigating away).
 * Presentational: the shell wires data and callbacks.
 */
import { AlertSeverity } from '@biddaloy/shared';
import * as React from 'react';

import type { AlertItem, AttentionSummary, SnoozeChoice } from '../../api/attention';
import { useLocale, useTranslation } from '../../i18n';
import { formatRelativeAge } from '../../utils';
import { APP_SHELL_MAIN_ID } from '../app-shell';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog';
import { ErrorState } from '../error-state';
import { Skeleton } from '../skeleton';

import { AlertItemCard } from './alert-item-card';

const STALE_AFTER_MINUTES = 15;
const SEVERITIES = [AlertSeverity.CRITICAL, AlertSeverity.WARNING, AlertSeverity.REMINDER] as const;

export interface AttentionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly AlertItem[];
  summary: AttentionSummary | undefined;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onPrimary: (item: AlertItem) => void;
  onHide: (item: AlertItem) => void;
  onSnooze: (item: AlertItem, choice: SnoozeChoice, date?: string) => void;
  /** [53.5.03] "পড়েছি" on an important notice card. */
  onAcknowledge?: (noticeId: string, item: AlertItem) => void;
  /** Per-card busy flag / error line, keyed by `recipientId`. */
  itemState?: Record<string, { busy?: boolean; error?: string }>;
  /** Where "See all to-do" goes, and how many that list holds. */
  todoHref: string;
  todoCount: number;
  /** Focus falls back here on close when the opener is gone (normally the bar's button). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Renders the footer link through the app router; defaults to a plain `<a>`. */
  renderLink?: (href: string, children: React.ReactNode) => React.ReactNode;
}

export function AttentionModal({
  open,
  onOpenChange,
  items,
  summary,
  loading = false,
  error = false,
  onRetry,
  onPrimary,
  onHide,
  onSnooze,
  onAcknowledge,
  itemState,
  todoHref,
  todoCount,
  returnFocusRef,
  renderLink = (href, children) => <a href={href}>{children}</a>,
}: AttentionModalProps) {
  const { t } = useTranslation('attention');
  const { locale } = useLocale();
  const listRef = React.useRef<HTMLDivElement>(null);
  const skipReturn = React.useRef(false);
  const opener = React.useRef<HTMLElement | null>(null);
  const idBase = React.useId();
  const numbers = new Intl.NumberFormat(locale, { useGrouping: false });

  const cards = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-alert-item]') ?? []);

  // The cards may arrive after the dialog opens (onOpenAutoFocus finds none), or after a
  // Retry (loading stays false through it): focus the first once they do.
  const showingCards = !loading && !error && items.length > 0;
  React.useEffect(() => {
    if (open && showingCards && !listRef.current?.contains(document.activeElement))
      cards()[0]?.focus();
  }, [open, showingCards]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    // React bubbles events out of portals (the snooze menu and date dialog); only handle our own DOM.
    if (!listRef.current?.contains(target)) return;
    const all = cards();
    const card = target.closest<HTMLElement>('[data-alert-item]');
    const index = card ? all.indexOf(card) : -1;
    const item = card ? items.find((i) => i.recipientId === card.dataset.alertItem) : undefined;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (all.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      all[(index + step + all.length) % all.length]?.focus();
    } else if (event.key === 'Enter' && item && target === card) {
      event.preventDefault();
      skipReturn.current = true;
      onPrimary(item);
    } else if ((event.key === 'x' || event.key === 'X') && item && target === card) {
      if (!item.closable || itemState?.[item.recipientId]?.busy) return;
      event.preventDefault();
      (all[index + 1] ?? all[index - 1])?.focus();
      onHide(item);
    }
  }

  const groups = SEVERITIES.map((severity) => ({
    severity,
    items: items.filter((i) => i.severity === severity),
  })).filter((g) => g.items.length > 0);
  const firstId = items[0]?.recipientId;
  const stale = summary && summary.staleMinutes > STALE_AFTER_MINUTES;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        fullScreenOnPhone
        closeLabel={t('item.close')}
        onOpenAutoFocus={(event) => {
          // Focus has not moved yet: remember who opened us (the bar, the bell, the palette).
          const active = document.activeElement;
          opener.current =
            active instanceof HTMLElement && active !== document.body ? active : null;
          // No card yet (loading, error, empty): let Radix focus inside the dialog;
          // the effect above takes over once cards arrive.
          const first = cards()[0];
          if (first) {
            event.preventDefault();
            first.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          const target =
            (opener.current?.isConnected ? opener.current : returnFocusRef?.current) ??
            document.getElementById(APP_SHELL_MAIN_ID);
          if (!skipReturn.current && target) {
            event.preventDefault();
            target.focus();
          }
          skipReturn.current = false;
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('modal.title')}</DialogTitle>
          <DialogDescription>
            {summary?.updatedAt &&
              t('modal.updated', { age: formatRelativeAge(Date.parse(summary.updatedAt), locale) })}
            {stale && (
              <span className="block text-status-due-fg">
                {t('modal.stale', { n: numbers.format(summary.staleMinutes) })}
              </span>
            )}
            <span className="sr-only"> {t('modal.keyboardHint')}</span>
          </DialogDescription>
        </DialogHeader>

        {/* The container only relays arrow/Enter/X from the focused cards. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div ref={listRef} onKeyDown={handleKeyDown} className="flex flex-col gap-4">
          {loading ? (
            <div aria-hidden className="flex flex-col gap-3">
              {[0, 1, 2].map((n) => (
                <Skeleton key={n} className="h-28 w-full" />
              ))}
            </div>
          ) : error ? (
            <ErrorState
              message={t('modal.loadError')}
              onRetry={onRetry}
              retryLabel={t('modal.retry')}
            />
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-text-secondary">{t('modal.empty')}</p>
          ) : (
            groups.map(({ severity, items: group }) => {
              const headingId = `${idBase}-${severity}`;
              return (
                <section key={severity} aria-labelledby={headingId} className="flex flex-col gap-2">
                  <h3 id={headingId} className="text-label text-text-secondary">
                    {t('groupHeading', {
                      label: t(`severity.${severity}`),
                      n: numbers.format(group.length),
                    })}
                  </h3>
                  <ul className="flex flex-col gap-3">
                    {group.map((item) => (
                      <AlertItemCard
                        key={item.recipientId}
                        item={item}
                        emphasis={item.recipientId === firstId ? 'primary' : 'secondary'}
                        onPrimary={(i) => {
                          skipReturn.current = true;
                          onPrimary(i);
                        }}
                        onHide={onHide}
                        onSnooze={onSnooze}
                        {...(onAcknowledge ? { onAcknowledge } : {})}
                        {...itemState?.[item.recipientId]}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>

        <DialogFooter>
          <span className="text-label font-medium text-primary underline-offset-2 hover:underline">
            {renderLink(todoHref, t('modal.seeAll', { n: numbers.format(todoCount) }))}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
