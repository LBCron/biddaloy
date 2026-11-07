/**
 * [40.2.04] Website › Overview. Never published: one card that opens the first-run wizard.
 * Published: status, live link (copy), preview, publish, and the on/off switch.
 *
 * Publish is enabled only while `has_unpublished_changes`. `?publish=1` (palette) opens the
 * publish confirm, or the wizard's last step on a never-published site.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  Switch,
  toast,
} from '@biddaloy/ui/components';
import {
  usePreviewToken,
  usePublishWebsite,
  useSetWebsiteEnabled,
  useWebsiteConfig,
  useWebsiteMedia,
  useWebsiteThemes,
  type WebsiteConfig,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { GlobeIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { useLandingFlag } from '../-use-landing-flag';

import { WebsiteWizard } from './-wizard';

const overviewSearchSchema = z.object({
  tab: z.string().optional(),
  step: z.string().optional(),
  publish: z.coerce.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/website/')({
  validateSearch: overviewSearchSchema,
  component: WebsiteOverview,
});

const MB = 1024 * 1024;

function WebsiteOverview() {
  const { t } = useTranslation('website');
  const navigate = useNavigate();
  const { step, publish } = Route.useSearch();
  const configQuery = useWebsiteConfig();
  const themesQuery = useWebsiteThemes();

  // `?publish=1` (palette) on a never-published site: there is nothing to confirm yet, so take
  // the admin to the wizard's last step instead of silently showing the start card.
  const neverPublished = configQuery.data?.has_published === false;
  React.useEffect(() => {
    if (neverPublished && publish !== undefined && step === undefined) {
      void navigate({ to: '/website', search: { step: 'publish' }, replace: true });
    }
  }, [neverPublished, publish, step, navigate]);

  if (configQuery.isPending) return <Skeleton className="h-40 w-full" />;
  if (configQuery.isError) {
    return (
      <ErrorState
        message={t('overview.saveError')}
        retryLabel={t('wizard.back')}
        onRetry={() => void configQuery.refetch()}
      />
    );
  }
  const config = configQuery.data;
  const close = () => void navigate({ to: '/website', search: {}, replace: true });

  if (step !== undefined) {
    if (!themesQuery.data) return <Skeleton className="h-64 w-full" />;
    return <WebsiteWizard config={config} themes={themesQuery.data} onDone={close} />;
  }
  if (!config.has_published) {
    return (
      <EmptyState
        icon={<GlobeIcon aria-hidden="true" />}
        title={t('overview.off.title')}
        explanation={t('overview.off.body')}
        action={{
          label: t('overview.off.action'),
          onClick: () =>
            void navigate({ to: '/website', search: { step: 'address' }, replace: false }),
        }}
      />
    );
  }
  return <StatusCard config={config} />;
}

function StatusCard({ config }: { config: WebsiteConfig }) {
  const { t } = useTranslation('website');
  const [publishOpen, setPublishOpen] = useLandingFlag('publish', true);
  const [switchTo, setSwitchTo] = React.useState<boolean | null>(null);
  const publish = usePublishWebsite();
  const setEnabled = useSetWebsiteEnabled();
  const preview = usePreviewToken({ enabled: true });
  const media = useWebsiteMedia();

  const previewUrl = preview.data?.url;
  // The preview link is `https://<address>.<root>/?preview=…`; the live link is its origin.
  const liveUrl = previewUrl ? new URL(previewUrl).origin : null;

  const fail = (error: unknown) =>
    toast.error(
      error instanceof ApiError && error.statusCode === 409
        ? t('overview.stale')
        : t('overview.saveError'),
    );

  async function confirmPublish() {
    try {
      await publish.mutateAsync({
        version: config.version,
        draft_revision: config.draft_revision,
      });
      setPublishOpen(false);
    } catch (error) {
      setPublishOpen(false);
      fail(error);
    }
  }

  async function confirmSwitch() {
    if (switchTo === null) return;
    try {
      await setEnabled.mutateAsync(switchTo);
    } catch (error) {
      fail(error);
    }
    setSwitchTo(null);
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('overview.copied'));
    } catch {
      toast.error(t('overview.copyFailed'));
    }
  }

  const used = ((media.data?.usedBytes ?? 0) / MB).toFixed(1);
  const total = Math.round((media.data?.quotaBytes ?? 0) / MB);

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge
          tone={config.enabled ? 'success' : 'neutral'}
          label={config.enabled ? t('overview.status.live') : t('overview.status.draft')}
        />
        {config.has_unpublished_changes && (
          <StatusBadge tone="warning" label={t('overview.unpublished')} />
        )}
        <label className="ms-auto flex items-center gap-2 text-sm">
          {config.enabled ? t('overview.turnOff.action') : t('overview.turnOn.action')}
          <Switch
            checked={config.enabled}
            disabled={setEnabled.isPending}
            onCheckedChange={(next) => setSwitchTo(next)}
          />
        </label>
      </div>

      {config.enabled && liveUrl && (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">{t('overview.liveLink')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <a href={liveUrl} target="_blank" rel="noopener noreferrer" dir="ltr" className="link">
              {liveUrl}
            </a>
            <Button type="button" variant="outline" onClick={() => void copy(liveUrl)}>
              {t('overview.copy')}
            </Button>
          </div>
        </div>
      )}

      <p className="text-caption text-text-secondary">
        {t('overview.usageLabel')}: {t('overview.usage', { used, total })}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!config.has_unpublished_changes}
          onClick={() => setPublishOpen(true)}
        >
          {t('overview.publish')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!previewUrl}
          onClick={() => previewUrl && window.open(previewUrl, '_blank', 'noopener,noreferrer')}
        >
          {t('overview.preview')}
        </Button>
      </div>

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        tone="default"
        title={t('overview.publishConfirm.title')}
        description={t('overview.publishConfirm.body')}
        confirmLabel={t('overview.publish')}
        busy={publish.isPending}
        onConfirm={() => void confirmPublish()}
      />
      <ConfirmDialog
        open={switchTo !== null}
        onOpenChange={(open) => !open && setSwitchTo(null)}
        tone={switchTo ? 'default' : 'danger'}
        title={t(switchTo ? 'overview.turnOn.title' : 'overview.turnOff.title')}
        description={t(switchTo ? 'overview.turnOn.body' : 'overview.turnOff.body')}
        confirmLabel={t(switchTo ? 'overview.turnOn.action' : 'overview.turnOff.action')}
        busy={setEnabled.isPending}
        onConfirm={() => void confirmSwitch()}
      />
    </Card>
  );
}
