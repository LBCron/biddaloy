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

/** The notice id is the last path segment of the alert's action URL (`/…/notices/:id`). */
export function noticeIdOf(item: Pick<AlertItem, 'actionUrl'>): string | undefined {
  return item.actionUrl?.split('?')[0]?.split('/').filter(Boolean).pop();
}

export interface AttentionNoticeItemProps {
  item: AlertItem;
  onAcknowledge: (noticeId: string) => void;
  busy?: boolean;
}

export function AttentionNoticeItem({
  item,
  onAcknowledge,
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
          to: item.actionUrl,
        },
      ]
    : [];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <RowActions actions={link} />
      {important && noticeId && (
        <Button
          type="button"
          size="sm"
          className="min-h-11 md:min-h-0"
          disabled={busy}
          aria-label={t('notice.acknowledgeNamed', { title: item.title })}
          onClick={() => onAcknowledge(noticeId)}
        >
          <CheckIcon aria-hidden />
          {t('notice.acknowledge')}
        </Button>
      )}
    </div>
  );
}
