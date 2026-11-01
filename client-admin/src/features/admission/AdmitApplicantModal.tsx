/**
 * [27.10] Admit confirmation. [LIFE-09] Before confirming, staff see whether the
 * applicant's phone matches an existing guardian (name + children) and must
 * choose to link this child to that family or create a new guardian. The
 * server enforces the same rule (409 GUARDIAN_MATCH_NEEDS_CHOICE).
 */
import { AdmissionApplicantStatus, type AdmissionApplicantDto } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioRows,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatPhone } from '@biddaloy/ui/utils';
import * as React from 'react';

import { useAdmitApplicant, useGuardianMatch } from './hooks/useAdmitApplicant';

export function AdmitApplicantModal({
  applicant,
  open,
  onOpenChange,
}: {
  applicant: AdmissionApplicantDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('admission-staff-applicants');
  const regionConfig = useRegionConfig();
  const admit = useAdmitApplicant(applicant.id);
  const [admitted, setAdmitted] = React.useState(false);
  const [choice, setChoice] = React.useState<'LINK_EXISTING' | 'CREATE_NEW' | ''>('');
  const match = useGuardianMatch(applicant.id, open);
  const matched = match.data?.guardian ?? null;
  const needsChoice = matched !== null && choice === '';
  // A different guardian after a refetch (409 MATCH_CHANGED): staff choose again.
  React.useEffect(() => setChoice(''), [matched?.id]);

  function handleClose(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setAdmitted(false);
      setChoice('');
      admit.reset();
    }
  }

  function handleConfirm() {
    admit.mutate(
      matched && choice
        ? choice === 'LINK_EXISTING'
          ? { guardian_choice: choice, guardian_id: matched.id }
          : { guardian_choice: choice }
        : {},
      { onSuccess: () => setAdmitted(true) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('admitModal.title')}</DialogTitle>
        </DialogHeader>

        {admitted ? (
          <p role="status" className="text-sm text-foreground">
            {t('admitModal.successMessage', { name: applicant.applicant_name })}
          </p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p>{t('admitModal.description')}</p>
            <dl className="flex flex-col gap-1">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('admitModal.guardianName')}</dt>
                <dd>{applicant.guardian_name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('admitModal.guardianPhone')}</dt>
                <dd>{formatPhone(applicant.guardian_phone, regionConfig)}</dd>
              </div>
            </dl>
            {match.isError ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 text-destructive"
              >
                <span>{t('admitModal.matchError')}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void match.refetch()}
                >
                  {t('actions.retry', { ns: 'common' })}
                </Button>
              </div>
            ) : matched ? (
              <div className="flex flex-col gap-3 rounded-md border border-border-functional p-3">
                <p>
                  {t('admitModal.existingGuardian', {
                    name: matched.full_name,
                    phone: formatPhone(matched.phone, regionConfig),
                  })}
                </p>
                <p className="text-muted-foreground">
                  {matched.student_names.length > 0
                    ? t('admitModal.children', { names: matched.student_names.join(', ') })
                    : t('admitModal.noChildren')}
                </p>
                <RadioRows
                  legend={t('admitModal.choiceLegend')}
                  helpId="people.admissionApplicants.field.guardianChoice"
                  value={choice}
                  onValueChange={(v) => setChoice(v as 'LINK_EXISTING' | 'CREATE_NEW')}
                  options={[
                    { value: 'LINK_EXISTING', title: t('admitModal.linkExisting') },
                    { value: 'CREATE_NEW', title: t('admitModal.createNew') },
                  ]}
                />
              </div>
            ) : (
              <p className="text-muted-foreground">{t('admitModal.resolutionNote')}</p>
            )}
          </div>
        )}

        {admit.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('admitModal.errorMessage')}
          </p>
        )}

        <DialogFooter>
          {admitted ? (
            <Button type="button" onClick={() => handleClose(false)}>
              {t('admitModal.close')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
              <Button
                type="button"
                loading={admit.isPending}
                disabled={
                  applicant.status === AdmissionApplicantStatus.ADMITTED ||
                  match.isPending ||
                  match.isError ||
                  needsChoice
                }
                onClick={handleConfirm}
              >
                {admit.isPending ? t('admitModal.admitting') : t('admitModal.confirm')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
