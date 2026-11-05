/**
 * [70.5.3] Send a published final result to every guardian by SMS. The send carries an
 * `Idempotency-Key` (Rule 25); after success the button stays off so a second click cannot bill
 * the same SMS twice. Reopening the dialog resets it.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useSendFinalResultSms } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';

import type { FinalDialogProps } from './-publish-dialog';

export interface SmsDialogProps extends FinalDialogProps {
  published: boolean;
  yearName: string;
}

export function SmsDialog({
  open,
  onOpenChange,
  finalResultId,
  published,
  yearName,
}: SmsDialogProps) {
  const { t } = useTranslation('exams');
  const config = useRegionConfig();
  const sms = useSendFinalResultSms(finalResultId);

  function handleOpenChange(next: boolean) {
    if (!next && sms.isPending) return;
    if (!next) sms.reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm" closeLabel={t('actions.close', { ns: 'common' })}>
        <DialogHeader>
          <DialogTitle>{t('finalResults.smsDialog.title')}</DialogTitle>
          <DialogDescription>
            {published
              ? t('finalResults.smsDialog.name', { year: yearName })
              : t('finalResults.smsDialog.disabledUnpublished')}
          </DialogDescription>
        </DialogHeader>

        {sms.isSuccess && (
          <p className="flex items-center gap-1.5 text-text-secondary">
            <CircleCheckIcon aria-hidden="true" className="size-4 text-status-paid-fg" />
            {t('finalResults.smsDialog.sent', {
              count: sms.data.queued,
              n: formatNumber(sms.data.queued, config),
            })}
          </p>
        )}
        {sms.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {t('finalResults.smsDialog.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.close', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!published || sms.isSuccess}
            loading={sms.isPending}
            onClick={() => sms.mutate()}
          >
            {t('finalResults.smsDialog.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
