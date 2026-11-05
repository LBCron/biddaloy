import {
  Button,
  BulkUploadPreview,
  Card,
  ConfirmDialog,
  RoutePending,
  type BulkUploadPreviewController,
} from '@biddaloy/ui/components';
import {
  useCommitMarksSheet,
  useDownloadMarksSheet,
  useValidateMarksSheet,
  type MarksSheetCommitResult,
  type MarksSheetPreviewSummary,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { DownloadIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { SheetReview, translateSheetErrors } from './-sheet-review';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // mirrors the server's multer limit

/** Whole-file problems the server answers with HTTP 400/413 and `details.code`. */
const FILE_ERROR_CODES = ['WRONG_SHEET', 'UNREADABLE', 'TOO_LARGE', 'TOO_MANY_ROWS'] as const;

function fileErrorCode(err: unknown): (typeof FILE_ERROR_CODES)[number] | undefined {
  const code = (err as { details?: { code?: unknown } } | null)?.details?.code;
  return FILE_ERROR_CODES.find((c) => c === code);
}

/** HTTP status of an error from the hooks (they carry `status`, see `withHttpStatusShape`). */
const httpStatus = (err: unknown): number | undefined =>
  (err as { status?: number } | null)?.status;

/**
 * 409 (the list was submitted) and 503 (Redis down) arrive with server English; swap in a
 * translated sentence and keep `status` so the preview still treats 404/410 as "expired".
 */
function withSheetMessage(
  err: unknown,
  t: (key: string) => string,
  onSubmitted: () => void,
): unknown {
  const status = httpStatus(err);
  if (status === 409) onSubmitted();
  const key = status === 409 ? 'submitted' : status === 503 ? 'redisDown' : undefined;
  return key ? Object.assign(new Error(t(`errors.${key}`), { cause: err }), { status }) : err;
}

/**
 * `/marks/:examId/:sectionId/:subjectId/import` — [81.3.2] the teacher drops a filled marks
 * sheet, reads what will change, then saves. The trailing `_` in the file name makes it a
 * sibling of the grid route, not a child, so the grid stays a leaf route (the same trick as
 * `/my-class/$sectionId_/notes`). Closing lands back on the grid.
 *
 * The permission check is a UX gate only: the validate and commit routes enforce MARK_ENTER
 * and section scope themselves.
 */
export const Route = createFileRoute('/_staff/marks/$examId/$sectionId/$subjectId_/import')({
  loader: () => loadRouteNamespaces('marksImport', 'exams', 'common'),
  pendingComponent: MarksSheetImportPending,
  component: MarksSheetImportPage,
});

function MarksSheetImportPage() {
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <MarksSheetImportContent />
    </RegionConfigProvider>
  );
}

function MarksSheetImportContent() {
  const { examId, sectionId, subjectId } = Route.useParams();
  const { t } = useTranslation('marksImport');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const download = useDownloadMarksSheet(examId, sectionId, subjectId);
  const { mutateAsync: validateAsync } = useValidateMarksSheet(examId, sectionId, subjectId);
  const { mutateAsync: commitAsync } = useCommitMarksSheet(examId, sectionId, subjectId);

  // Set when the server says the list is submitted: the page then offers "Back to grid".
  const [submitted, setSubmitted] = React.useState(false);
  const markSubmitted = React.useCallback(() => setSubmitted(true), []);

  const validate = React.useCallback(
    (file: File, onProgress: (percent: number) => void) =>
      validateAsync({ file, onProgress }).then(
        (result) => ({ ...result, errors: translateSheetErrors(result.errors, t) }),
        (err: unknown) => {
          const code = fileErrorCode(err);
          throw code
            ? new Error(t(`errors.${code}`), { cause: err })
            : withSheetMessage(err, t, markSubmitted);
        },
      ),
    [validateAsync, t, markSubmitted],
  );

  const commit = React.useCallback(
    (stagingId: string) =>
      commitAsync(stagingId).catch((err: unknown) => {
        throw withSheetMessage(err, t, markSubmitted);
      }),
    [commitAsync, t, markSubmitted],
  );

  const backToGrid = () =>
    void navigate({
      to: '/marks/$examId/$sectionId/$subjectId',
      params: { examId, sectionId, subjectId },
    });
  const close = useCloseFullPage(backToGrid);
  const [controller, setController] = React.useState<
    BulkUploadPreviewController<MarksSheetPreviewSummary, MarksSheetCommitResult> | undefined
  >(undefined);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  const status = controller?.status ?? 'idle';
  const dirty = status === 'preview' || status === 'committing';
  const guardedClose = () => {
    if (status !== 'committing') close();
  };

  // The footer's secondary bypasses the shell's dirty check, so it asks itself.
  const secondary = {
    label: status === 'done' ? tCommon('actions.close') : tCommon('actions.cancel'),
    onClick: () => {
      if (status === 'committing') return;
      if (dirty) setDiscardOpen(true);
      else guardedClose();
    },
  };

  // Save shows how many marks it will write; with nothing to write it stays off.
  const summaryCounts = controller?.result?.summary.summary;
  const toSave = summaryCounts ? summaryCounts.new + summaryCounts.changed : 0;
  const nothingToSave = dirty && toSave === 0;

  const primary =
    status === 'done'
      ? { label: tCommon('actions.close'), onClick: backToGrid }
      : dirty
        ? {
            label: t('summary.saveCount', { n: toSave }),
            onClick: () => controller?.confirm(),
            busy: status === 'committing',
            disabled: nothingToSave || (controller?.confirmDisabled ?? true),
          }
        : { label: t('summary.save'), onClick: () => undefined, disabled: true };

  return (
    <>
      <FullPageShell
        title={t('title')}
        size="wide"
        dirty={dirty}
        onClose={guardedClose}
        secondary={secondary}
        primary={primary}
      >
        <div className="flex flex-col gap-6">
          <Card padded aria-label={t('title')}>
            <ol className="grid gap-3 md:grid-cols-3" data-testid="sheet-steps">
              <li className="flex flex-col items-start gap-2">
                <span className="font-medium">{t('steps.download')}</span>
                <Button
                  type="button"
                  variant="outline"
                  loading={download.isPending}
                  onClick={() => download.mutate()}
                >
                  <DownloadIcon aria-hidden="true" />
                  {t('steps.download')}
                </Button>
              </li>
              <li className="font-medium">{t('steps.fill')}</li>
              <li className="font-medium">{t('steps.upload')}</li>
            </ol>
          </Card>

          <Card padded aria-label={t('steps.upload')}>
            <BulkUploadPreview<MarksSheetPreviewSummary, MarksSheetCommitResult>
              accept=".xlsx,.csv"
              maxFileSize={MAX_FILE_SIZE}
              validate={validate}
              commit={commit}
              // The hook gives '' only when nothing was staged (no valid cell at all). Row
              // errors alongside staged cells do not block Save (D7).
              canCommit={(r) => r.staging_id !== '' && r.hard_error_count === 0}
              hideConfirm
              onControllerChange={setController}
              renderSummary={(result) => (
                <>
                  <SheetReview result={result} />
                  {result.summary.summary.new + result.summary.summary.changed === 0 &&
                    result.hard_error_count === 0 && (
                      <p className="text-muted-foreground" role="status">
                        {t('summary.noChanges')}
                      </p>
                    )}
                </>
              )}
              renderDone={(res) => (
                <p className="text-h2" role="status">
                  {t('summary.saved', { count: res.saved })}
                </p>
              )}
            />
          </Card>
          {submitted && (
            <div>
              <Button type="button" variant="outline" onClick={backToGrid}>
                {t('backToGrid')}
              </Button>
            </div>
          )}
        </div>
      </FullPageShell>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={tCommon('fullPage.discardTitle')}
        description={tCommon('fullPage.discardDescription')}
        confirmLabel={tCommon('fullPage.discardConfirm')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        tone="danger"
        onConfirm={guardedClose}
      />
    </>
  );
}

function MarksSheetImportPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
