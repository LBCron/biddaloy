/**
 * [40.3.05] One editable copy of the website draft, shared by the Pages and Design tabs.
 *
 * The tab edits `draft` locally; nothing is sent until "Save draft". Saving sends the whole
 * config with the `draft_revision` it started from (409 = someone saved since). `dirty` drives
 * the bottom bar, so an admin always sees whether there is something to save.
 */
import type { SiteConfig } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { Button, ConfirmDialog, toast } from '@biddaloy/ui/components';
import { useSaveDraft, useWebsiteConfig, type WebsiteConfig } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useBlocker } from '@tanstack/react-router';
import * as React from 'react';

/** The photo uploader's texts: the wizard's logo step already holds the plain-words set. */
export const uploadLabels = (t: (key: string) => string) => ({
  choose: t('wizard.logo.choose'),
  zoom: t('wizard.logo.zoom'),
  save: t('wizard.logo.save'),
  svgRefused: t('wizard.logo.svgRefused'),
  tooLarge: t('wizard.logo.tooLarge'),
  unreadable: t('wizard.logo.unreadable'),
  pan: t('wizard.logo.pan'),
});

export const draftOf = (config: WebsiteConfig) => config.draft as unknown as SiteConfig;

const NOTHING = {} as SiteConfig;

function useDraftEditor(config: WebsiteConfig | undefined) {
  const { t } = useTranslation('website');
  const server = config ? draftOf(config) : NOTHING;
  const serverJson = JSON.stringify(server);
  // `local` is null until the admin edits: the screen then follows the server draft (another
  // tab saved, a refetch). Once there are edits they are kept, never replaced silently.
  const [local, setLocal] = React.useState<SiteConfig | null>(null);
  const save = useSaveDraft();
  const dirty = local !== null && JSON.stringify(local) !== serverJson;
  const draft = dirty ? local : server;
  const setDraft = (update: (d: SiteConfig) => SiteConfig) => setLocal((l) => update(l ?? server));

  // Leaving for another page or tab while there are unsaved edits asks first (Rule: no silent loss).
  const blocker = useBlocker({
    // Tabs share this draft, so moving between `/website` tabs is free; leaving `/website` asks.
    shouldBlockFn: ({ next }) => dirty && !/^\/website(\/|$)/.test(next.pathname),
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  const common = useTranslation('common').t;
  const leaveGuard = (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.status === 'blocked') blocker.reset();
      }}
      tone="danger"
      title={common('fullPage.discardTitle')}
      description={common('fullPage.discardDescription')}
      confirmLabel={common('fullPage.discardConfirm')}
      cancelLabel={common('fullPage.keepEditing')}
      onConfirm={() => blocker.status === 'blocked' && blocker.proceed()}
    />
  );

  async function saveDraft() {
    if (!config) return;
    const sent = local;
    if (!sent) return;
    try {
      await save.mutateAsync({
        config: sent as unknown as Record<string, unknown>,
        draft_revision: config.draft_revision,
      });
      // Anything typed while the save was in flight stays; only an untouched copy takes the answer.
      setLocal((l) => (l === sent ? null : l));
      toast.success(t('editor.saved'));
    } catch (error) {
      // A 409 keeps the local edits on screen; the admin reloads and re-applies them.
      toast.error(
        error instanceof ApiError && error.statusCode === 409
          ? t('overview.stale')
          : t('editor.saveError'),
      );
    }
  }

  return { draft, setDraft, dirty, saving: save.isPending, saveDraft, leaveGuard, ready: !!config };
}

type DraftEditor = ReturnType<typeof useDraftEditor>;
const DraftContext = React.createContext<DraftEditor | null>(null);

/**
 * Holds the one local draft for every `/website` tab, so switching tabs never drops unsaved
 * edits. Mounted by the layout (`website.tsx`), above the tab panels.
 */
export function DraftProvider({ children }: { children: React.ReactNode }) {
  const config = useWebsiteConfig().data;
  const editor = useDraftEditor(config);
  return (
    <DraftContext.Provider value={editor}>
      {children}
      {editor.leaveGuard}
    </DraftContext.Provider>
  );
}

export function useDraft(): Omit<DraftEditor, 'leaveGuard'> {
  const editor = React.useContext(DraftContext);
  if (!editor) throw new Error('useDraft needs <DraftProvider>');
  return editor;
}

/** Sticks to the bottom while there is something to save (kit `FormShell` dirty pattern). */
export function DraftBar({
  dirty,
  saving,
  disabled,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  onSave: () => void;
}) {
  const { t } = useTranslation('website');
  if (!dirty) return null;
  return (
    <div
      role="status"
      className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-card px-4 py-3"
    >
      <span className="text-sm">{t('pages.unsaved')}</span>
      <Button type="button" disabled={saving || disabled} onClick={onSave}>
        {t('pages.saveDraft')}
      </Button>
    </div>
  );
}
