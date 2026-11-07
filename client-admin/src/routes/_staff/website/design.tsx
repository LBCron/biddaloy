/**
 * [40.3.06] Website › Design. Pick the design, its colours and the Bangla and English fonts, and
 * set the school logo. Edits stay in a local copy of the draft until "Save draft".
 *
 * Changing the design asks first: only empty fields take the new design's default text, the
 * admin's own text stays (D25). The server does that merge on save; here the draft just names
 * the new design and moves colours and fonts onto ones the new design has.
 */
import { SiteMediaSlot, SiteTheme, type SiteTypography } from '@biddaloy/shared';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  FontPairPicker,
  ImageSlotUpload,
  PaletteSwatches,
  Skeleton,
  toast,
  type FontPairOption,
  type PaletteOption,
} from '@biddaloy/ui/components';
import {
  setPalette,
  setTheme,
  setTypography,
  usePreviewToken,
  useUploadSiteMedia,
  useWebsiteConfig,
  useWebsiteThemes,
  type WebsiteTheme,
} from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { DraftBar, uploadLabels, useDraft } from './-draft-editor';
import { ThemeCard } from './-theme-card';

const designSearchSchema = z.object({
  tab: z.string().optional(),
  step: z.string().optional(),
});

export const Route = createFileRoute('/_staff/website/design')({
  validateSearch: designSearchSchema,
  component: WebsiteDesign,
});

type Text = { bn?: string; en?: string };
interface Palette {
  id: string;
  name: Text;
  vars: Record<string, string>;
}
interface Font {
  id: string;
  family: string;
  files: string[];
}
type Lang = 'bn' | 'en';

// `ThemeSummaryDto` types these loosely; the shapes above are the theme manifest's.
const palettesOf = (theme: WebsiteTheme | undefined) =>
  (theme?.palettes ?? []) as unknown as Palette[];
const fontsOf = (theme: WebsiteTheme | undefined, lang: Lang) =>
  ((theme?.fonts as unknown as Record<Lang, Font[]> | undefined)?.[lang] ?? []) as Font[];
const defaultTypographyOf = (theme: WebsiteTheme) =>
  theme.defaultTypography as unknown as SiteTypography;
const nameOf = (text: unknown, lang: Lang, fallback: string) => {
  const n = text as Text;
  return n[lang] ?? n.en ?? n.bn ?? fallback;
};

/** The woff2 file that shows the font's own letters in the picker. */
const sampleFile = (font: Font, lang: Lang) =>
  font.files.find((f) => f.includes(lang === 'bn' ? '-400-bengali' : '-400-latin')) ??
  font.files[0] ??
  '';

function WebsiteDesign() {
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
  return <DesignEditor themes={themesQuery.data} />;
}

function DesignEditor({ themes }: { themes: readonly WebsiteTheme[] }) {
  const { t } = useTranslation('website');
  const { locale } = useLocale();
  const lang: Lang = locale === 'bn' ? 'bn' : 'en';
  const { draft, setDraft, dirty, saving, saveDraft } = useDraft();
  const [pending, setPending] = React.useState<WebsiteTheme | null>(null);
  const preview = usePreviewToken({ enabled: true });
  const uploadLogo = useUploadSiteMedia(SiteMediaSlot.LOGO);
  const [logo, setLogo] = React.useState<string | null>(null);
  React.useEffect(() => () => (logo ? URL.revokeObjectURL(logo) : undefined), [logo]);

  // The photo already saved, served by the site itself; a newly uploaded one shows from its blob.
  const savedLogo = React.useMemo(() => {
    try {
      return preview.data?.url ? `${new URL(preview.data.url).origin}/media/logo` : null;
    } catch {
      return null;
    }
  }, [preview.data?.url]);

  const theme = themes.find((x) => x.id === draft.theme) ?? themes[0];
  const paletteOptions: PaletteOption[] = palettesOf(theme).map((p) => ({
    id: p.id,
    name: { bn: nameOf(p.name, 'bn', p.id), en: nameOf(p.name, 'en', p.id) },
    colors: Object.values(p.vars),
  }));

  function confirmTheme() {
    if (!pending) return;
    const next = pending;
    setDraft((d) => {
      const moved = setTheme(d, next.id as SiteTheme);
      const keep = palettesOf(next).some((p) => p.id === d.palette);
      return setTypography(
        keep ? moved : setPalette(moved, palettesOf(next)[0]?.id ?? d.palette),
        defaultTypographyOf(next),
      );
    });
    setPending(null);
  }

  /** One font per language sets both its heading and its body (the pair the site renders). */
  const fontOptions = (l: Lang): FontPairOption[] =>
    fontsOf(theme, l).map((f) => {
      const face = { family: f.family, url: `/fonts/${sampleFile(f, l)}` };
      return { id: f.id, heading: face, body: face };
    });
  const fontValue = (l: Lang) => {
    const pair = draft.typography[l];
    return pair.heading === pair.body ? pair.heading : undefined;
  };
  const pickFont = (l: Lang, id: string) =>
    setDraft((d) => setTypography(d, { ...d.typography, [l]: { heading: id, body: id } }));

  const previewDraft = () =>
    preview.data?.url
      ? window.open(preview.data.url, '_blank', 'noopener,noreferrer')
      : toast.error(t('overview.previewError'));

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h2">{t('design.designs')}</h2>
          <Button type="button" variant="outline" disabled={dirty} onClick={previewDraft}>
            {t('design.preview')}
          </Button>
          {dirty && (
            <p className="basis-full text-caption text-text-secondary">
              {t('pages.previewSaveFirst')}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {themes.map((th) => (
            <div key={th.id} className="flex flex-col gap-1">
              <ThemeCard
                name={nameOf(th.name, lang, th.id)}
                colors={Object.values(palettesOf(th)[0]?.vars ?? {})}
                selected={th.id === theme?.id}
                onSelect={() => th.id !== theme?.id && setPending(th)}
              />
              <a
                href={`/website/preview/${th.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="link text-caption"
              >
                {t('design.previewDesign')}
              </a>
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="text-h2">{t('design.colours')}</h2>
        <p className="text-caption text-text-secondary">{t('help.colours')}</p>
        <PaletteSwatches
          palettes={paletteOptions}
          value={draft.palette}
          onChange={(id) => setDraft((d) => setPalette(d, id))}
          lang={lang}
          label={t('design.colours')}
        />
      </Card>

      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="text-h2">{t('design.textStyle')}</h2>
        <p className="text-caption text-text-secondary">{t('help.textStyle')}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {(['bn', 'en'] as const).map((l) => (
            <div key={l} className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t(`editor.language.${l}`)}</span>
              <FontPairPicker
                options={fontOptions(l)}
                value={fontValue(l)}
                onChange={(id) => pickFont(l, id)}
                lang={l}
                label={`${t('design.textStyle')}: ${t(`editor.language.${l}`)}`}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="text-h2">{t('design.logo')}</h2>
        <ImageSlotUpload
          slot={SiteMediaSlot.LOGO}
          value={logo ?? savedLogo}
          onUpload={async (blob) => {
            try {
              await uploadLogo.mutateAsync(blob);
              setLogo(URL.createObjectURL(blob));
            } catch {
              toast.error(t('overview.saveError'));
            }
          }}
          labels={uploadLabels(t)}
        />
      </Card>

      <DraftBar dirty={dirty} saving={saving} onSave={() => void saveDraft()} />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        tone="default"
        title={t('design.changeTheme.title')}
        description={t('design.changeTheme.body')}
        confirmLabel={t('design.changeTheme.confirm')}
        onConfirm={confirmTheme}
      />
    </div>
  );
}
