/**
 * Lane-local form bits for the classes dialogs (`kit FormField` is
 * react-hook-form only, and these dialogs use plain state): a labelled
 * field with the kit's required mark, and the kit error text.
 */
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelpHint,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { CircleAlertIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';

/** Close handling for a form dialog: ignored while a request is in flight,
 * asks before discarding unsaved edits. Render `discardDialog` beside the
 * dialog and call `requestClose` from Esc / X / Cancel. */
export function useCloseGuard(
  isDirty: boolean,
  isPending: boolean,
  onOpenChange: (open: boolean) => void,
) {
  const { t } = useTranslation('common');
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const requestClose = () => {
    if (isPending) return;
    if (isDirty) setDiscardOpen(true);
    else onOpenChange(false);
  };
  const discardDialog = (
    <ConfirmDialog
      open={discardOpen}
      onOpenChange={setDiscardOpen}
      title={t('fullPage.discardTitle')}
      description={t('fullPage.discardDescription')}
      confirmLabel={t('fullPage.discardConfirm')}
      cancelLabel={t('fullPage.keepEditing')}
      tone="default"
      onConfirm={() => {
        setDiscardOpen(false);
        onOpenChange(false);
      }}
    />
  );
  return { requestClose, discardDialog };
}

export function Field({
  id,
  label,
  required,
  helpId,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  helpId?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('common');
  return (
    <div className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1">
        <label htmlFor={id} className="text-label text-text-primary">
          {label}
          {required && (
            <>
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
              <span className="sr-only">{t('form.required')}</span>
            </>
          )}
        </label>
        {helpId && <HelpHint helpId={helpId} label={label} />}
      </span>
      {children}
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

/**
 * `ConfirmDialog` with a failure line that screen readers are told about:
 * its description is a plain string, so an error swapped into it is silent.
 * Same alertdialog shape as `-delete-class-dialog.tsx`.
 */
export function DangerConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  error,
  confirmLabel,
  busy,
  onConfirm,
  helpId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Translated failure sentence; the prompt stays so retry is obvious. */
  error?: string | undefined;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  /** A (?) beside the title for the action this confirms (a row action has no (?) of its own). */
  helpId?: string | undefined;
}) {
  const { t } = useTranslation('common');
  return (
    // While the request runs no close path (Back, focus loss) may unmount it,
    // or its success/error feedback is lost; same guard as `-delete-class-dialog.tsx`.
    <Dialog open={open} onOpenChange={(next) => !(busy && !next) && onOpenChange(next)}>
      <DialogContent
        size="sm"
        role="alertdialog"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-1">
            <DialogTitle>{title}</DialogTitle>
            <HelpHint helpId={helpId} />
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              {t('actions.cancel')}
            </Button>
          </DialogClose>
          <Button type="button" variant="danger" loading={busy} onClick={onConfirm}>
            <Trash2Icon aria-hidden="true" />
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
