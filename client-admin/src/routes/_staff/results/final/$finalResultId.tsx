/**
 * [70.5.3] One class's final result: Setup, Results and Print tabs (`?tab=`), with the next step
 * for its status in the header: DRAFT builds, PROCESSED publishes (and can build again), PUBLISHED
 * can send the SMS or be reopened (step-up approval, `results.reopen`).
 */
import { Permission } from '@biddaloy/shared';
import { ErrorState, RoutePending, StatusBadge } from '@biddaloy/ui/components';
import { finalResultQueryOptions, useFinalResult, useHasPermission } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab, type PageAction } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { Calculator, Globe, MessageSquare, RefreshCw, RotateCcw } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { BuildDialog } from './-build-dialog';
import { PrintPanel } from './-print-panel';
import { PublishDialog, ReopenDialog } from './-publish-dialog';
import { ResultsPanel } from './-results-panel';
import { SetupPanel } from './-setup-panel';
import { SmsDialog } from './-sms-dialog';

const searchSchema = z.object({
  tab: z.string().optional().catch(undefined),
  /** Student the Print tab opens on (set by a row on the Results tab). */
  student: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/results/final/$finalResultId')({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(finalResultQueryOptions(params.finalResultId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'common', 'examDocuments', 'myClass', 'nav'),
    ]),
  pendingComponent: FinalDetailPending,
  component: FinalDetailPage,
});

const TAB_IDS = ['setup', 'results', 'print'] as const;
const TONE = { DRAFT: 'neutral', PROCESSED: 'info', PUBLISHED: 'success' } as const;
const ICON = 'size-4';

type Dialogs = 'build' | 'publish' | 'reopen' | 'sms' | null;

function FinalDetailPage() {
  const { finalResultId } = Route.useParams();
  const { t } = useTranslation('exams');
  const config = useRegionConfig();
  const query = useFinalResult(finalResultId);
  const summary = query.data;
  const canProcess = useHasPermission(Permission.RESULT_PROCESS);
  const canPublish = useHasPermission(Permission.RESULT_PUBLISH);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);
  const [dialog, setDialog] = React.useState<Dialogs>(null);

  React.useEffect(() => {
    if (summary) {
      document.title =
        t('finalResults.documentTitle.detail', {
          class: summary.class.name,
          year: summary.academic_year.name,
        }) + ' · Biddaloy';
    }
  }, [summary, t]);

  if (query.isPending) return <FinalDetailPending />;
  if (query.isError || !summary) {
    return (
      <ErrorState
        message={t('finalResults.detail.loadError')}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const build: PageAction = {
    id: 'build',
    label: t('finalResults.actions.build'),
    icon: <Calculator aria-hidden className={ICON} />,
    priority: 'primary',
    allowed: canProcess,
    onClick: () => setDialog('build'),
  };
  const rebuild: PageAction = {
    id: 'rebuild',
    label: t('finalResults.actions.rebuild'),
    icon: <RefreshCw aria-hidden className={ICON} />,
    priority: 'secondary',
    allowed: canProcess,
    onClick: () => setDialog('build'),
  };
  const publish: PageAction = {
    id: 'publish',
    label: t('finalResults.actions.publish'),
    icon: <Globe aria-hidden className={ICON} />,
    priority: 'primary',
    allowed: canPublish,
    onClick: () => setDialog('publish'),
  };
  const sms: PageAction = {
    id: 'sms',
    label: t('finalResults.actions.sendSms'),
    icon: <MessageSquare aria-hidden className={ICON} />,
    priority: 'secondary',
    allowed: canPublish,
    onClick: () => setDialog('sms'),
  };
  const reopen: PageAction = {
    id: 'reopen',
    label: t('finalResults.actions.reopen'),
    icon: <RotateCcw aria-hidden className={ICON} />,
    priority: 'destructive',
    allowed: canPublish,
    onClick: () => setDialog('reopen'),
  };
  const actions =
    summary.status === 'DRAFT'
      ? [build]
      : summary.status === 'PROCESSED'
        ? [publish, rebuild]
        : [sms, reopen];

  const built = summary.status !== 'DRAFT';
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <DetailShell
        name={`${summary.class.name} · ${t('finalResults.title')} ${summary.academic_year.name}`}
        statusBadge={
          <StatusBadge
            tone={TONE[summary.status]}
            label={t(`finalResults.status.${summary.status}`)}
          />
        }
        facts={[
          { label: t('finalResults.detail.facts.class'), value: summary.class.name },
          { label: t('finalResults.detail.facts.academicYear'), value: summary.academic_year.name },
          ...(built
            ? [
                {
                  label: t('finalResults.detail.facts.students'),
                  value: formatNumber(summary.counts.students, config),
                },
                {
                  label: t('finalResults.detail.facts.failed'),
                  value: formatNumber(summary.counts.failed, config),
                },
              ]
            : []),
          ...(summary.published_at
            ? [
                {
                  label: t('finalResults.detail.facts.publishedAt'),
                  value: formatDate(summary.published_at, config),
                },
              ]
            : []),
        ]}
        actions={actions}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'setup',
            label: t('finalResults.tabs.setup'),
            content: <SetupPanel summary={summary} />,
          },
          {
            id: 'results',
            label: t('finalResults.tabs.results'),
            content: <ResultsPanel summary={summary} />,
          },
          {
            id: 'print',
            label: t('finalResults.tabs.print'),
            content: <PrintPanel summary={summary} />,
          },
        ]}
      />
      <BuildDialog open={dialog === 'build'} onOpenChange={close} finalResultId={summary.id} />
      <PublishDialog
        open={dialog === 'publish'}
        onOpenChange={close}
        finalResultId={summary.id}
        classId={summary.class.id}
      />
      <ReopenDialog open={dialog === 'reopen'} onOpenChange={close} finalResultId={summary.id} />
      <SmsDialog
        open={dialog === 'sms'}
        onOpenChange={close}
        finalResultId={summary.id}
        published={summary.status === 'PUBLISHED'}
        yearName={summary.academic_year.name}
      />
    </>
  );
}

function FinalDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
