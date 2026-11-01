import { BulkUploadPreview, Button, Card } from '@biddaloy/ui/components';
import type { BulkUploadPreviewController } from '@biddaloy/ui/components';
import {
  useBackupJob,
  useRestoreBackup,
  useSchoolProfile,
  useValidateBackup,
  type PreviewResult,
  type RequestRestoreResponse,
  type RestoreSummary,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import {
  sumTabDiffs,
  tabLabel,
  translateWorkbookFileError,
} from '../../../pages/settings/restore-wizard';

import { StarterGuide } from './starter-guide';
import { StarterPreview } from './starter-preview';

/** A starter file only creates; anything else is not the file we handed out. */
function isCreateOnly(result: PreviewResult<RestoreSummary>): boolean {
  const totals = sumTabDiffs(result.summary.tabs);
  return (
    result.summary.meta.kind === 'TEMPLATE' &&
    totals.updates === 0 &&
    totals.deletes === 0 &&
    totals.creates > 0
  );
}

type Controller = BulkUploadPreviewController<RestoreSummary, RequestRestoreResponse>;

/**
 * [13.5.2] The "upload an Excel file" path of the welcome wizard's setup slot:
 * sample file -> upload -> problems or preview -> "Create these" -> progress.
 * Nothing is written until the confirm press. `onDone` fires once the job is done.
 */
export function ExcelSetup({ onDone }: { onDone?: () => void } = {}) {
  const { t } = useTranslation('onboardingSetup');
  const { t: tb } = useTranslation('backup');
  const validateMutation = useValidateBackup();
  const restoreMutation = useRestoreBackup();
  const profile = useSchoolProfile();
  const schoolName = profile.data?.name ?? '';
  const [controller, setController] = React.useState<Controller | undefined>();

  const { mutateAsync: validateAsync } = validateMutation;
  const { mutateAsync: restoreAsync } = restoreMutation;
  // The controller drops `result` once the job is queued; keep the sheets for the failure note.
  const [tabs, setTabs] = React.useState<RestoreSummary['tabs']>([]);
  const validate = React.useCallback(
    (file: File, onProgress: (percent: number) => void) =>
      validateAsync({ file, onProgress }).then(
        (result) => {
          setTabs(result.summary.tabs);
          return result;
        },
        (err: unknown) => {
          throw translateWorkbookFileError(tb, err, 'starter');
        },
      ),
    [validateAsync, tb],
  );
  // A starter file creates only, so nothing can be deleted: the server's
  // typed-confirmation phrase (the school's name) is sent for the user.
  const commit = React.useCallback(
    (stagingId: string) =>
      restoreAsync({ staging_id: stagingId, confirmation: schoolName, invite_users: false }),
    [restoreAsync, schoolName],
  );

  const inPreview = controller?.status === 'preview' || controller?.status === 'committing';

  return (
    <Card padded className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('excel.title')}</h2>
      {!inPreview && controller?.status !== 'done' && <StarterGuide />}
      <BulkUploadPreview<RestoreSummary, RequestRestoreResponse>
        accept=".xlsx"
        hideConfirm
        validate={validate}
        commit={commit}
        canCommit={(result) => isCreateOnly(result) && schoolName !== ''}
        onControllerChange={setController}
        renderSummary={(result) =>
          result.hard_error_count > 0 ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t('excel.errorsFound', { count: result.hard_error_count })}
            </p>
          ) : isCreateOnly(result) ? (
            <StarterPreview tabs={result.summary.tabs} />
          ) : (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t('excel.notStarter')}
            </p>
          )
        }
        renderCommitting={() => <p className="text-sm">{tb('restoreStarting')}</p>}
        renderDone={(response, reset) => (
          <SetupProgress
            jobId={response.job_id}
            tabs={tabs}
            onReset={reset}
            {...(onDone ? { onDone } : {})}
          />
        )}
      />
      {profile.isError && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {tb('schoolProfileLoadFailed')}
          </p>
          <Button type="button" variant="ghost" onClick={() => void profile.refetch()}>
            {tb('actions.retry', { ns: 'common' })}
          </Button>
        </div>
      )}
      {inPreview && controller && (
        <div>
          <Button
            type="button"
            className="w-full md:w-auto"
            disabled={controller.confirmDisabled}
            loading={controller.status === 'committing'}
            onClick={controller.confirm}
          >
            {t('excel.confirm')}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Polls the queued restore job; on failure says which sheets were already created. */
function SetupProgress({
  jobId,
  tabs,
  onReset,
  onDone,
}: {
  jobId: string;
  tabs: RestoreSummary['tabs'];
  onReset: () => void;
  onDone?: () => void;
}) {
  const { t } = useTranslation('onboardingSetup');
  const { t: tb } = useTranslation('backup');
  const jobQuery = useBackupJob(jobId);
  const job = jobQuery.data;
  const done = job?.status === 'DONE';

  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;
  React.useEffect(() => {
    if (done) onDoneRef.current?.();
  }, [done]);

  if (jobQuery.isError) {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-sm font-medium text-destructive">
          {tb('restoreProgressLoadFailed')}
        </p>
        <div>
          <Button type="button" variant="outline" onClick={() => void jobQuery.refetch()}>
            {tb('actions.retry', { ns: 'common' })}
          </Button>
        </div>
      </div>
    );
  }
  if (done) return <p className="text-sm font-medium">{t('excel.done')}</p>;
  if (job && job.status !== 'QUEUED' && job.status !== 'RUNNING') {
    // The restore processes tabs in the validate response's order, so every
    // tab before the failed one with creates has already been written.
    const cut = job.failed_tab ? tabs.findIndex((tab) => tab.name === job.failed_tab) : -1;
    const created = (cut < 0 ? [] : tabs.slice(0, cut)).filter((tab) => tab.creates > 0);
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-sm font-medium text-destructive">
          {tb('restoreFailed')}
        </p>
        {created.length > 0 && (
          <p className="text-sm text-text-secondary">
            {t('excel.alreadyCreated', {
              sheets: created.map((tab) => tabLabel(tb, tab.name)).join(', '),
            })}
          </p>
        )}
        <div>
          <Button type="button" variant="outline" onClick={onReset}>
            {tb('actions.retry', { ns: 'common' })}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <p aria-live="polite" className="text-sm">
      {job?.progress
        ? tb('restoreProgressTab', {
            tab: tabLabel(tb, job.progress.tab),
            done: job.progress.done,
            total: job.progress.total,
          })
        : tb('progressUnknown')}
    </p>
  );
}
