/**
 * [17.4.3] The calendar feed "subscribe" card — mounted on both
 * `/_staff/security` and `/portal/account` (any signed-in user, any
 * role). Shows the caller's own `webcal://` link, masked the same way
 * `SecretField` masks a stored secret, with Copy and a confirm-gated
 * Regenerate.
 *
 * Not built on `SecretField` itself — that component's whole contract is
 * "never render the plaintext, only a configured/not-configured state"
 * (see its own docstring), because a stored integration secret really is
 * write-only. A subscribe link is the opposite: the user is *meant* to
 * read and copy it, just not have it shoulder-surfed by default. So this
 * renders the real URL behind a `type="password"`-style mask with its own
 * reveal, rather than reusing `SecretField`'s configured/hint copy.
 *
 * Hidden entirely without `CALENDAR_READ` — same rule the calendar route
 * itself uses (`route-permissions.ts`).
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  ConfirmDialog,
  HelpHint,
  Input,
  Skeleton,
  toast,
} from '@biddaloy/ui/components';
import { useCalendarFeed, useHasPermission, useRegenerateCalendarFeed } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export function CalendarFeedCard() {
  const { t } = useTranslation('calendarFeed');
  const canRead = useHasPermission(Permission.CALENDAR_READ);
  const feedQuery = useCalendarFeed();
  const regenerate = useRegenerateCalendarFeed();
  const [revealed, setRevealed] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  React.useEffect(() => {
    if (confirmOpen) regenerate.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [confirmOpen]);

  if (!canRead) return null;

  async function handleCopy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('field.copied'));
    } catch {
      toast.error(t('field.copyFailed'));
    }
  }

  async function handleRegenerate(): Promise<void> {
    try {
      await regenerate.mutateAsync();
      setConfirmOpen(false);
      setRevealed(false);
    } catch {
      // `regenerate.isError` drives the translated alert below; the confirm
      // closes so the alert is visible, and the user can try again.
      setConfirmOpen(false);
    }
  }

  const url = feedQuery.data?.url;

  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5">
      <div>
        <h2 className="text-h2">{t('card.title')}</h2>
        <p className="mt-1 text-text-secondary">{t('card.description')}</p>
      </div>

      {feedQuery.isPending && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-11 w-full md:h-8" />
        </div>
      )}

      {feedQuery.isError && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-destructive">{t('error.load')}</span>
          <Button type="button" variant="outline" onClick={() => void feedQuery.refetch()}>
            {t('error.retry')}
          </Button>
        </div>
      )}

      {url && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="calendar-feed-url" className="text-label">
              {t('field.label')}
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="calendar-feed-url"
                type={revealed ? 'text' : 'password'}
                readOnly
                value={url}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setRevealed((current) => !current)}
              >
                {revealed ? t('field.hide') : t('field.show')}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleCopy(url)}>
                {t('field.copy')}
              </Button>
            </div>
          </div>

          {regenerate.isError && !confirmOpen && (
            <p role="alert" className="text-destructive">
              {t('regenerate.failed')}
            </p>
          )}

          <div className="flex items-center gap-1 self-start">
            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(true)}>
              {t('regenerate.action')}
            </Button>
            <HelpHint helpId="people.calendar.action.regenerateFeed" />
          </div>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={(next) => {
              // Cancelling must not leave an earlier failure to resurface.
              if (!next) regenerate.reset();
              setConfirmOpen(next);
            }}
            tone="default"
            title={t('regenerate.confirmTitle')}
            description={t('regenerate.confirmDescription')}
            confirmLabel={t('regenerate.confirmAction')}
            cancelLabel={t('regenerate.cancel')}
            busy={regenerate.isPending}
            onConfirm={() => void handleRegenerate()}
          />

          <div className="flex flex-col gap-0.5 text-caption text-text-secondary">
            <p className="font-medium">{t('howTo.title')}</p>
            <p>{t('howTo.google')}</p>
            <p>{t('howTo.apple')}</p>
            <p>{t('howTo.outlook')}</p>
          </div>
        </>
      )}
    </Card>
  );
}
