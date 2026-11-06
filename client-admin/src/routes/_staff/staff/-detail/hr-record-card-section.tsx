/**
 * [76.5.07] Attendance card number of a staff member, saved through the HR record PATCH.
 * Needs an existing HR record (the create DTO has no card_no): without one, it points at the Job section.
 */
import { ApiError } from '@biddaloy/ui/api';
import { Button, ScanCardField } from '@biddaloy/ui/components';
import { useStaffHrRecord, useUpdateStaffHrRecord } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export function HrRecordCardSection({ userId }: { userId: string }) {
  const { t } = useTranslation('staff');
  const recordQuery = useStaffHrRecord(userId);
  const record = recordQuery.data ?? null;
  const update = useUpdateStaffHrRecord(record?.id ?? '', userId);
  // `card_no` is on the API record but not yet on the hook's `StaffHrRecord` type.
  const saved = (record as { card_no?: string | null } | null)?.card_no ?? '';
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
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({ card_no: trimmed === '' ? null : trimmed } as never);
      }}
    >
      <ScanCardField
        value={value}
        onChange={setValue}
        label={t('cardNo.label')}
        scanLabel={t('cardNo.scan')}
        scanHint={t('cardNo.help')}
        helpKey="people.staff.field.cardNo"
        error={duplicate ? t('cardNo.duplicate') : undefined}
      />
      <div className="flex md:justify-end">
        <Button type="submit" disabled={update.isPending || trimmed === saved}>
          {update.isPending ? t('hrRecord.job.saving') : t('hrRecord.job.save')}
        </Button>
      </div>
    </form>
  );
}
