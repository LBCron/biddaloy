/**
 * [70.5.3] Publish (`PROCESSED -> PUBLISHED`, a plain write) and reopen (`PUBLISHED ->
 * PROCESSED`, step-up approval: the first click gets `403 APPROVAL_REQUIRED` and the shared
 * `AdminVerificationModal` opens by itself, same as `results/-publish-dialog.tsx`).
 *
 * D18: before publishing, each section that still has students without a remark or conduct
 * grade is listed with a link to the notes screen. It warns and never blocks.
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
import {
  useClassSections,
  usePublishFinalResult,
  useReopenFinalResult,
  useReportCardNotesMissing,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useRouter } from '@tanstack/react-router';
import { CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';

export interface FinalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalResultId: string;
}

export interface PublishDialogProps extends FinalDialogProps {
  classId: string;
}

/** D18 line for one section: nothing when the section is complete. */
export function MissingNotes({
  sectionId,
  name,
  finalResultId,
}: {
  sectionId: string;
  name: string;
  finalResultId: string;
}) {
  const { t } = useTranslation('exams');
  const config = useRegionConfig();
  const router = useRouter();
  const missing = useReportCardNotesMissing(sectionId, { final_result_id: finalResultId });
  const data = missing.data;
  if (!data || (data.missing_remark === 0 && data.missing_conduct === 0)) return null;
  const href = `/my-class/${sectionId}/notes?for=${finalResultId}`;
  return (
    <p
      role="status"
      className="flex gap-2 rounded-md bg-status-due-bg p-3 text-status-due-fg"
      data-testid="missing-notes"
    >
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        {name}:{' '}
        {t('finalResults.publishDialog.warning', {
          remark: formatNumber(data.missing_remark, config),
          conduct: formatNumber(data.missing_conduct, config),
        })}{' '}
        <a
          className="font-medium underline"
          href={href}
          onClick={(e) => {
            // Plain click stays in the app; a modified click opens a tab as usual.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            router.history.push(href);
          }}
        >
          {t('finalResults.publishDialog.warningLink')}
        </a>
      </span>
    </p>
  );
}

export function PublishDialog({ open, onOpenChange, finalResultId, classId }: PublishDialogProps) {
  const { t } = useTranslation('exams');
  const publish = usePublishFinalResult(finalResultId);
  const sections = useClassSections(open ? classId : undefined);

  function handleOpenChange(next: boolean) {
    if (!next && publish.isPending) return;
    if (!next) publish.reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
        <DialogHeader>
          <DialogTitle>{t('finalResults.publishDialog.title')}</DialogTitle>
          <DialogDescription>{t('finalResults.publishDialog.description')}</DialogDescription>
        </DialogHeader>

        {(sections.data ?? []).map((s) => (
          <MissingNotes
            key={s.id}
            sectionId={s.id}
            name={s.section_name}
            finalResultId={finalResultId}
          />
        ))}

        {publish.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {t('finalResults.publishDialog.errorMessage')}
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
            loading={publish.isPending}
            onClick={() => publish.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
          >
            {t('finalResults.publishDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReopenDialog({ open, onOpenChange, finalResultId }: FinalDialogProps) {
  const { t } = useTranslation('exams');
  const reopen = useReopenFinalResult(finalResultId);

  // Pinned open while pending: the approval modal may sit over this dialog, and a stray
  // dismissal must not strand the mutation's `onSuccess`.
  function handleOpenChange(next: boolean) {
    if (!next && reopen.isPending) return;
    if (!next) reopen.reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
        <DialogHeader>
          <DialogTitle>{t('finalResults.reopenDialog.title')}</DialogTitle>
          <DialogDescription>{t('finalResults.reopenDialog.description')}</DialogDescription>
        </DialogHeader>

        {reopen.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {t('finalResults.reopenDialog.errorMessage')}
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
            variant="destructive"
            loading={reopen.isPending}
            onClick={() => reopen.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
          >
            {t('finalResults.reopenDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
