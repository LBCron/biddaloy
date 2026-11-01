/**
 * [8.15.47] `/reports/runs/$runId` — where the link in a regular report email lands (Epic 8.15 D15).
 *
 * ```
 *  email: "Download: https://app.../reports/runs/<id>"   (the link works for 24 hours)
 *     |
 *     v   GET /reports/runs/:id        (a run belongs to the person it was made for)
 *  QUEUED / RUNNING  -> "Your report is being prepared"   (asks again every 3 seconds)
 *  DONE + file there -> "Your report is ready"  [Download to Excel]
 *  EXPIRED / no file -> "This file is no longer there"   -> open the report again
 *  FAILED            -> "This report could not be made"
 *  404               -> "We cannot find this file"       (someone else's, or removed: never says which)
 *  no REPORTS_EXPORT -> "You can read this report on screen only"
 * ```
 *
 * The page names no report: the status route does not carry one, and a run of someone else is a plain
 * 404, so the page says only what the file's state is, in plain words (D21). The download goes through
 * `apiClient` (it needs the sign-in header, so a plain link cannot do it).
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { Button, EmptyState, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { downloadReportRun, useHasPermission, useReportRunStatus } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { DownloadIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/reports/runs/$runId')({
  loader: () => loadRouteNamespaces('reports', 'common', 'nav'),
  component: ReportRunLanding,
});

function ReportRunLanding() {
  const { t } = useTranslation('reports');
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const canExport = useHasPermission(Permission.REPORTS_EXPORT);
  const status = useReportRunStatus(runId);
  const [downloading, setDownloading] = React.useState(false);
  const [downloadFailed, setDownloadFailed] = React.useState(false);

  const seeAll = {
    label: t('landing.back'),
    onClick: () => void navigate({ to: '/reports' }),
  };

  async function download() {
    setDownloading(true);
    setDownloadFailed(false);
    try {
      await downloadReportRun(runId);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  if (status.isPending) {
    return (
      <PageContainer>
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-11 w-48" />
        </div>
      </PageContainer>
    );
  }

  if (status.isError) {
    const gone = status.error instanceof ApiError && status.error.statusCode === 404;
    return (
      <PageContainer>
        {gone ? (
          <EmptyState
            headingLevel={1}
            title={t('landing.notFound.title')}
            explanation={t('landing.notFound.explanation')}
            action={seeAll}
          />
        ) : (
          <ErrorState
            message={t('landing.loadError')}
            retryLabel={t('landing.retry')}
            onRetry={() => void status.refetch()}
          />
        )}
      </PageContainer>
    );
  }

  const run = status.data;

  if (run.status === 'QUEUED' || run.status === 'RUNNING') {
    return (
      <PageContainer>
        <div role="status" aria-busy="true" className="flex flex-col gap-2">
          <h1 className="text-h1">{t('landing.preparing.title')}</h1>
          <p className="text-text-secondary">{t('landing.preparing.explanation')}</p>
        </div>
      </PageContainer>
    );
  }

  if (run.status === 'FAILED') {
    return (
      <PageContainer>
        <EmptyState
          headingLevel={1}
          title={t('landing.failed.title')}
          explanation={t('landing.failed.explanation')}
          action={seeAll}
        />
      </PageContainer>
    );
  }

  if (run.status === 'EXPIRED' || !run.downloadable) {
    return (
      <PageContainer>
        <EmptyState
          headingLevel={1}
          title={t('landing.expired.title')}
          explanation={t('landing.expired.explanation')}
          action={seeAll}
        />
      </PageContainer>
    );
  }

  // A file is there, but a role without REPORTS_EXPORT cannot take it out (the server says 403).
  if (!canExport) {
    return (
      <PageContainer>
        <EmptyState
          headingLevel={1}
          title={t('landing.noFile.title')}
          explanation={t('landing.noFile.explanation')}
          action={seeAll}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-h1">{t('landing.ready.title')}</h1>
        <p className="text-text-secondary">{t('landing.ready.explanation')}</p>
        <Button type="button" loading={downloading} onClick={() => void download()}>
          <DownloadIcon aria-hidden="true" />
          {run.format === 'XLSX' ? t('landing.download') : t('landing.downloadFile')}
        </Button>
        {downloadFailed && (
          <p role="alert" className="text-destructive">
            {t('landing.downloadError')}
          </p>
        )}
        <Button variant="link" className="h-auto px-0" onClick={seeAll.onClick}>
          {seeAll.label}
        </Button>
      </div>
    </PageContainer>
  );
}
