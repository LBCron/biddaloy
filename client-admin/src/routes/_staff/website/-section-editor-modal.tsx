/**
 * [40.3.05] Edit one section: every text in Bangla and English, its photos, and the text style
 * per language. The fields come from the chosen design's manifest, so each design asks only for
 * what it shows. "Save" puts the edits into the page's draft; the Pages tab saves the draft.
 *
 * A `richtext` field is plain text on the site today (it shows with line breaks), so it is a
 * multi-line bilingual field here, not the Slate editor.
 */
import {
  SITE_HERO_MAX_PHOTOS,
  SiteMediaSlot,
  type SiteConfig,
  type SitePage,
  type SiteSectionKey,
  type SiteSectionTypography,
  type SiteTextStyle,
} from '@biddaloy/shared';
import {
  BilingualField,
  Button,
  ImageSlotUpload,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@biddaloy/ui/components';
import { usePreviewToken, useUploadSiteMedia, type WebsiteTheme } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import * as React from 'react';

import { uploadLabels, useDraft } from './-draft-editor';

type Text = { bn?: string; en?: string };
interface ManifestField {
  key: string;
  kind: 'text' | 'richtext' | 'images';
  defaults?: Text;
  slot?: SiteMediaSlot;
}
interface ManifestSection {
  key: string;
  fields: ManifestField[];
}
// `ThemeSummaryDto` types these loosely; the shapes above are the theme manifest's.
export const sectionFieldsOf = (theme: WebsiteTheme | undefined, key: string) =>
  ((theme?.sections ?? []) as unknown as ManifestSection[]).find((s) => s.key === key)?.fields ??
  [];

const SIZES = ['S', 'M', 'L', 'XL'] as const;
const WEIGHTS = ['regular', 'medium', 'bold'] as const;
const ALIGNS = ['start', 'center'] as const;
const DEFAULT = '__default';

const textOf = (data: Record<string, unknown>, key: string) => {
  const v = data[key] as Text | undefined;
  return { bn: v?.bn ?? '', en: v?.en ?? '' };
};

export interface SectionEditorModalProps {
  page: SitePage;
  sectionKey: SiteSectionKey;
  /** Already in the reader's language. */
  name: string;
  draft: SiteConfig;
  theme: WebsiteTheme | undefined;
  /** Gets the whole draft with this section's edits in it. */
  onApply: (next: SiteConfig) => void;
  onClose: () => void;
}

export function SectionEditorModal({
  page,
  sectionKey,
  name,
  draft,
  theme,
  onApply,
  onClose,
}: SectionEditorModalProps) {
  const { t } = useTranslation('website');
  const section = draft.pages
    .find((p) => p.page === page)
    ?.sections.find((s) => s.key === sectionKey);
  const fields = sectionFieldsOf(theme, sectionKey);
  const [data, setData] = React.useState<Record<string, unknown>>(section?.data ?? {});
  const [typography, setTypography] = React.useState<SiteSectionTypography>(
    section?.typography ?? {},
  );
  const preview = usePreviewToken({ enabled: true });
  // The preview shows what the server holds, so it waits until everything is saved.
  const unsaved = useDraft().dirty;
  const dirty =
    JSON.stringify([data, typography]) !==
    JSON.stringify([section?.data ?? {}, section?.typography ?? {}]);

  function apply() {
    onApply({
      ...draft,
      pages: draft.pages.map((p) =>
        p.page !== page
          ? p
          : {
              ...p,
              sections: p.sections.map((s) =>
                s.key === sectionKey ? { ...s, data, typography } : s,
              ),
            },
      ),
    });
    onClose();
  }

  function setStyle(
    lang: 'bn' | 'en',
    role: 'heading' | 'body',
    prop: keyof SiteTextStyle,
    value: string,
  ) {
    setTypography((prev) => {
      const style: Record<string, string> = { ...(prev[lang]?.[role] ?? {}) };
      if (value === DEFAULT) delete style[prop];
      else style[prop] = value;
      return { ...prev, [lang]: { ...prev[lang], [role]: style } };
    });
  }

  const choices = {
    size: SIZES.map((v) => [v, t(`editor.typography.sizes.${v}`)] as const),
    weight: WEIGHTS.map((v) => [v, t(`editor.typography.weights.${v}`)] as const),
    align: ALIGNS.map((v) => [v, t(`editor.typography.aligns.${v}`)] as const),
  };

  return (
    <FullPageShell
      title={t('pages.editSection', { name })}
      onClose={onClose}
      closeLabel={t('editor.back')}
      dirty={dirty}
      size="wide"
      primary={{ label: t('editor.save'), onClick: apply }}
      secondary={{
        label: unsaved
          ? `${t('design.preview')} (${t('pages.previewSaveFirst')})`
          : t('design.preview'),
        disabled: !preview.data?.url || unsaved || dirty,
        onClick: () =>
          preview.data?.url && window.open(preview.data.url, '_blank', 'noopener,noreferrer'),
      }}
    >
      <div className="flex flex-col gap-6">
        {fields.map((f) =>
          f.kind === 'images' ? (
            <PhotosField
              key={f.key}
              label={t(`editor.fields.${f.key}`)}
              slot={f.slot ?? SiteMediaSlot.HERO}
              ids={Array.isArray(data[f.key]) ? (data[f.key] as string[]) : []}
              onChange={(ids) => setData((d) => ({ ...d, [f.key]: ids }))}
            />
          ) : (
            <div key={f.key} className="flex flex-col gap-2">
              <BilingualField
                label={t(`editor.fields.${f.key}`)}
                value={textOf(data, f.key)}
                multiline={f.kind === 'richtext'}
                enHint={t('editor.enHint')}
                onChange={(v) => setData((d) => ({ ...d, [f.key]: v }))}
              />
              {f.defaults && (
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  onClick={() =>
                    setData((d) => ({
                      ...d,
                      [f.key]: { bn: f.defaults?.bn ?? '', en: f.defaults?.en ?? '' },
                    }))
                  }
                >
                  {t('editor.resetDefault')}
                </Button>
              )}
            </div>
          ),
        )}

        <fieldset className="flex flex-col gap-4">
          <legend className="text-h2">{t('editor.typography.title')}</legend>
          {(['bn', 'en'] as const).map((lang) => (
            <div key={lang} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t(`editor.language.${lang}`)}</h3>
              {(['heading', 'body'] as const).map((role) => (
                <div key={role} className="grid gap-3 sm:grid-cols-4">
                  <span className="self-end text-sm">{t(`editor.typography.${role}`)}</span>
                  {(['size', 'weight', 'align'] as const).map((prop) => {
                    const id = `style-${lang}-${role}-${prop}`;
                    const label = t(`editor.typography.${prop}`);
                    return (
                      <div key={prop} className="flex flex-col gap-1">
                        <Label htmlFor={id} className="sr-only">
                          {`${t(`editor.language.${lang}`)} ${t(`editor.typography.${role}`)} ${label}`}
                        </Label>
                        <Select
                          value={typography[lang]?.[role]?.[prop] ?? DEFAULT}
                          onValueChange={(v) => setStyle(lang, role, prop, v)}
                        >
                          <SelectTrigger id={id}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={DEFAULT}>{label}</SelectItem>
                            {choices[prop].map(([v, text]) => (
                              <SelectItem key={v} value={v}>
                                {text}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </fieldset>
      </div>
    </FullPageShell>
  );
}

/**
 * The admin media list carries no picture URL, so a stored photo is a numbered row with Remove;
 * a new one is cropped and uploaded, and its id joins the list.
 */
function PhotosField({
  label,
  slot,
  ids,
  onChange,
}: {
  label: string;
  slot: SiteMediaSlot;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation('website');
  const upload = useUploadSiteMedia(slot);
  const full = ids.length >= SITE_HERO_MAX_PHOTOS;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{label}</h3>
      {ids.length > 0 && (
        <ul className="flex flex-col gap-2">
          {ids.map((id, i) => (
            <li key={id} className="flex items-center justify-between gap-2 text-sm">
              {t('editor.photo', { position: i + 1 })}
              <Button
                type="button"
                variant="ghost"
                aria-label={t('editor.removePhoto', { position: i + 1 })}
                onClick={() => onChange(ids.filter((x) => x !== id))}
              >
                {t('editor.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-caption text-text-secondary">{t('editor.photoLimit')}</p>
      ) : (
        <ImageSlotUpload
          slot={slot}
          value={null}
          onUpload={async (blob) => {
            try {
              const { id } = await upload.mutateAsync(blob);
              onChange([...ids, id]);
            } catch {
              toast.error(t('editor.saveError'));
            }
          }}
          labels={uploadLabels(t)}
        />
      )}
    </div>
  );
}
