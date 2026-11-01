import { Permission } from '@biddaloy/shared';
import { BulkUploadPreview, Button, Card, Checkbox, Input, toast } from '@biddaloy/ui/components';
import {
  downloadBackup,
  downloadWorkbookTemplate,
  useBackupJob,
  useHasPermission,
  useRestoreBackup,
  useSchoolProfile,
  useValidateBackup,
  type PreviewResult,
  type RequestRestoreResponse,
  type RestoreSummary,
  type TabSummaryDto,
} from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import { DownloadIcon } from 'lucide-react';
import * as React from 'react';

/**
 * [14.11.3/#613, corrected 14.11.5] "Restore from a backup" — the
 * irreversible action, made impossible to do by accident and easy to do on
 * purpose (D8). Built on the same `BulkUploadPreview` (`@biddaloy/ui`) both
 * the restore wizard and student import share (D11): validate the uploaded
 * workbook, show a per-tab diff, gate Confirm behind the school's exact
 * name typed by hand, then hand the queued `{job_id, snapshot_job_id}` to a
 * progress panel that polls `useBackupJob`.
 *
 * `commit` (`useRestoreBackup`) resolves as soon as the server has *queued*
 * the restore (`202`, `RequestRestoreResponseDto`), not once it finishes —
 * the minutes-long tab-by-tab apply lives entirely in `renderDone`'s
 * `RestoreProgressPanel`, which polls `GET /backup/jobs/:job_id` for the
 * real `WorkbookJobDto`. `renderCommitting` only covers the brief
 * POST-in-flight window.
 *
 * Correction from #613's original build: the confirmation gate's expected
 * school name now comes from `useSchoolProfile()` (the session's real
 * school), never from `meta.source_school_name` on the validate response —
 * that field is read out of the *uploaded* workbook, so using it would let
 * a crafted workbook satisfy its own confirmation.
 *
 * [14.13.3] `tenantId`/`expectedSchoolName` — the SUPER_ADMIN
 * provision-from-workbook flow (`-create-school-wizard.tsx`'s success step,
 * `$schoolId.tsx`'s "Restore from workbook" action) reuses this component
 * unchanged otherwise, against a school that ISN'T the caller's active
 * tenant. Passing `tenantId` threads an `X-Tenant-ID` override into every
 * request this component makes (`apiClient`'s interceptor honors a pre-set
 * header over the ambient active tenant); `expectedSchoolName` replaces the
 * `useSchoolProfile()` fetch (which resolves "me" from the *active* tenant,
 * not `tenantId`, and would 401/404 or name the wrong school here) as the
 * confirmation gate's expected value. Both stay optional and unused for
 * every existing tenant-scoped caller.
 */
export interface RestoreWizardProps {
  tenantId?: string;
  expectedSchoolName?: string;
  /** Backup settings renders its own card title; platform callers keep the default heading. */
  hideTitle?: boolean;
}

export function RestoreWizard({
  tenantId,
  expectedSchoolName: expectedSchoolNameOverride,
  hideTitle = false,
}: RestoreWizardProps = {}) {
  const { t } = useTranslation('backup');
  const { locale } = useLocale();
  const canManageBackup = useHasPermission(Permission.BACKUP_MANAGE);
  const validateMutation = useValidateBackup({ ...(tenantId ? { tenantId } : {}) });
  const restoreMutation = useRestoreBackup({ ...(tenantId ? { tenantId } : {}) });
  // Never fetched when `tenantId` is set — see this component's own doc
  // comment on why `useSchoolProfile()`'s ambient "me" would be wrong here.
  const schoolProfileQuery = useSchoolProfile({ enabled: tenantId === undefined });
  const [downloadingTemplate, setDownloadingTemplate] = React.useState(false);

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    try {
      await downloadWorkbookTemplate(locale, { ...(tenantId ? { tenantId } : {}) });
    } catch {
      toast.error(t('downloadTemplateFailed'));
    } finally {
      setDownloadingTemplate(false);
    }
  }

  const { mutateAsync: validateAsync } = validateMutation;
  const { mutateAsync: restoreAsync } = restoreMutation;

  // `confirmSlot`/`renderCommitting` don't receive the preview result from
  // `BulkUploadPreview` itself (its own state is private to
  // `useBulkUploadPreview`) — so this wrapper mirrors the latest `validate`
  // result here, purely to feed the confirm-gate copy and the commit
  // payload. `BulkUploadPreview` remains the single source of truth for
  // which *screen* is showing.
  const [latestResult, setLatestResult] = React.useState<PreviewResult<RestoreSummary> | undefined>(
    undefined,
  );
  const [confirmationText, setConfirmationText] = React.useState('');
  const [inviteRestoredUsers, setInviteRestoredUsers] = React.useState(false);

  const validate = React.useCallback(
    (file: File, onProgress: (percent: number) => void) =>
      validateAsync({ file, onProgress }).then(
        (result) => {
          setLatestResult(result);
          setConfirmationText('');
          setInviteRestoredUsers(false);
          return result;
        },
        (err: unknown) => {
          throw translateWorkbookFileError(t, err);
        },
      ),
    [validateAsync, t],
  );

  const commit = React.useCallback(
    (stagingId: string) =>
      restoreAsync({
        staging_id: stagingId,
        confirmation: confirmationText,
        invite_users: inviteRestoredUsers,
      }),
    [restoreAsync, confirmationText, inviteRestoredUsers],
  );

  function handleReset() {
    setLatestResult(undefined);
    setConfirmationText('');
    setInviteRestoredUsers(false);
  }

  // Fail closed: a blank/loading school name never satisfies the
  // confirmation gate (kept from 7150675f's fix — now fed the real name).
  // The `tenantId` path's `expectedSchoolNameOverride` takes priority (and
  // an omitted one still fails closed to '', never falling through to the
  // wrong-tenant profile fetch's data).
  const expectedSchoolName =
    expectedSchoolNameOverride ??
    (tenantId === undefined ? (schoolProfileQuery.data?.name ?? '') : '');
  const schoolProfileError = tenantId === undefined && schoolProfileQuery.isError;

  return (
    <div className="flex flex-col gap-4">
      {!hideTitle && <h3 className="text-base font-semibold">{t('restoreSectionTitle')}</h3>}
      <BulkUploadPreview<RestoreSummary, RequestRestoreResponse>
        accept=".xlsx"
        validate={validate}
        commit={commit}
        canCommit={(result) => {
          const totals = sumTabDiffs(result.summary.tabs);
          return (
            result.hard_error_count === 0 && totals.creates + totals.updates + totals.deletes > 0
          );
        }}
        renderSummary={(result) => <RestoreDiffSummary result={result} />}
        confirmSlot={({ setBlocked }) => (
          <RestoreConfirmSlot
            summary={latestResult?.summary}
            expectedSchoolName={expectedSchoolName}
            schoolProfileError={schoolProfileError}
            onRetrySchoolProfile={() => void schoolProfileQuery.refetch()}
            confirmationText={confirmationText}
            onConfirmationTextChange={setConfirmationText}
            inviteRestoredUsers={inviteRestoredUsers}
            onInviteRestoredUsersChange={setInviteRestoredUsers}
            setBlocked={setBlocked}
          />
        )}
        renderCommitting={() => <p className="text-sm">{t('restoreStarting')}</p>}
        renderDone={(response, reset) => (
          <RestoreProgressPanel
            jobId={response.job_id}
            snapshotJobId={response.snapshot_job_id}
            {...(tenantId ? { tenantId } : {})}
            onReset={() => {
              handleReset();
              reset();
            }}
          />
        )}
      />
      {canManageBackup && (
        // [14.13.2]: newcomers migrating from another system land here
        // looking for a starting point — a blank workbook they can fill in
        // by hand, distinct from restoring an actual backup file above.
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-4 md:flex-row md:items-center md:justify-between">
          <p className="text-text-secondary">{t('templatePrompt')}</p>
          <Button
            type="button"
            variant="ghost"
            className="w-full shrink-0 md:w-auto"
            loading={downloadingTemplate}
            onClick={() => void handleDownloadTemplate()}
          >
            <DownloadIcon aria-hidden="true" />
            {t('downloadTemplate')}
          </Button>
        </div>
      )}
    </div>
  );
}

interface TabDiffTotals {
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
}

/** Single pass over the per-tab diff, shared by `canCommit`'s "is there
 * anything to do" gate, the confirm slot's delete-count warning, and the
 * totals row in `RestoreDiffSummary`. */
export function sumTabDiffs(tabs: TabSummaryDto[]): TabDiffTotals {
  return tabs.reduce(
    (acc, tab) => ({
      creates: acc.creates + tab.creates,
      updates: acc.updates + tab.updates,
      deletes: acc.deletes + tab.deletes,
      unchanged: acc.unchanged + tab.unchanged,
    }),
    { creates: 0, updates: 0, deletes: 0, unchanged: 0 },
  );
}

export function tabLabel(t: ReturnType<typeof useTranslation<'backup'>>['t'], tab: string): string {
  return t(`diffTabName.${tab}`, { defaultValue: tab });
}

// `POST /backup/validate` refuses a whole file with its own `details.code` set
// (`WorkbookFormatError` and `VALIDATE_BUSY`), apart from `ImportFileErrorCode`, so it
// has its own map onto `backup:fileErrors.*` (#3174).
const WORKBOOK_FILE_ERROR_KEY: Readonly<Record<string, string>> = {
  NOT_XLSX: 'notXlsx',
  TOO_LARGE: 'tooLarge',
  MISSING_META: 'missingMeta',
  UNSUPPORTED_VERSION: 'unsupportedVersion',
  VALIDATE_BUSY: 'busy',
};

/** The translated sentence for a refused workbook; any other error comes back as it was, so
 * the server's English text is never what gets shown for a code we know. Shared with
 * the onboarding Excel setup, which validates through the same route: `'starter'` speaks of
 * the sample file it uploads (`starterFileErrors.*`), not of a backup. */
export function translateWorkbookFileError(
  t: ReturnType<typeof useTranslation<'backup'>>['t'],
  error: unknown,
  file: 'backup' | 'starter' = 'backup',
): unknown {
  const e = error as { statusCode?: unknown; details?: { code?: unknown } } | null;
  const code = e?.details?.code;
  // A file over the upload limit is refused by the upload interceptor before validation,
  // with a bare 413 and no code: it is the same "too large" for the person.
  const key =
    typeof code === 'string' && Object.hasOwn(WORKBOOK_FILE_ERROR_KEY, code)
      ? WORKBOOK_FILE_ERROR_KEY[code]
      : e?.statusCode === 413
        ? WORKBOOK_FILE_ERROR_KEY.TOO_LARGE
        : undefined;
  if (!key) return error;
  const group = file === 'starter' ? 'starterFileErrors' : 'fileErrors';
  return new Error(t(`${group}.${key}`), { cause: error });
}

/** `renderSummary` — a per-tab create/update/unchanged/delete table (from
 * `TabSummaryDto`, which has no per-tab error count — row-level
 * errors/warnings are top-level `BulkImportErrorDto[]` instead) with a
 * totals row and the top-level warnings list. `BulkUploadPreview` itself
 * renders the row-level `result.errors` table below this. */
export function RestoreDiffSummary({ result }: { result: PreviewResult<RestoreSummary> }) {
  const { t } = useTranslation('backup');
  const { summary } = result;

  const totals = sumTabDiffs(summary.tabs);

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">{t('diffTitle')}</h4>
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('diffTitle')}</caption>
          <thead>
            <tr className="border-b border-border-subtle">
              <th scope="col" className="py-1 pr-4 font-medium">
                {t('diffColumnTab')}
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                {t('diffColumnCreate')}
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                {t('diffColumnUpdate')}
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                {t('diffColumnUnchanged')}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t('diffColumnDelete')}
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.tabs.map((tab) => (
              <tr key={tab.name} className="border-b border-border-subtle">
                <td className="py-1 pr-4">
                  {tabLabel(t, tab.name)}
                  {!tab.present && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {t('diffTabNotPresent')}
                    </span>
                  )}
                </td>
                <td className="py-1 pr-4">{tab.creates}</td>
                <td className="py-1 pr-4">{tab.updates}</td>
                <td className="py-1 pr-4">{tab.unchanged}</td>
                <td className="py-1">{tab.deletes}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="py-1 pr-4">{t('diffTotalsRow')}</td>
              <td className="py-1 pr-4">{totals.creates}</td>
              <td className="py-1 pr-4">{totals.updates}</td>
              <td className="py-1 pr-4">{totals.unchanged}</td>
              <td className="py-1">{totals.deletes}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {summary.warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-semibold">{t('warningsTitle')}</h4>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {summary.warnings.map((warning, index) => (
              // `BulkImportErrorDto` has no stable id; row+column+message
              // together are unique enough for a list that's rebuilt fresh
              // on every validate response.
              <li key={`${warning.row}-${warning.column ?? ''}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface RestoreConfirmSlotProps {
  summary: RestoreSummary | undefined;
  expectedSchoolName: string;
  schoolProfileError: boolean;
  onRetrySchoolProfile: () => void;
  confirmationText: string;
  onConfirmationTextChange: (value: string) => void;
  inviteRestoredUsers: boolean;
  onInviteRestoredUsersChange: (value: boolean) => void;
  setBlocked: (blocked: boolean) => void;
}

/** `confirmSlot` — states the consequences plainly, then gates Confirm
 * behind the school's *exact* name typed by hand (D8's confirmation
 * requirement). The expected name is `expectedSchoolName`, sourced from
 * `useSchoolProfile()` by the caller — never from the uploaded workbook's
 * `meta.source_school_name`, which a crafted file could set to anything. A
 * blank/not-yet-loaded name fails closed (never matches an empty typed
 * value... unless the field is also empty, so this still requires
 * `expectedSchoolName` to be non-empty). */
export function RestoreConfirmSlot({
  summary,
  expectedSchoolName,
  schoolProfileError,
  onRetrySchoolProfile,
  confirmationText,
  onConfirmationTextChange,
  inviteRestoredUsers,
  onInviteRestoredUsersChange,
  setBlocked,
}: RestoreConfirmSlotProps) {
  const { t } = useTranslation('backup');
  const deletes = summary ? sumTabDiffs(summary.tabs).deletes : 0;

  // A plain effect, deliberately not deferred a macrotask. `BulkUploadPreview`
  // holds Confirm from its very first render whenever a `confirmSlot` is
  // supplied, and its "new preview" effect resets that hold back ON, not off
  // (7150675f) — so there is no effect-ordering race for this slot to win,
  // and only this slot can ever release the hold.
  //
  // Fail closed on both halves of the comparison: a blank or not-yet-loaded
  // `expectedSchoolName` never matches (without the `!== ''` guard an empty
  // box would satisfy an empty expected name), and `.trim()` on the typed
  // value means a whitespace-only school name is equally unsatisfiable.
  React.useEffect(() => {
    const matches = expectedSchoolName !== '' && confirmationText.trim() === expectedSchoolName;
    setBlocked(!matches);
  }, [confirmationText, expectedSchoolName, setBlocked]);

  return (
    <div className="flex flex-col gap-3">
      {summary?.is_empty_tenant ? (
        <p className="text-sm">{t('emptyTenantWorkbook')}</p>
      ) : (
        <>
          {deletes > 0 && (
            <p className="text-sm font-medium text-destructive">
              {t('restoreConsequenceDeletes', { count: deletes })}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t('restoreSnapshotFirst')}</p>
        </>
      )}

      {schoolProfileError && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {t('schoolProfileLoadFailed')}
          </p>
          <Button type="button" variant="ghost" onClick={onRetrySchoolProfile}>
            {t('actions.retry', { ns: 'common' })}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="restore-confirmation-text" className="text-sm font-medium">
          {t('confirmTypeNamePrompt', { schoolName: expectedSchoolName })}
        </label>
        <Input
          id="restore-confirmation-text"
          value={confirmationText}
          placeholder={t('confirmTypeNamePlaceholder')}
          onChange={(event) => onConfirmationTextChange(event.target.value)}
        />
      </div>

      <span className="flex items-center gap-2 text-sm">
        <Checkbox
          id="restore-invite-users"
          checked={inviteRestoredUsers}
          onCheckedChange={(checked) => onInviteRestoredUsersChange(checked === true)}
        />
        <label htmlFor="restore-invite-users">{t('inviteRestoredUsers')}</label>
      </span>
      <p className="text-xs text-muted-foreground">{t('inviteRestoredUsersHint')}</p>
    </div>
  );
}

/** `renderDone` — the queued restore's `{job_id, snapshot_job_id}`, polled
 * via `useBackupJob(jobId)` (already stops polling on a terminal status)
 * until DONE or FAILED. Per D8, the pre-restore snapshot is the only undo,
 * so its download link is offered on both terminal panels. */
export function RestoreProgressPanel({
  jobId,
  snapshotJobId,
  tenantId,
  onReset,
}: {
  jobId: string;
  snapshotJobId: string;
  /** [14.13.3] — see `RestoreWizard`'s own doc comment; threaded through to
   * both the job poll and the snapshot download so neither ever falls back
   * to the caller's ambient (wrong) active tenant. */
  tenantId?: string;
  onReset: () => void;
}) {
  const { t } = useTranslation('backup');
  const jobQuery = useBackupJob(jobId, { ...(tenantId ? { tenantId } : {}) });
  const job = jobQuery.data;
  const [downloadingSnapshot, setDownloadingSnapshot] = React.useState(false);

  async function handleDownloadSnapshot() {
    setDownloadingSnapshot(true);
    try {
      await downloadBackup(snapshotJobId, { ...(tenantId ? { tenantId } : {}) });
    } catch {
      toast.error(t('downloadFailed'));
    } finally {
      setDownloadingSnapshot(false);
    }
  }

  if (jobQuery.isError) {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          {t('restoreProgressLoadFailed')}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void jobQuery.refetch()}>
            {t('actions.retry', { ns: 'common' })}
          </Button>
          <Button type="button" variant="ghost" onClick={onReset}>
            {t('uploadAnother', { ns: 'bulkImport' })}
          </Button>
        </div>
      </Card>
    );
  }

  if (!job || job.status === 'QUEUED' || job.status === 'RUNNING') {
    const progressText = job?.progress
      ? t('restoreProgressTab', {
          tab: tabLabel(t, job.progress.tab),
          done: job.progress.done,
          total: job.progress.total,
        })
      : t('progressUnknown');

    return (
      <Card className="flex flex-col gap-2 p-4">
        <p aria-live="polite" className="text-sm">
          {progressText}
        </p>
      </Card>
    );
  }

  if (job.status === 'DONE') {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm font-medium">{t('restoreDone')}</p>
        {job.row_counts &&
          Object.entries(job.row_counts).map(([tab, count]) => (
            <p key={tab} className="text-sm">
              {t('restoreDoneCounts', { tab: tabLabel(t, tab), count })}
            </p>
          ))}
        <div>
          <Button
            type="button"
            variant="outline"
            loading={downloadingSnapshot}
            onClick={() => void handleDownloadSnapshot()}
          >
            {t('downloadSnapshot')}
          </Button>
        </div>
        <div>
          <Button type="button" variant="ghost" onClick={onReset}>
            {t('uploadAnother', { ns: 'bulkImport' })}
          </Button>
        </div>
      </Card>
    );
  }

  // FAILED (or DELETED, which a restore job never legitimately reaches
  // mid-flight, but is handled the same defensive way).
  return (
    <Card className="flex flex-col gap-3 p-4">
      <p role="alert" className="text-sm font-medium text-destructive">
        {job.failed_tab ? t('restoreFailedTab', { tab: tabLabel(t, job.failed_tab) }) : t('failed')}
      </p>
      {job.error && <p className="text-sm">{job.error}</p>}
      {job.failed_tab && (
        <p className="text-sm text-muted-foreground">
          {t('restoreFailedUndo', { tab: tabLabel(t, job.failed_tab) })}
        </p>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          loading={downloadingSnapshot}
          onClick={() => void handleDownloadSnapshot()}
        >
          {t('downloadSnapshot')}
        </Button>
      </div>
      <div>
        <Button type="button" variant="ghost" onClick={onReset}>
          {t('uploadAnother', { ns: 'bulkImport' })}
        </Button>
      </div>
    </Card>
  );
}
