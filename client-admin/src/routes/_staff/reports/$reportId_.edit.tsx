/**
 * [8.15.41] `/reports/$reportId/edit` — change a report in the designer.
 *
 * ```
 *  GET /reports/definitions/:id
 *    ├─ has a draft ────────────► designer, filled from the draft
 *    └─ no draft (a ready report, or one with nothing to change yet)
 *         ► "copy and change": one click makes a copy (`POST …/clone`) and opens that
 * ```
 *
 * A ready report is never edited in place: its copy is. A report that is already live keeps running
 * unchanged until its draft is switched on again ("সবার জন্য চালু"). Admin only (`REPORTS_DESIGN`).
 */
import type { ReportDefinitionJson } from '@biddaloy/shared';
import { Button, EmptyState, ErrorState, RoutePending } from '@biddaloy/ui/components';
import {
  reportDefinitionQueryOptions,
  reportMetaQueryOptions,
  useCloneReportDefinition,
  useReportDefinition,
  useReportMeta,
} from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { DesignerScreen } from './-designer/designer-screen';
import { areaInfo, draftFromDefinition } from './-designer/use-designer-state';

export const Route = createFileRoute('/_staff/reports/$reportId_/edit')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(reportDefinitionQueryOptions(params.reportId))
        .catch(swallowUnlessOffline),
      queryClient.ensureQueryData(reportMetaQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('reportDesigner', 'reports', 'reportView', 'common', 'nav', 'staff'),
    ]),
  pendingComponent: EditPending,
  component: EditReportPage,
});

function EditPending() {
  const { t } = useTranslation('reportDesigner');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

function EditReportPage() {
  const { reportId } = Route.useParams();
  // Keyed, so opening another report starts clean instead of reusing this one's trays.
  return <EditReport key={reportId} reportId={reportId} />;
}

function EditReport({ reportId }: { reportId: string }) {
  const { t } = useTranslation('reportDesigner');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const definition = useReportDefinition(reportId);
  const meta = useReportMeta();
  const clone = useCloneReportDefinition();
  const [copyFailed, setCopyFailed] = React.useState(false);
  const inFlight = React.useRef(false);

  if (definition.isError || meta.isError) {
    return (
      <ErrorState
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={() => {
          void definition.refetch();
          void meta.refetch();
        }}
      />
    );
  }
  if (definition.data === undefined || meta.data === undefined) return <EditPending />;

  const detail = definition.data;
  const name = (locale === 'bn' ? detail.name_bn : detail.name_en) || detail.name_en;
  const draft = detail.draft as ReportDefinitionJson | null;

  if (draft === null) {
    async function copyAndChange() {
      if (inFlight.current) return;
      inFlight.current = true;
      setCopyFailed(false);
      try {
        const copy = await clone.mutateAsync(reportId);
        await navigate({
          to: '/reports/$reportId/edit',
          params: { reportId: copy.id },
          replace: true,
        });
      } catch {
        setCopyFailed(true);
      } finally {
        inFlight.current = false;
      }
    }
    return (
      <PageContainer>
        <div className="flex flex-col items-center gap-3">
          <EmptyState
            headingLevel={1}
            title={t('copy.title', { name })}
            explanation={t('copy.explanation')}
          />
          <Button type="button" loading={clone.isPending} onClick={() => void copyAndChange()}>
            {t('copy.action')}
          </Button>
          {copyFailed && (
            <p role="alert" className="text-sm text-destructive">
              {t('copy.error')}
            </p>
          )}
        </div>
      </PageContainer>
    );
  }

  return (
    <DesignerScreen
      meta={meta.data}
      initial={draftFromDefinition(draft, areaInfo(meta.data, draft.subjectArea))}
      report={{
        id: detail.id,
        name,
        folder: detail.folder,
        roles: detail.visible_roles,
      }}
    />
  );
}
