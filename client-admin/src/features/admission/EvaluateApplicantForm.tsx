/**
 * [27.10] Inline evaluate/shortlist form on the applicant detail screen —
 * records a note, optionally shortlisting or rejecting in the same call
 * (`POST /admission/applicants/:id/evaluate`, `decision?: 'SHORTLIST' |
 * 'REJECT'` — `'ADMIT'` is a 400 there, admitting goes through
 * `AdmitApplicantModal` instead, see the service's own comment).
 */
import {
  Button,
  HelpHint,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { useEvaluateApplicant, type EvaluateApplicantInput } from './hooks/useApplicants';

export function EvaluateApplicantForm({
  applicantId,
  decision,
  open,
  onOpenChange,
}: {
  applicantId: string;
  decision?: EvaluateApplicantInput['decision'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('admission-staff-applicants');
  const [notes, setNotes] = React.useState('');
  const evaluate = useEvaluateApplicant(applicantId);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!notes.trim()) return;
    evaluate.mutate(
      { notes: notes.trim(), ...(decision ? { decision } : {}) },
      {
        onSuccess: () => {
          onOpenChange(false);
          setNotes('');
        },
      },
    );
  }

  const title = decision === 'SHORTLIST' ? t('evaluate.shortlistTitle') : t('detail.actionAddNote');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <span className="inline-flex items-center gap-1">
            <Label htmlFor="evaluate-notes">{t('evaluate.notesLabel')}</Label>
            <HelpHint helpId="people.admissionApplicants.field.notes" />
          </span>
          <Textarea
            id="evaluate-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />

          {evaluate.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('evaluate.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" loading={evaluate.isPending} disabled={!notes.trim()}>
              {evaluate.isPending ? t('evaluate.saving') : t('evaluate.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
