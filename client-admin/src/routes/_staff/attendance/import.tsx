/**
 * [76.5.05] `/attendance/import` full-page wizard (D8): pick sections + date and
 * download the sheet, upload the filled sheet, review every row, save. Nothing
 * is written until "Save"; `validate` only stages the good rows.
 *
 * `?sectionId=` (palette, D15) pre-ticks one section; `?supersedes=<importId>`
 * (detail page, D12) is kept and sent on commit.
 */
import { Button, Card, Checkbox, StatusBadge } from '@biddaloy/ui/components';
import {
  importFileErrorKey,
  useCommitAttendanceSheet,
  useDownloadAttendanceSheet,
  useMySections,
  useValidateAttendanceSheet,
  type AttendanceSheetValidateResult,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { tenantTodayIso } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ImportDropzone } from './-import/import-dropzone';
import { ImportPreviewTable } from './-import/import-preview-table';
import { SectionDatePicker } from './-import/section-date-picker';

const searchSchema = z.object({
  sectionId: z.string().uuid().optional().catch(undefined),
  supersedes: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/attendance/import')({
  validateSearch: searchSchema,
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('attendanceImport', 'common').catch(swallowUnlessOffline),
  component: AttendanceImportPage,
});

type Step = 'pick' | 'upload' | 'preview';

function StepHeading({ current, title }: { current: number; title: string }) {
  const { t } = useTranslation('attendanceImport');
  return (
    <div>
      <p className="text-label text-text-secondary">{t('stepOf', { current, total: 3 })}</p>
      <h2 className="text-h2">{title}</h2>
    </div>
  );
}

function AttendanceImportPage() {
  const { t } = useTranslation('attendanceImport');
  const { t: tc } = useTranslation('common');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const regionConfig = useTenantRegionConfig();

  const [step, setStep] = React.useState<Step>('pick');
  const [sectionIds, setSectionIds] = React.useState<string[]>(
    search.sectionId ? [search.sectionId] : [],
  );
  // `?sectionId=` is user-editable: keep it only if it is a section this user may write.
  const mySections = useMySections().data;
  React.useEffect(() => {
    if (!mySections) return;
    setSectionIds((ids) => {
      const allowed = ids.filter((id) => mySections.some((s) => s.section_id === id));
      return allowed.length === ids.length ? ids : allowed;
    });
  }, [mySections]);
  const [date, setDate] = React.useState(() => tenantTodayIso(regionConfig));
  const [file, setFile] = React.useState<File | undefined>(undefined);
  const [result, setResult] = React.useState<AttendanceSheetValidateResult | undefined>(undefined);
  const [skipErrors, setSkipErrors] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | undefined>(undefined);
  const [expired, setExpired] = React.useState(false);

  const download = useDownloadAttendanceSheet();
  const validate = useValidateAttendanceSheet();
  const commit = useCommitAttendanceSheet();

  const busy = validate.isPending || commit.isPending;
  const close = useCloseFullPage(() => void navigate({ to: '/attendance' }));

  function toUpload() {
    setFile(undefined);
    setResult(undefined);
    setSkipErrors(false);
    setUploadError(undefined);
    setStep('upload');
  }

  function handleDownload() {
    download.mutate({ sectionIds, date }, { onSuccess: () => toUpload() });
  }

  function handleValidate() {
    if (!file) return;
    validate.mutate(file, {
      onSuccess: (data) => {
        setResult(data);
        setExpired(false);
        setStep('preview');
      },
      onError: (error) => {
        const key = importFileErrorKey(error);
        setUploadError(key ? tc(`importFileErrors.${key}`) : t('upload.failed'));
      },
    });
  }

  const counts = result?.counts;
  const saveCount = counts ? counts.new + counts.changed : 0;
  const hasErrors = (counts?.error ?? 0) > 0;
  const canSave = !!result?.staging_id && saveCount > 0 && (!hasErrors || skipErrors);

  function handleCommit() {
    if (!result?.staging_id) return;
    commit.mutate(
      {
        staging_id: result.staging_id,
        ...(search.supersedes ? { supersedes_import_id: search.supersedes } : {}),
      },
      {
        onSuccess: ({ import_id }) =>
          void navigate({ to: '/attendance/imports/$importId', params: { importId: import_id } }),
        onError: (error) => {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 410 || status === 404) {
            setExpired(true);
            toUpload();
          }
        },
      },
    );
  }

  if (step === 'pick') {
    return (
      <FullPageShell title={t('pageTitle')} size="wide" onClose={close}>
        <StepHeading current={1} title={t('pick.title')} />
        <SectionDatePicker
          sectionIds={sectionIds}
          onSectionIdsChange={setSectionIds}
          date={date}
          onDateChange={setDate}
          onDownload={handleDownload}
          downloading={download.isPending}
          error={download.isError ? t('download.failed') : undefined}
        />
        <Button type="button" variant="outline" onClick={toUpload}>
          {t('upload.title')}
        </Button>
      </FullPageShell>
    );
  }

  if (step === 'upload') {
    return (
      <FullPageShell
        title={t('pageTitle')}
        size="wide"
        onClose={close}
        secondary={{ label: tc('actions.back'), onClick: () => setStep('pick') }}
        primary={{
          label: t('upload.reviewChanges'),
          onClick: handleValidate,
          disabled: !file,
          busy: validate.isPending,
        }}
      >
        <StepHeading current={2} title={t('upload.title')} />
        {expired && (
          <Card role="alert" className="p-4">
            <h3 className="text-h3">{t('expired.title')}</h3>
            <p className="text-text-secondary">{t('expired.message')}</p>
          </Card>
        )}
        <ImportDropzone
          onFileChange={(next) => {
            setFile(next);
            setUploadError(undefined);
          }}
          disabled={validate.isPending}
          error={uploadError}
        />
        {validate.isPending && <p className="text-text-secondary">{t('upload.checking')}</p>}
      </FullPageShell>
    );
  }

  return (
    <FullPageShell
      title={t('pageTitle')}
      size="wide"
      dirty
      onClose={close}
      secondary={{
        label: t('review.chooseAnother'),
        onClick: () => !busy && toUpload(),
      }}
      primary={{
        label: commit.isPending ? t('review.saving') : t('review.save', { count: saveCount }),
        onClick: handleCommit,
        disabled: !canSave,
        busy: commit.isPending,
      }}
    >
      <StepHeading current={3} title={t('review.title')} />
      {file && <p className="text-text-secondary">{t('review.fileName', { name: file.name })}</p>}
      {commit.isError && !expired && (
        <p role="alert" className="text-destructive">
          {t('review.saveFailed')}
        </p>
      )}
      {counts && (
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="danger" label={t('review.summaryError', { count: counts.error })} />
          <StatusBadge tone="info" label={t('review.summaryChanged', { count: counts.changed })} />
          <StatusBadge tone="success" label={t('review.summaryNew', { count: counts.new })} />
          <StatusBadge
            tone="neutral"
            label={t('review.summaryUnchanged', { count: counts.unchanged })}
          />
        </div>
      )}
      {(result?.overwrite_count ?? 0) > 0 && (
        <Card role="status" className="p-4">
          <p className="font-medium">
            {t('review.overwriteBanner', { count: result?.overwrite_count })}
          </p>
          <p className="text-text-secondary">{t('review.overwriteBannerHint')}</p>
        </Card>
      )}
      {saveCount === 0 && <p className="text-text-secondary">{t('review.nothingToSave')}</p>}
      {hasErrors && (
        <div className="flex items-start gap-3">
          <div className="flex min-h-11 items-center md:min-h-8">
            <Checkbox
              id="attendance-import-skip-errors"
              checked={skipErrors}
              onCheckedChange={(value) => setSkipErrors(value === true)}
            />
          </div>
          <div className="flex flex-col justify-center">
            <label htmlFor="attendance-import-skip-errors">{t('review.skipErrors')}</label>
            <p className="text-caption text-text-secondary">{t('review.skipErrorsHint')}</p>
          </div>
        </div>
      )}
      {result && <ImportPreviewTable rows={result.rows} />}
    </FullPageShell>
  );
}
