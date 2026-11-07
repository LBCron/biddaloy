/**
 * The result-changing actions for an exam (process -> publish -> SMS, reopen),
 * chosen by status: one primary that always means "the next step". Used by the
 * exam detail header and by the `/results` panel toolbar, so the status table
 * lives in one place. Permissions: process needs RESULT_PROCESS; publish, SMS
 * and reopen need RESULT_PUBLISH.
 */
import { Permission } from '@biddaloy/shared';
import { useExam, useHasPermission, useResults } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { PageAction } from '@biddaloy/ui/shells';
import { useNavigate } from '@tanstack/react-router';
import { Calculator, Globe, MessageSquare, RefreshCw, RotateCcw, TrendingUp } from 'lucide-react';
import * as React from 'react';

import { ProcessDialog } from '../../results/-process-dialog';
import { PublishDialog, ReopenPreviewDialog } from '../../results/-publish-dialog';
import { SendResultSmsDialog } from '../../results/-send-result-sms-dialog';

import { WebsitePublishDialog } from './website-publish-dialog';

const ICON = 'size-4';

export function useResultActions(
  examId: string,
  examStatus: string | undefined,
): { actions: PageAction[]; dialogs: React.ReactNode } {
  const { t } = useTranslation('exams');
  const navigate = useNavigate();
  const canProcess = useHasPermission(Permission.RESULT_PROCESS);
  const canPublish = useHasPermission(Permission.RESULT_PUBLISH);
  // Same cached query the Results tab uses; only the publish / reopen / SMS dialogs need the count.
  const resultsQuery = useResults(examStatus && examStatus !== 'DRAFT' ? examId : undefined);
  const resultCount = resultsQuery.data?.length ?? 0;
  const [processOpen, setProcessOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [reopenOpen, setReopenOpen] = React.useState(false);
  const [smsOpen, setSmsOpen] = React.useState(false);
  const [websiteOpen, setWebsiteOpen] = React.useState(false);
  // Same cached exam the page header reads; only a PUBLISHED exam can go on the website.
  const exam = useExam(examStatus === 'PUBLISHED' ? examId : undefined).data;
  const onWebsite = !!exam?.website_published_at;

  if (!examStatus) return { actions: [], dialogs: null };

  const analysis: PageAction = {
    id: 'analysis',
    label: t('resultsPanel.analysis'),
    icon: <TrendingUp aria-hidden className={ICON} />,
    priority: 'secondary',
    onClick: () => void navigate({ to: '/analysis', search: { examId, tab: 'merit' as const } }),
  };
  const process: PageAction = {
    id: 'process',
    label: t('resultsPanel.process'),
    icon: <Calculator aria-hidden className={ICON} />,
    priority: 'primary',
    allowed: canProcess,
    onClick: () => setProcessOpen(true),
  };
  const reprocess: PageAction = {
    id: 'reprocess',
    label: t('resultsPanel.reprocess'),
    icon: <RefreshCw aria-hidden className={ICON} />,
    priority: 'secondary',
    allowed: canProcess,
    onClick: () => setProcessOpen(true),
  };
  const publish: PageAction = {
    id: 'publish',
    label: t('resultsPanel.publish'),
    icon: <Globe aria-hidden className={ICON} />,
    priority: 'primary',
    allowed: canPublish,
    onClick: () => setPublishOpen(true),
  };
  const sendSms: PageAction = {
    id: 'sms',
    label: t('resultsPanel.sendSms'),
    icon: <MessageSquare aria-hidden className={ICON} />,
    priority: 'primary',
    allowed: canPublish,
    onClick: () => setSmsOpen(true),
  };
  // Secondary, never primary: one primary per page (the next result step).
  const websitePublish: PageAction = {
    id: 'websitePublish',
    label: onWebsite ? t('website.unpublish') : t('website.publish'),
    icon: <Globe aria-hidden className={ICON} />,
    priority: 'secondary',
    allowed: canPublish,
    onClick: () => setWebsiteOpen(true),
  };
  const reopen: PageAction = {
    id: 'reopen',
    label: t('resultsPanel.reopen'),
    icon: <RotateCcw aria-hidden className={ICON} />,
    priority: 'destructive',
    allowed: canPublish,
    onClick: () => setReopenOpen(true),
  };

  let actions: PageAction[];
  if (examStatus === 'DRAFT') actions = [process];
  else if (examStatus === 'PROCESSED') actions = [analysis, reprocess, publish];
  else actions = [analysis, sendSms, websitePublish, reopen];

  // Without permission for the primary, the next allowed result-changing action
  // (process again) takes its place; "analysis" is never promoted.
  const primary = actions.find((a) => a.priority === 'primary');
  if (primary && primary.allowed === false && reprocess.allowed !== false) {
    actions = actions.map((a) => (a === reprocess ? { ...a, priority: 'primary' } : a));
  }

  return {
    actions,
    dialogs: (
      <>
        <ProcessDialog open={processOpen} onOpenChange={setProcessOpen} examId={examId} />
        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          examId={examId}
          resultCount={resultCount}
        />
        <ReopenPreviewDialog
          open={reopenOpen}
          onOpenChange={setReopenOpen}
          examId={examId}
          resultCount={resultCount}
        />
        <WebsitePublishDialog
          open={websiteOpen}
          onOpenChange={setWebsiteOpen}
          examId={examId}
          published={onWebsite}
          showNames={exam?.website_show_names ?? true}
        />
        <SendResultSmsDialog
          open={smsOpen}
          onOpenChange={setSmsOpen}
          examId={examId}
          examStatus={examStatus}
          resultCount={resultCount}
        />
      </>
    ),
  };
}
