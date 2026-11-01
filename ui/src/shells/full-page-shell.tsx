/**
 * D22: full-screen create/edit page. Built on a Radix Dialog (always open), so the portal
 * covers sidebar / top bar / bottom bar and gives the focus trap and scroll lock for free.
 * Close / Esc ask before discarding when `dirty`.
 *
 * Own chromeless route (`staticData: { chromeless: true }`):
 *   const close = useCloseFullPage(() => void navigate({ to: '/print-templates' }));
 *   <FullPageShell title=... onClose={close} size="wide" primary={{ label, onClick }}>...</FullPageShell>
 *
 * Overlay on a host route (optional `add: z.literal(1).optional()` in its validateSearch):
 *   const closeAdd = useCloseFullPage(() => void navigate({ search: ({ add: _a, ...rest }) => rest, replace: true }));
 *   {search.add === 1 && <FullPageShell title=... onClose={closeAdd} dirty={form.formState.isDirty}
 *     primary={{ label, onClick: form.handleSubmit(save) }}>...</FullPageShell>}
 * The primary button sits outside the page's <form>; submit via `onClick`.
 */
import { useBlocker, useRouter } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';

import { Button } from '../components/button';
import { ConfirmDialog } from '../components/confirm-dialog';
import { HelpHint, useHelp } from '../components/help-hint';
import { RoutePending } from '../components/route-pending';
import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { useWarnUnsavedChanges } from './use-form-shell';

export interface FullPageShellAction {
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** A (?) after the button (needs a help index entry, Epic 44). */
  helpId?: string | undefined;
}

export interface FullPageShellProps {
  title: string;
  onClose: () => void;
  /** Header close button text; defaults to "Close". */
  closeLabel?: string;
  dirty?: boolean;
  size?: 'form' | 'wide';
  /** Omit (with `secondary`) when the content owns its own buttons — no footer renders. */
  primary?: FullPageShellAction;
  secondary?: Pick<FullPageShellAction, 'label' | 'onClick' | 'disabled'>;
  children: React.ReactNode;
}

/**
 * Browser Back / Forward (a history `POP`, one entry or several) while the shell is `dirty` asks the same "Discard
 * changes?" question as Close and Esc. Only mounted while dirty. Clicks on links and
 * `navigate()` calls are never blocked: the page's own save-then-leave flow must not be asked.
 * A page's own close (`useCloseFullPage`) was already confirmed by the page, so it passes.
 */
function BackGuard() {
  const { t } = useTranslation('common');
  const blocker = useBlocker({
    // A page's own close goes through `history.back({ ignoreBlocker: true })`, which skips
    // every blocker for that one pop, so only a real browser Back / Forward reaches here.
    // `GO` is a jump of more than one entry (the long-press Back menu); no app code calls
    // `history.go`, so it is always the person leaving.
    shouldBlockFn: ({ action }) => action === 'BACK' || action === 'FORWARD' || action === 'GO',
    // `useWarnUnsavedChanges` owns the tab-close / reload prompt.
    enableBeforeUnload: false,
    withResolver: true,
  });
  return (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.status === 'blocked') blocker.reset();
      }}
      tone="danger"
      title={t('fullPage.discardTitle')}
      description={t('fullPage.discardDescription')}
      confirmLabel={t('fullPage.discardConfirm')}
      cancelLabel={t('fullPage.keepEditing')}
      onConfirm={() => blocker.status === 'blocked' && blocker.proceed()}
    />
  );
}

export function FullPageShell({
  title,
  onClose,
  closeLabel,
  dirty,
  size = 'form',
  primary,
  secondary,
  children,
}: FullPageShellProps) {
  const { t } = useTranslation('common');
  const [confirming, setConfirming] = React.useState(false);
  useWarnUnsavedChanges(dirty === true);
  // Without a router (a few unit tests mount the shell bare) there is no history to guard.
  // `useRouter` answers null (typed as a router) outside a RouterProvider.
  const hasRouter = Boolean(useRouter({ warn: false }) as unknown);
  const requestClose = () => (dirty ? setConfirming(true) : onClose());
  const { resolve } = useHelp();
  const primaryButton = primary && (
    <Button
      type="button"
      className="h-11"
      loading={primary.busy ?? false}
      disabled={primary.disabled ?? false}
      onClick={primary.onClick}
    >
      {primary.label}
    </Button>
  );
  const width = size === 'wide' ? 'max-w-5xl' : 'max-w-3xl';
  const bodyClass = cn('mx-auto w-full flex-1 space-y-6 px-4 py-4 md:px-6 md:py-6', width);
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-slot="full-page-shell"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            requestClose();
          }}
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-bg outline-none"
        >
          <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface">
            <div className="flex h-14 items-center justify-between gap-4 px-4 md:h-16 md:px-6">
              <DialogPrimitive.Title asChild>
                <h1 className="truncate text-h2 md:text-h1">{title}</h1>
              </DialogPrimitive.Title>
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0"
                onClick={requestClose}
              >
                <XIcon aria-hidden="true" />
                {closeLabel ?? t('actions.close')}
              </Button>
            </div>
          </header>
          {/* Content that suspends (a lazily loaded i18n namespace) must not hide this
           * dialog: hiding detaches its focus trap and Radix drops the trap from its
           * stack, so a dialog opened inside can't pause it and focus keeps being pulled
           * back (e.g. the curriculum preset confirm inside /welcome). The footer is
           * inside the boundary too, so its primary button can't act on a body that
           * hasn't mounted. */}
          <React.Suspense
            fallback={
              <div className={bodyClass}>
                <RoutePending variant="form" label={t('status.loading')} />
              </div>
            }
          >
            <div className={bodyClass}>{children}</div>
            {primary && (
              <footer className="sticky bottom-0 z-30 border-t border-border-subtle bg-surface">
                <div
                  className={cn(
                    'mx-auto flex w-full items-center justify-between gap-2 px-4 py-3 md:px-6',
                    width,
                  )}
                >
                  {secondary ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={secondary.disabled ?? false}
                      onClick={secondary.onClick}
                    >
                      {secondary.label}
                    </Button>
                  ) : (
                    <span />
                  )}
                  {/* No wrapper when no (?) renders, so the footer keeps its DOM. */}
                  {resolve(primary.helpId) ? (
                    <div className="flex items-center gap-1">
                      {primaryButton}
                      <HelpHint helpId={primary.helpId} />
                    </div>
                  ) : (
                    primaryButton
                  )}
                </div>
              </footer>
            )}
          </React.Suspense>
          {dirty === true && hasRouter && <BackGuard />}
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            tone="danger"
            title={t('fullPage.discardTitle')}
            description={t('fullPage.discardDescription')}
            confirmLabel={t('fullPage.discardConfirm')}
            cancelLabel={t('fullPage.keepEditing')}
            onConfirm={() => {
              setConfirming(false);
              onClose();
            }}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** D22 "closing returns to where the user came from": history back when there is an in-app
 * entry, else `fallback` (deep link / new tab). For an overlay, open it with a push (no
 * `replace`) so that back removes `add`; an overlay opened with `replace` must pass its own
 * close function to `onClose` instead of this hook, or back would leave the host route. */
export function useCloseFullPage(fallback: () => void): () => void {
  // Router types are not registered inside the ui package, so `useRouter()` is `any` here.
  const router = useRouter() as {
    history: {
      canGoBack: () => boolean;
      back: (opts?: { ignoreBlocker?: boolean }) => void;
    };
  };
  return React.useCallback(() => {
    if (!router.history.canGoBack()) return fallback();
    // The page already decided to leave (confirmed, or nothing to lose): the shell's Back
    // guard must not ask a second time. `ignoreBlocker` skips the blockers for this pop only.
    router.history.back({ ignoreBlocker: true });
  }, [router, fallback]);
}
