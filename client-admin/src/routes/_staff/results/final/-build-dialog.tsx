/**
 * [70.5.3] "ফল তৈরি করুন": works every student's final result out from the published exams.
 * Same shape as `results/-process-dialog.tsx`, minus the force path: a final can always be built.
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
  toast,
} from '@biddaloy/ui/components';
import { useBuildFinalResult } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleAlertIcon } from 'lucide-react';

export interface BuildDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalResultId: string;
}

export function BuildDialog({ open, onOpenChange, finalResultId }: BuildDialogProps) {
  const { t } = useTranslation('exams');
  const config = useRegionConfig();
  const build = useBuildFinalResult(finalResultId);

  function handleOpenChange(next: boolean) {
    if (!next && build.isPending) return;
    if (!next) build.reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
        <DialogHeader>
          <DialogTitle>{t('finalResults.buildDialog.title')}</DialogTitle>
          <DialogDescription>{t('finalResults.buildDialog.description')}</DialogDescription>
        </DialogHeader>

        {build.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {t('finalResults.buildDialog.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            loading={build.isPending}
            onClick={() =>
              build.mutate(undefined, {
                onSuccess: (r) => {
                  toast.success(
                    t('finalResults.buildDialog.done', {
                      count: r.processed,
                      n: formatNumber(r.processed, config),
                    }),
                  );
                  onOpenChange(false);
                },
              })
            }
          >
            {t('finalResults.buildDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
