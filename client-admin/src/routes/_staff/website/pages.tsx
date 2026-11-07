/**
 * [40.3.05] Website › Pages. Pick a page, switch its sections on or off, move them, and edit
 * their words; the announcement bar sits above as its own card (D31). Edits stay in a local
 * copy of the draft until "Save draft"; "Publish" stays on Overview.
 *
 * The section editor is a full-page overlay opened by `?edit=<section>`, so Back closes it.
 */
import { SitePage, type SiteSectionKey } from '@biddaloy/shared';
import {
  Button,
  Card,
  ErrorState,
  SectionOrderList,
  Skeleton,
  Switch,
} from '@biddaloy/ui/components';
import {
  isPinnedSection,
  moveSection,
  setAnnouncements,
  toggleSection,
  useWebsiteConfig,
  useWebsiteThemes,
  type WebsiteTheme,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { AnnouncementsEditor, announcementsInvalid } from './-announcements-editor';
import { DraftBar, useDraft } from './-draft-editor';
import { SectionEditorModal } from './-section-editor-modal';

const pagesSearchSchema = z.object({
  tab: z.string().optional(),
  step: z.string().optional(),
  page: z.string().optional(),
  edit: z.string().optional(),
});

export const Route = createFileRoute('/_staff/website/pages')({
  validateSearch: pagesSearchSchema,
  component: WebsitePages,
});

/** The pages an admin edits here; notices, blog and results fill themselves from the school. */
const EDITABLE_PAGES = [
  SitePage.HOME,
  SitePage.ABOUT,
  SitePage.ACADEMICS,
  SitePage.ADMISSIONS,
  SitePage.NEWS,
  SitePage.TEACHERS,
  SitePage.CONTACT,
] as const;

function WebsitePages() {
  const { t } = useTranslation('website');
  const configQuery = useWebsiteConfig();
  const themesQuery = useWebsiteThemes();
  const { ready } = useDraft();
  if (!ready || configQuery.isPending || themesQuery.isPending)
    return <Skeleton className="h-40 w-full" />;
  if (configQuery.isError || themesQuery.isError) {
    return (
      <ErrorState
        message={t('overview.saveError')}
        retryLabel={t('wizard.back')}
        onRetry={() => {
          void configQuery.refetch();
          void themesQuery.refetch();
        }}
      />
    );
  }
  const theme = themesQuery.data.find((x) => x.id === configQuery.data.theme);
  return <PagesEditor theme={theme} />;
}

function PagesEditor({ theme }: { theme: WebsiteTheme | undefined }) {
  const { t } = useTranslation('website');
  const navigate = useNavigate();
  const { page: pageParam, edit } = Route.useSearch();
  const { draft, setDraft, dirty, saving, saveDraft } = useDraft();

  const closeEditor = useCloseFullPage(
    () =>
      void navigate({
        to: '/website/pages',
        search: pageParam ? { page: pageParam } : {},
        replace: true,
      }),
  );

  const present = EDITABLE_PAGES.filter((p) => draft.pages.some((x) => x.page === p));
  const page = present.find((p) => p === pageParam) ?? present[0];
  const current = draft.pages.find((p) => p.page === page);
  const sectionName = (key: string) => t(`pages.sectionNames.${key}`);
  const edit_ = current?.sections.find((s) => s.key === edit);

  // `?edit=` naming nothing in this draft (typo, stale link) is dropped instead of showing a blank editor.
  const unknownEdit = edit !== undefined && !edit_;
  React.useEffect(() => {
    if (unknownEdit)
      void navigate({
        to: '/website/pages',
        search: pageParam ? { page: pageParam } : {},
        replace: true,
      });
  }, [unknownEdit, navigate, pageParam]);

  const setPageEnabled = (next: boolean) =>
    setDraft((d) => ({
      ...d,
      pages: d.pages.map((p) => (p.page === page ? { ...p, enabled: next } : p)),
    }));

  return (
    <div className="flex flex-col gap-4">
      <AnnouncementsEditor
        value={draft.announcements}
        onChange={(bar) => setDraft((d) => setAnnouncements(d, bar))}
      />

      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="text-h2">{t('pages.title')}</h2>
        <div role="group" aria-label={t('pages.title')} className="flex flex-wrap gap-2">
          {present.map((p) => (
            <Button
              key={p}
              type="button"
              variant={p === page ? 'default' : 'outline'}
              aria-pressed={p === page}
              onClick={() =>
                void navigate({
                  to: '/website/pages',
                  search: { page: p },
                  replace: true,
                })
              }
            >
              {t(`pages.pageNames.${p}`)}
            </Button>
          ))}
        </div>

        {current && page && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={current.enabled} onCheckedChange={setPageEnabled} />
              {t('pages.show')}
            </label>
            {!current.enabled && (
              <p className="text-caption text-text-secondary">{t('pages.pageOff')}</p>
            )}
            <h3 className="text-sm font-medium">{t('pages.sections')}</h3>
            <SectionOrderList
              sections={current.sections.map((s) => ({
                key: s.key,
                name: sectionName(s.key),
                enabled: s.enabled,
                pinned: isPinnedSection(s.key),
              }))}
              onToggle={(key, on) =>
                setDraft((d) => toggleSection(d, page, key as SiteSectionKey, on))
              }
              onMove={(from, to) => setDraft((d) => moveSection(d, page, from, to))}
              onEdit={(key) =>
                void navigate({
                  to: '/website/pages',
                  search: { page, edit: key },
                })
              }
              labels={{
                toggle: (name) => t('pages.toggle', { name }),
                up: (name, position) => t('pages.up', { name, position }),
                down: (name, position) => t('pages.down', { name, position }),
                edit: (name) => t('pages.editSection', { name }),
                pinned: t('pages.pinned'),
              }}
            />
          </>
        )}
      </Card>

      <DraftBar
        dirty={dirty}
        saving={saving}
        disabled={announcementsInvalid(draft.announcements)}
        onSave={() => void saveDraft()}
      />

      {page && edit_ && (
        <SectionEditorModal
          page={page}
          sectionKey={edit_.key}
          name={sectionName(edit_.key)}
          draft={draft}
          theme={theme}
          onApply={(next) => setDraft(() => next)}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}
