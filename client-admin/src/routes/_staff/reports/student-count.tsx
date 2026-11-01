/**
 * `/reports/student-count` — a redirect, kept so a bookmark, the sidebar item, the palette action and
 * the dashboard card still land somewhere (Epic 8.15 D23).
 *
 * The early coded BANBEIS count ([8.15.54]) is gone. The same numbers now come from the ready report
 * `student-count-banbeis`, which every school has and which opens in the ordinary report runner.
 * This page finds that report in the catalogue (`GET /reports/catalogue`, by its `system_template_key`)
 * and replaces itself with `/reports/<id>`, so "Back" does not return to a page that only redirects.
 *
 * ```
 *  /reports/student-count ── catalogue ──► entry with system_template_key = 'student-count-banbeis'
 *        │                                      │ found                       │ not in this role's catalogue
 *        │                                      ▼                             ▼
 *        └────────────────────────────  replace → /reports/<id>     "Report not found for your role"
 * ```
 *
 * A role that may not run the report (a teacher, whose sidebar still shows the item) gets the plain
 * "not found for your role" page with a way back to All reports. The old `?academic_year_id=` is
 * dropped: the runner asks for the year itself.
 */
import { EmptyState, ErrorState, RoutePending } from '@biddaloy/ui/components';
import { reportCatalogueQueryOptions, useReportCatalogue } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { BANBEIS_KEY } from '../../../dashboard/report-cards/report-cards';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/reports/student-count')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(reportCatalogueQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('reports', 'common', 'nav'),
    ]),
  pendingComponent: StudentCountPending,
  component: StudentCountRedirect,
});

function StudentCountPending() {
  const { t } = useTranslation('reports');
  return <RoutePending variant="list" label={t('studentCount.redirect.loading')} />;
}

function StudentCountRedirect() {
  const { t } = useTranslation('reports');
  const navigate = useNavigate();
  const catalogue = useReportCatalogue();

  const reportId = catalogue.data
    ?.flatMap((folder) => folder.reports)
    .find((entry) => entry.system_template_key === BANBEIS_KEY)?.id;

  React.useEffect(() => {
    if (reportId === undefined) return;
    void navigate({ to: '/reports/$reportId', params: { reportId }, replace: true });
  }, [navigate, reportId]);

  if (catalogue.isSuccess && reportId === undefined) {
    return (
      <PageContainer>
        <EmptyState
          headingLevel={1}
          title={t('studentCount.redirect.notFoundTitle')}
          explanation={t('studentCount.redirect.notFoundExplanation')}
          action={{
            label: t('hub.title'),
            onClick: () => void navigate({ to: '/reports' }),
          }}
        />
      </PageContainer>
    );
  }

  if (catalogue.isError) {
    return (
      <PageContainer>
        <ErrorState
          message={t('hub.loadError')}
          retryLabel={t('hub.retry')}
          onRetry={() => void catalogue.refetch()}
        />
      </PageContainer>
    );
  }

  return <RoutePending variant="list" label={t('studentCount.redirect.loading')} />;
}
