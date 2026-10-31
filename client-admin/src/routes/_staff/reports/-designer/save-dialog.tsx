/**
 * [8.15.41] "Save this report": a name, who can see it, an optional folder, and two buttons.
 *
 * ```
 *  ┌ রিপোর্টটি সংরক্ষণ করুন ─────────────────────────────┐
 *  │ রিপোর্টের নাম  [ শ্রেণি ও লিঙ্গ অনুযায়ী ছাত্রছাত্রী ]  │
 *  │ কারা দেখতে পাবেন  [x] অ্যাডমিন  [ ] শিক্ষক …          │
 *  │ ফোল্ডার (ইচ্ছামতো)  [ ______ ]                        │
 *  │            [বাতিল] [সংরক্ষণ] [সবার জন্য চালু]          │
 *  └──────────────────────────────────────────────────────┘
 * ```
 *
 * "সংরক্ষণ" keeps a draft only the designer sees; "সবার জন্য চালু" also publishes it, so the roles
 * ticked can run it. Admins always see every report, so their box stays ticked. One name fills both
 * the Bangla and the English name, because only the language in use is loaded here (the same choice
 * `-save-as-report-dialog.tsx` made). The dialog does not save anything itself: `onSubmit` does, and
 * says what went wrong in `error`. A ref closes the gap before the busy button renders, so a double
 * click never saves twice.
 */
import { UserRole } from '@biddaloy/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/** The roles a report can be shown to (`REPORT_VISIBLE_ROLES` on the server). */
export const VISIBLE_ROLES = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.COMMITTEE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
] as const;

export interface SaveValues {
  name: string;
  roles: (typeof VISIBLE_ROLES)[number][];
  folder: string;
}

export type SaveMode = 'draft' | 'publish';

export interface SaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the form starts with: the name made from the question, the report's saved roles. */
  initial: SaveValues;
  /** Saves; rejects with nothing to say (the screen shows the reason in `error`). */
  onSubmit: (mode: SaveMode, values: SaveValues) => Promise<void>;
  error: string | null;
}

export function SaveDialog({ open, onOpenChange, initial, onSubmit, error }: SaveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {/* Mounts with the dialog, so every opening starts from `initial`. */}
        <SaveForm initial={initial} onSubmit={onSubmit} error={error} />
      </DialogContent>
    </Dialog>
  );
}

function SaveForm({ initial, onSubmit, error }: Omit<SaveDialogProps, 'open' | 'onOpenChange'>) {
  const { t } = useTranslation('reportDesigner');
  const { t: tStaff } = useTranslation('staff');
  const { t: tCommon } = useTranslation('common');
  const [name, setName] = React.useState(initial.name);
  const [folder, setFolder] = React.useState(initial.folder);
  const [roles, setRoles] = React.useState<ReadonlySet<string>>(() => new Set(initial.roles));
  const [nameError, setNameError] = React.useState(false);
  const [busy, setBusy] = React.useState<SaveMode | null>(null);
  const inFlight = React.useRef(false);

  async function submit(mode: SaveMode) {
    if (inFlight.current) return;
    if (name.trim() === '') {
      setNameError(true);
      return;
    }
    inFlight.current = true;
    setBusy(mode);
    try {
      await onSubmit(mode, {
        name: name.trim(),
        folder: folder.trim(),
        roles: VISIBLE_ROLES.filter((role) => roles.has(role)),
      });
    } catch {
      // `error` says what happened.
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit('draft');
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('save.title')}</DialogTitle>
        <DialogDescription>{t('save.description')}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-designer-name">{t('save.nameLabel')}</Label>
        <Input
          id="report-designer-name"
          value={name}
          maxLength={160}
          disabled={busy !== null}
          aria-required="true"
          aria-invalid={nameError}
          aria-describedby={nameError ? 'report-designer-name-error' : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(false);
          }}
        />
        {nameError && (
          <p id="report-designer-name-error" role="alert" className="text-sm text-destructive">
            {t('save.nameRequired')}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-label font-medium text-text-primary">
          {t('save.whoLabel')}
        </legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {VISIBLE_ROLES.map((role) => (
            <label key={role} className="flex min-h-11 items-center gap-3 md:min-h-8">
              <Checkbox
                checked={roles.has(role)}
                // Admins always see every report, so the box stays on.
                disabled={busy !== null || role === UserRole.ADMIN}
                onCheckedChange={(checked) =>
                  setRoles((previous) => {
                    const next = new Set(previous);
                    if (checked === true) next.add(role);
                    else next.delete(role);
                    return next;
                  })
                }
              />
              {tStaff(`roles.${role}`)}
            </label>
          ))}
        </div>
        <p className="text-caption text-text-secondary">{t('save.whoHint')}</p>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-designer-folder">{t('save.folderLabel')}</Label>
        <Input
          id="report-designer-folder"
          value={folder}
          maxLength={80}
          disabled={busy !== null}
          onChange={(event) => setFolder(event.target.value)}
        />
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost" disabled={busy !== null}>
            {tCommon('actions.cancel')}
          </Button>
        </DialogClose>
        <Button
          type="submit"
          variant="outline"
          loading={busy === 'draft'}
          disabled={busy === 'publish'}
        >
          {t('save.saveDraft')}
        </Button>
        <Button
          type="button"
          loading={busy === 'publish'}
          disabled={busy === 'draft'}
          onClick={() => void submit('publish')}
        >
          {t('save.publish')}
        </Button>
      </DialogFooter>
    </form>
  );
}
