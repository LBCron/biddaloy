/**
 * [8.15.41] `/reports/new` — make a report. First a choice (a ready report, a question, or a blank
 * page), then the one-screen designer. Only a person who may design reports (`REPORTS_DESIGN`,
 * admin) can open it; the route guard answers everyone else.
 *
 * ```
 *  /reports/new ── start screen ──┬─ a ready report ──► copy made on the server ──► /reports/:id/edit
 *                                 ├─ a question ──────► designer (nothing saved yet)
 *                                 └─ blank (last) ────► designer (nothing saved yet)
 *  designer ── Save ──► draft created ──► /reports/:id/edit (replace)
 * ```
 */
import { ErrorState, RoutePending } from '@biddaloy/ui/components';
import {
  reportCatalogueQueryOptions,
  reportMetaQueryOptions,
  useReportMeta,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { DesignerScreen } from './-designer/designer-screen';
import type { StarterPlan } from './-designer/question-starters';
import { StartScreen } from './-designer/start-screen';
import { areaInfo, BLANK_DRAFT, draftFromPlan } from './-designer/use-designer-state';

export const Route = createFileRoute('/_staff/reports/new')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(reportMetaQueryOptions()).catch(swallowUnlessOffline),
      queryClient.ensureQueryData(reportCatalogueQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('reportDesigner', 'reports', 'reportView', 'common', 'nav', 'staff'),
    ]),
  pendingComponent: NewReportPending,
  component: NewReportPage,
});

function NewReportPending() {
  const { t } = useTranslation('reportDesigner');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

function NewReportPage() {
  const { t } = useTranslation('reportDesigner');
  const meta = useReportMeta();
  // `undefined`: still on the start screen. `null` plan: the blank page.
  const [start, setStart] = React.useState<{ plan: StarterPlan | null } | undefined>(undefined);

  if (meta.isError) {
    return (
      <ErrorState
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={() => void meta.refetch()}
      />
    );
  }
  if (meta.data === undefined) return <NewReportPending />;

  if (start === undefined)
    return <StartScreen meta={meta.data} onStart={(plan) => setStart({ plan })} />;
  const initial = start.plan
    ? draftFromPlan(start.plan, areaInfo(meta.data, start.plan.area))
    : BLANK_DRAFT;
  return <DesignerScreen meta={meta.data} initial={initial} />;
}
