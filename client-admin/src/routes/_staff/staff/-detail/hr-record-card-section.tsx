/**
 * [76.5.07] Attendance card number of a staff member, saved through the HR record PATCH.
 * Needs an existing HR record (the create DTO has no card_no): without one, it points at the Job section.
 */
import { ApiError } from '@biddaloy/ui/api';
import { Button, ScanCardField } from '@biddaloy/ui/components';
import { useStaffHrRecord, useUpdateStaffHrRecord } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { MutationErrorMessage } from '../../../../components/MutationErrorMessage';

/** Same rule as the student form. */
const CARD_NO_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function HrRecordCardSection({ userId }: { userId: string }) {
  const { t } = useTranslation('staff');
  const recordQuery = useStaffHrRecord(userId);
  const record = recordQuery.data ?? null;
  const update = useUpdateStaffHrRecord(record?.id ?? '', userId);
  const saved = record?.card_no ?? '';
  const [value, setValue] = React.useState(saved);
  React.useEffect(() => setValue(saved), [saved]);

  if (record === null) {
    return <p className="text-text-secondary">{t('hrRecord.job.emptyExplanation')}</p>;
  }
  const duplicate =
    update.error instanceof ApiError &&
    update.error.statusCode === 409 &&
    update.error.details?.code === 'CARD_NO_TAKEN';
  const trimmed = value.trim();
  const invalid = trimmed !== '' && !CARD_NO_PATTERN.test(trimmed);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        update.mutate({ card_no: trimmed === '' ? null : trimmed });
      }}
    >
      <ScanCardField
        value={value}
        onChange={(next) => {
          if (update.isError) update.reset();
          setValue(next);
        }}
        label={t('cardNo.label')}
        scanLabel={t('cardNo.scan')}
        scanHint={t('cardNo.scanHint')}
        helpId="people.staff.field.cardNo"
        error={invalid ? t('cardNo.invalid') : duplicate ? t('cardNo.duplicate') : undefined}
      />
      {update.isError && !duplicate ? <MutationErrorMessage error={update.error} /> : null}
      <div className="flex md:justify-end">
        <Button type="submit" disabled={update.isPending || trimmed === saved}>
          {update.isPending ? t('hrRecord.job.saving') : t('hrRecord.job.save')}
        </Button>
      </div>
    </form>
  );
}
