/**
 * [67.2.05] One alert as a card: severity, what happened, why it matters, up to
 * three steps, then the actions. Amber alerts can be closed or snoozed, blue
 * ones only closed, red ones stay until the work is done (D4). Presentational.
 */
import { AlertSeverity } from '@biddaloy/shared';
import { LockIcon, XIcon } from 'lucide-react';
import * as React from 'react';

import type { AlertItem, SnoozeChoice } from '../../api/attention';
import { useLocale, useTranslation } from '../../i18n';
import { formatRelativeAge } from '../../utils';
import { Button } from '../button';

import { AlertSeverityBadge } from './alert-severity-badge';
import { AlertSnoozeMenu } from './alert-snooze-menu';
import { AttentionNoticeItem, isNoticeAlert } from './attention-notice-item';

const MAX_STEPS = 3;

export interface AlertItemCardProps {
  item: AlertItem;
  /** `'primary'` fills the action button; only one per view (P5). */
  emphasis?: 'primary' | 'secondary';
  onPrimary: (item: AlertItem) => void;
  onHide?: (item: AlertItem) => void;
  onSnooze?: (item: AlertItem, choice: SnoozeChoice, date?: string) => void;
  /** [53.5.03] "পড়েছি" for an important notice; the only way such a card leaves (D17). */
  onAcknowledge?: (noticeId: string, item: AlertItem) => void;
  busy?: boolean;
  error?: string;
}

export function AlertItemCard({
  item,
  emphasis = 'secondary',
  onPrimary,
  onHide,
  onSnooze,
  onAcknowledge,
  busy = false,
  error,
}: AlertItemCardProps) {
  const { t } = useTranslation('attention');
  const { locale } = useLocale();
  const titleId = React.useId();
  const whyId = React.useId();
  const about =
    item.studentName && item.sectionLabel
      ? t('item.about', { student: item.studentName, section: item.sectionLabel })
      : (item.studentName ?? item.sectionLabel);
  const notice = isNoticeAlert(item);
  const canSnooze = !notice && onSnooze && item.severity === AlertSeverity.WARNING && item.closable;

  return (
    <li
      tabIndex={-1}
      data-alert-item={item.recipientId}
      aria-labelledby={titleId}
      aria-describedby={whyId}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-text-secondary">
        <AlertSeverityBadge severity={item.severity} />
        <span>{formatRelativeAge(Date.parse(item.raisedAt), locale)}</span>
        {about && <span>{about}</span>}
      </div>
      <h4 id={titleId} className="text-h3">
        {item.title}
      </h4>
      <p id={whyId} className="text-text-secondary">
        {item.why}
      </p>
      {item.steps.length > 0 && (
        <ol className="list-decimal ps-5 text-text-secondary">
          {item.steps.slice(0, MAX_STEPS).map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {notice && (
          <AttentionNoticeItem
            item={item}
            busy={busy}
            onOpen={() => onPrimary(item)}
            {...(onAcknowledge ? { onAcknowledge } : {})}
          />
        )}
        {!notice && item.actionUrl && item.actionLabel && (
          <Button
            variant={emphasis === 'primary' ? 'default' : 'outline'}
            disabled={busy}
            className="min-h-11 md:min-h-0"
            onClick={() => onPrimary(item)}
          >
            {item.actionLabel}
          </Button>
        )}
        {canSnooze && (
          <AlertSnoozeMenu
            disabled={busy}
            label={t('item.snooze')}
            onSelect={(choice, date) => onSnooze(item, choice, date)}
          />
        )}
        {!notice && onHide && item.closable && (
          <Button
            variant="ghost"
            disabled={busy}
            aria-label={t('item.closeNamed', { title: item.title })}
            className="min-h-11 md:min-h-0"
            onClick={() => onHide(item)}
          >
            <XIcon aria-hidden />
            {t('item.close')}
          </Button>
        )}
        {!notice && !item.closable && (
          <span className="inline-flex items-center gap-1 text-caption text-text-secondary">
            <LockIcon className="size-3.5" aria-hidden />
            {t('item.locked')}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
