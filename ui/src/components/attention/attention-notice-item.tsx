/**
 * [53.5.03] The actions of a notice alert row. `notice.important`: open the notice, or the
 * filled "পড়েছি" button (the caller posts the acknowledge). `notice.sms-approval`: one link to
 * the full approval page (`?sms=1`), never an inline approve: it spends money. Presentational.
 */
import { AlertSource } from '@biddaloy/shared';
import { ArrowRightIcon, CheckIcon } from 'lucide-react';

import type { AlertItem } from '../../api/attention';
import { useTranslation } from '../../i18n';
import { Button } from '../button';
import { RowActions, type RowAction } from '../row-actions';

export const NOTICE_IMPORTANT = 'notice.important';
export const NOTICE_SMS_APPROVAL = 'notice.sms-approval';

export function isNoticeAlert(item: Pick<AlertItem, 'source' | 'ruleKey'>): boolean {
  return (
    item.source === AlertSource.NOTICE &&
    (item.ruleKey === NOTICE_IMPORTANT || item.ruleKey === NOTICE_SMS_APPROVAL)
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The notice id is the last path segment of the action URL (`/…/notices/:id`); only a UUID counts. */
export function noticeIdOf(item: Pick<AlertItem, 'actionUrl'>): string | undefined {
  const id = item.actionUrl?.split('?')[0]?.split('/').filter(Boolean).pop();
  return id && UUID.test(id) ? id : undefined;
}

export interface AttentionNoticeItemProps {
  item: AlertItem;
  /** Without it, the acknowledge button is not shown. `item` lets the caller key its busy/error state by card. */
  onAcknowledge?: (noticeId: string, item: AlertItem) => void;
  /** Set inside the attention modal: the open action becomes a button that runs the modal's own
   * open-and-close path. Without it, a plain link to `actionUrl` (the worklist). */
  onOpen?: () => void;
  busy?: boolean;
}

export function AttentionNoticeItem({
  item,
  onAcknowledge,
  onOpen,
  busy = false,
}: AttentionNoticeItemProps) {
  const { t } = useTranslation('attention');
  const noticeId = noticeIdOf(item);
  const important = item.ruleKey === NOTICE_IMPORTANT;
  const link: RowAction[] = item.actionUrl
    ? [
        {
          intent: 'view',
          display: 'text',
          icon: <ArrowRightIcon />,
          label: important ? t('notice.open') : t('notice.view'),
          ...(onOpen ? { onClick: onOpen } : { to: item.actionUrl }),
        },
      ]
    : [];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <RowActions actions={link} />
      {important && noticeId && onAcknowledge && (
        <Button
          type="button"
          size="sm"
          className="min-h-11 md:min-h-0"
          disabled={busy}
          aria-label={t('notice.acknowledgeNamed', { title: item.title })}
          onClick={() => onAcknowledge(noticeId, item)}
        >
          <CheckIcon aria-hidden />
          {t('notice.acknowledge')}
        </Button>
      )}
    </div>
  );
}
