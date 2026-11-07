/**
 * [40.5.03] Put a PUBLISHED exam's results on the school website, or take them off (D2, D9, D16).
 *
 * Publish: says what becomes public and carries the "show names" switch (on by default, D36).
 * The names setting is saved just before publishing, only when it differs from what the exam
 * already has. Withdraw is a plain confirm. Errors are fixed sentences; nothing typed or
 * returned by the server is echoed.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
  toast,
} from '@biddaloy/ui/components';
import {
  usePreviewToken,
  usePublishExamWebsite,
  useSetExamWebsiteNames,
  useUnpublishExamWebsite,
  useWebsiteConfig,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';

export interface WebsitePublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  /** True when the results are on the website now: the dialog then withdraws them. */
  published: boolean;
  /** The exam's saved names setting. */
  showNames: boolean;
}

export function WebsitePublishDialog({
  open,
  onOpenChange,
  examId,
  published,
  showNames,
}: WebsitePublishDialogProps) {
  const { t } = useTranslation('exams');
  const { t: tc } = useTranslation('common');
  const publish = usePublishExamWebsite(examId);
  const unpublish = useUnpublishExamWebsite(examId);
  const setNames = useSetExamWebsiteNames(examId);
  const site = useWebsiteConfig();
  const preview = usePreviewToken({ enabled: open && !published });
  const [names, setNamesValue] = React.useState(showNames);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setNamesValue(showNames);
      setError(null);
    }
  }, [open, showNames]);

  const siteOff = site.data !== undefined && !(site.data.enabled && site.data.has_published);
  const busy = publish.isPending || unpublish.isPending || setNames.isPending;

  function fail(failure: unknown) {
    const status = (failure as { statusCode?: number } | null)?.statusCode;
    setError(status === 409 ? t('website.notPublished') : t('website.error'));
  }

  async function confirm() {
    setError(null);
    try {
      if (published) {
        await unpublish.mutateAsync();
        toast.success(t('website.unpublished'));
      } else {
        if (names !== showNames) await setNames.mutateAsync({ showNames: names });
        await publish.mutateAsync();
        const origin = preview.data?.url ? new URL(preview.data.url).origin : null;
        toast.success(
          t('website.published'),
          origin
            ? {
                action: {
                  label: t('website.view'),
                  onClick: () =>
                    window.open(`${origin}/bn/results/?exam=${examId}`, '_blank', 'noopener'),
                },
              }
            : undefined,
        );
      }
      onOpenChange(false);
    } catch (failure) {
      fail(failure);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent size="sm" closeLabel={tc('actions.close')}>
        <DialogHeader>
          <DialogTitle>
            {published ? t('website.unpublishTitle') : t('website.publishTitle')}
          </DialogTitle>
          <DialogDescription>
            {published
              ? t('website.unpublishBody')
              : `${t('website.publishBody')}${
                  names ? t('website.publishNamesOn') : t('website.publishNamesOff')
                }`}
          </DialogDescription>
        </DialogHeader>

        {!published && (
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={names} disabled={busy} onCheckedChange={setNamesValue} />
            <span className="flex flex-col">
              {t('website.showNames')}
              <span className="text-caption text-text-secondary">{t('website.showNamesHelp')}</span>
            </span>
          </label>
        )}

        {!published && siteOff && (
          <p className="text-caption text-text-secondary">{t('website.siteOff')}</p>
        )}

        {error && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              {tc('actions.cancel')}
            </Button>
          </DialogClose>
          <Button type="button" loading={busy} onClick={() => void confirm()}>
            {published ? t('website.unpublishConfirm') : t('website.publishConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
