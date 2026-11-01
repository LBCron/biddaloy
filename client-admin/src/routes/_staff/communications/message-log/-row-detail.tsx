/**
 * [97.4.02] One message of the log (D22): who, how, by whom, the message itself, and the Check
 * status button (D23). The button shows only when the server's row says it can work
 * (`can_check_status`); the server still decides, and the page shows its own translated sentence
 * for a refusal, never the server's or the company's text (Rule 23/24).
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  StatusBadge,
} from '@biddaloy/ui/components';
import type { ReminderBatchLog } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, formatNumber, formatPhone } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';

import { deliveryErrorKey } from '../-shared/delivery-error';

export interface RowDetailProps {
  row: ReminderBatchLog | undefined;
  onClose: () => void;
  /** Company name -> its label in the current language; null when unknown. */
  companyLabel: (name: string | null) => string | null;
  checking: boolean;
  onCheck: () => void;
}

export function RowDetail({ row, onClose, companyLabel, checking, onCheck }: RowDetailProps) {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  if (!row) return null;

  const none = t('messageLog.detail.none');
  const errorKey = deliveryErrorKey(row.error);
  const fields: [string, React.ReactNode][] = [
    [t('messageLog.detail.recipient'), row.recipient_name],
    [
      t('batches.detail.addressHeader'),
      row.medium === 'EMAIL' ? row.recipient_address : formatPhone(row.recipient_address, config),
    ],
    [t('messageLog.detail.channel'), t(`mediums.${row.medium}`)],
    [
      t('messageLog.detail.status'),
      <span key="s" className="flex flex-wrap gap-2">
        <StatusBadge domain="communication" status={row.status} />
        {row.is_test && <StatusBadge tone="info" label={t('messageLog.detail.test')} />}
      </span>,
    ],
    [t('messageLog.detail.kind'), t(`messageLog.triggers.${row.trigger}`)],
    [t('messageLog.detail.sentBy'), row.sent_by_name ?? none],
    [t('messageLog.detail.sent'), formatDateTime(new Date(row.created_at), config)],
    [t('messageLog.detail.company'), companyLabel(row.provider) ?? row.provider ?? none],
    [t('messageLog.detail.providerMessageId'), row.provider_message_id ?? none],
    [
      t('messageLog.detail.segments'),
      row.segments === null ? none : formatNumber(row.segments, config),
    ],
    [
      t('messageLog.detail.batch'),
      row.batch_id ? (
        <Link
          key="b"
          to="/communications/batches/$batchId"
          params={{ batchId: row.batch_id }}
          className="text-primary underline"
        >
          {t('messageLog.detail.batchLink')}
        </Link>
      ) : (
        none
      ),
    ],
    [
      t('messageLog.detail.error'),
      errorKey ? t(errorKey, { medium: t(`mediums.${row.medium}`) }) : none,
    ],
    ...(row.subject ? [[t('messageLog.detail.subject'), row.subject] as [string, string]] : []),
    [
      t('messageLog.detail.message'),
      // Shaped by the server for this user: share links masked, an exam result held back from a
      // role that may not read results (body_withheld), never a guess here.
      row.body_withheld ? (
        <span key="w" className="text-text-secondary">
          {t('messageLog.detail.messageWithheld')}
        </span>
      ) : row.message_body ? (
        <span key="m" className="whitespace-pre-wrap">
          {row.message_body}
        </span>
      ) : (
        none
      ),
    ],
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && !checking && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('messageLog.detail.title')}</DialogTitle>
          <DialogDescription>{t('messageLog.detail.description')}</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-3">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-caption text-text-secondary">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={checking}>
            {t('messageLog.detail.close')}
          </Button>
          {row.can_check_status && (
            <Button loading={checking} onClick={onCheck}>
              {t(checking ? 'messageLog.checkStatusBusy' : 'messageLog.checkStatus')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
