/** [66.3.01] D3/D12: why a period wasn't taught. CANCELLED / ON_LEAVE are auto-only. */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  RadioRows,
  Textarea,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const REASONS = ['TEACHER_ABSENT', 'SCHOOL_CLOSED', 'EXAM', 'OTHER'] as const;
export type NotTaughtReason = (typeof REASONS)[number];

export interface NotTaughtDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "<section> · <subject> · <period>" parts. */
  section: string;
  subject: string;
  period: string;
  lessonTitle: string;
  pending: boolean;
  /** Last save failed: show the sentence inside the dialog. */
  error?: boolean;
  /** Focus goes back here on close (D12: the ✕ button). */
  onCloseFocus: () => void;
  onSubmit: (input: { reason: NotTaughtReason; note?: string }) => void;
}

export function NotTaughtDialog({
  open,
  onOpenChange,
  section,
  subject,
  period,
  lessonTitle,
  pending,
  error = false,
  onCloseFocus,
  onSubmit,
}: NotTaughtDialogProps) {
  const { t } = useTranslation('routines');
  const { t: tc } = useTranslation('common');
  const [reason, setReason] = React.useState('');
  const [note, setNote] = React.useState('');
  const noteId = React.useId();

  React.useEffect(() => {
    if (!open) {
      setReason('');
      setNote('');
    }
  }, [open]);

  const valid = reason !== '' && (reason !== 'OTHER' || note.trim().length > 0);

  function submit() {
    if (!valid || pending) return;
    const trimmed = note.trim();
    onSubmit({ reason: reason as NotTaughtReason, ...(trimmed ? { note: trimmed } : {}) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseFocus();
        }}
        onOpenAutoFocus={(event) => {
          // D12: focus starts on the first radio, not the close button.
          event.preventDefault();
          (event.currentTarget as HTMLElement)
            .querySelector<HTMLElement>('[role="radio"]')
            ?.focus();
        }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Enter on a Radix radio (D12) */}
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onKeyDown={(event) => {
            // Radix radios swallow Enter; D12 wants Enter to report.
            if (
              event.key === 'Enter' &&
              event.target instanceof HTMLElement &&
              event.target.getAttribute('role') === 'radio'
            ) {
              event.preventDefault();
              submit();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('marking.reason.title')}</DialogTitle>
            <DialogDescription>
              {t('marking.reason.subtitle', { section, subject, period, title: lessonTitle })}
            </DialogDescription>
          </DialogHeader>
          <RadioRows
            legend={t('marking.reason.label')}
            helpId="academics.myRoutine.field.notTaughtReason"
            value={reason}
            onValueChange={setReason}
            options={REASONS.map((r) => ({ value: r, title: t(`marking.reason.${r}`) }))}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={noteId}>{t('marking.reason.note')}</Label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-required={reason === 'OTHER'}
              aria-describedby={`${noteId}-help`}
            />
            <p id={`${noteId}-help`} className="text-caption text-text-secondary">
              {t('marking.reason.noteHelp')}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-caption text-status-overdue-fg">
              {t('marking.saveFailed')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {t('marking.reason.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
