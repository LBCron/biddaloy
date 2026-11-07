/**
 * [40.3.05] One editable copy of the website draft, shared by the Pages and Design tabs.
 *
 * The tab edits `draft` locally; nothing is sent until "Save draft". Saving sends the whole
 * config with the `draft_revision` it started from (409 = someone saved since). `dirty` drives
 * the bottom bar, so an admin always sees whether there is something to save.
 */
import type { SiteConfig } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { Button, toast } from '@biddaloy/ui/components';
import { useSaveDraft, type WebsiteConfig } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
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

export function useDraftEditor(config: WebsiteConfig) {
  const { t } = useTranslation('website');
  const server = draftOf(config);
  const [draft, setDraft] = React.useState<SiteConfig>(server);
  const save = useSaveDraft();

  // A save (here or on another tab) bumps the revision; start again from what the server holds.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new revision resets the copy
  React.useEffect(() => setDraft(draftOf(config)), [config.draft_revision]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(server);

  async function saveDraft() {
    try {
      const saved = await save.mutateAsync({
        config: draft as unknown as Record<string, unknown>,
        draft_revision: config.draft_revision,
      });
      setDraft(draftOf(saved));
      toast.success(t('editor.saved'));
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.statusCode === 409
          ? t('overview.stale')
          : t('editor.saveError'),
      );
    }
  }

  return { draft, setDraft, dirty, saving: save.isPending, saveDraft };
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
