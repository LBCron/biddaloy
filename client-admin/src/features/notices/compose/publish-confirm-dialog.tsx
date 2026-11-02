/**
 * [53.3.g2.01] "Publish this notice?" — the counts, and when SMS is ticked, the plain sentence that
 * it goes to an admin for approval. Nothing here says an SMS was sent: none goes out until approval.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface PublishCounts {
  app: number;
  smsOnly: number;
  unreachable: number;
}

export interface PublishConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: PublishCounts;
  sms: boolean;
  busy: boolean;
  error?: string | undefined;
  onConfirm: () => void;
}

export function PublishConfirmDialog({
  open,
  onOpenChange,
  counts,
  sms,
  busy,
  error,
  onConfirm,
}: PublishConfirmDialogProps) {
  const { t } = useTranslation('noticeCompose');
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('confirm.title')}</DialogTitle>
          <DialogDescription>{t('confirm.counts', { ...counts })}</DialogDescription>
        </DialogHeader>
        {sms && <p>{t('confirm.sms')}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          <Button type="button" loading={busy} onClick={onConfirm}>
            {t('actions.confirmPublish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
