/**
 * [40.3.05] Edit one section: every text in Bangla and English, its photos, and the text style
 * per language. The fields come from the chosen design's manifest, so each design asks only for
 * what it shows. "Save" puts the edits into the page's draft; the Pages tab saves the draft.
 *
 * A `richtext` field is plain text on the site today (it shows with line breaks), so it is a
 * multi-line bilingual field here, not the Slate editor.
 */
import {
  SITE_GALLERY_CAROUSEL_MAX,
  SITE_HERO_MAX_PHOTOS,
  SITE_VIDEO_START_MAX_SECONDS,
  SiteMediaSlot,
  SiteSectionKey as SectionKey,
  parseYoutubeStartSeconds,
  parseYoutubeVideoId,
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
  Input,
  Label,
  RadioRows,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import {
  useGalleryAlbums,
  usePreviewToken,
  useUploadSiteMedia,
  type WebsiteTheme,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { Link } from '@tanstack/react-router';
import { PlayIcon } from 'lucide-react';
import * as React from 'react';

import { uploadLabels, useDraft } from './-draft-editor';

type Text = { bn?: string; en?: string };
interface ManifestField {
  key: string;
  /** The others (`uuid`, `bool`, `choice`, `youtubeId`, `seconds`) have their own forms below. */
  kind: 'text' | 'richtext' | 'images' | 'uuid' | 'bool' | 'choice' | 'youtubeId' | 'seconds';
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

/** Gallery and video fields have their own forms (`GalleryFields`, `VideoFields`). */
const GALLERY_VIDEO_KINDS: ManifestField['kind'][] = [
  'uuid',
  'bool',
  'choice',
  'youtubeId',
  'seconds',
];
const FIRST_ALBUM = '__first';

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
  // A pasted video code that is not YouTube blocks Save until it is fixed or cleared.
  const [videoInvalid, setVideoInvalid] = React.useState(false);
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
      primary={{ label: t('editor.save'), onClick: apply, disabled: videoInvalid }}
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
          GALLERY_VIDEO_KINDS.includes(f.kind) ? null : f.kind === 'images' ? (
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

        {sectionKey === SectionKey.GALLERY && <GalleryFields data={data} setData={setData} />}
        {sectionKey === SectionKey.VIDEO && (
          <VideoFields data={data} setData={setData} onInvalid={setVideoInvalid} />
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

type SetData = React.Dispatch<React.SetStateAction<Record<string, unknown>>>;

/** [40.6.06] Which gallery section the home page shows, and whether a page of all photos is linked. */
function GalleryFields({ data, setData }: { data: Record<string, unknown>; setData: SetData }) {
  const { t, i18n } = useTranslation('website');
  const albums = useGalleryAlbums();
  const lang = i18n.language.startsWith('bn') ? 'bn' : 'en';
  const list = [...(albums.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const albumId = typeof data.albumId === 'string' ? data.albumId : null;
  const selectId = React.useId();
  return (
    <div className="flex flex-col gap-4">
      {albums.isSuccess && list.length === 0 ? (
        <p className="text-sm">
          <Link to="/website/gallery" className="link">
            {t('editor.gallery.makeSectionFirst')}
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <Label htmlFor={selectId}>{t('editor.gallery.chooseSection')}</Label>
          <Select
            value={albumId ?? FIRST_ALBUM}
            onValueChange={(v) => setData((d) => ({ ...d, albumId: v === FIRST_ALBUM ? null : v }))}
          >
            <SelectTrigger id={selectId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FIRST_ALBUM}>{t('editor.gallery.firstWithPhotos')}</SelectItem>
              {list.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.title[lang] || a.title.bn || a.title.en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-caption text-text-secondary">
            {t('editor.gallery.carouselNote', { max: SITE_GALLERY_CAROUSEL_MAX })}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Switch
            checked={data.showPageLink === true}
            onCheckedChange={(on) => setData((d) => ({ ...d, showPageLink: on }))}
          />
          {t('editor.gallery.showPageLink')}
        </label>
        <p className="text-caption text-text-secondary">{t('editor.gallery.helpPageLink')}</p>
      </div>
    </div>
  );
}

const startOk = (n: number | null) =>
  n === null || (Number.isInteger(n) && n >= 0 && n <= SITE_VIDEO_START_MAX_SECONDS);

/**
 * [40.6.06] A YouTube video: the admin pastes a link or the embed code, and only the parsed
 * 11-character id and start time go into the draft, never the pasted text (D55, D56).
 */
function VideoFields({
  data,
  setData,
  onInvalid,
}: {
  data: Record<string, unknown>;
  setData: SetData;
  onInvalid: (invalid: boolean) => void;
}) {
  const { t } = useTranslation('website');
  const [paste, setPaste] = React.useState('');
  const [start, setStart] = React.useState(
    typeof data.startSeconds === 'number' ? String(data.startSeconds) : '',
  );
  const videoId = typeof data.videoId === 'string' ? data.videoId : null;
  const pasteBad = paste.trim() !== '' && parseYoutubeVideoId(paste) === null;
  const startBad = !startOk(start.trim() === '' ? null : Number(start));
  const position = data.headingPosition === 'below' ? 'below' : 'above';

  React.useEffect(() => onInvalid(pasteBad || startBad), [pasteBad, startBad, onInvalid]);

  function onPaste(value: string) {
    setPaste(value);
    const id = value.trim() ? parseYoutubeVideoId(value) : null;
    if (!id) return;
    // A link may carry its own start time; it fills the box unless the admin already typed one.
    const fromLink = start.trim() === '' ? parseYoutubeStartSeconds(value) : null;
    setData((d) => ({
      ...d,
      videoId: id,
      ...(fromLink !== null ? { startSeconds: fromLink } : {}),
    }));
    if (fromLink !== null) setStart(String(fromLink));
  }

  const id = React.useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-paste`}>{t('editor.video.embedCode')}</Label>
        <Textarea
          id={`${id}-paste`}
          rows={4}
          dir="ltr"
          value={paste}
          aria-invalid={pasteBad || undefined}
          aria-describedby={`${id}-help ${id}-state`}
          onChange={(e) => onPaste(e.target.value)}
        />
        <p id={`${id}-help`} className="text-caption text-text-secondary">
          {t('editor.video.embedHelp')}
        </p>
        <p
          id={`${id}-state`}
          role={pasteBad ? 'alert' : 'status'}
          className={pasteBad ? 'text-sm text-destructive' : 'text-sm text-text-secondary'}
        >
          {pasteBad
            ? t('editor.video.notYoutube')
            : videoId
              ? t('editor.video.found')
              : t('editor.video.noVideoFound')}
        </p>
      </div>

      {videoId && !pasteBad && (
        <div className="flex flex-col gap-2">
          <div
            role="img"
            aria-label={t('editor.video.previewTitle')}
            className="flex aspect-video w-full max-w-sm flex-col items-center justify-center gap-1 rounded-lg border border-border-subtle bg-muted"
          >
            <PlayIcon aria-hidden className="size-8 text-text-secondary" />
            <span dir="ltr" className="text-caption text-text-secondary">
              {videoId}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => {
              setPaste('');
              setStart('');
              setData((d) => ({ ...d, videoId: null, startSeconds: null }));
            }}
          >
            {t('editor.video.remove')}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-start`}>{t('editor.video.startAt')}</Label>
        <Input
          id={`${id}-start`}
          inputMode="numeric"
          dir="ltr"
          className="max-w-40"
          value={start}
          aria-invalid={startBad || undefined}
          onChange={(e) => {
            setStart(e.target.value);
            const n = e.target.value.trim() === '' ? null : Number(e.target.value);
            if (startOk(n)) setData((d) => ({ ...d, startSeconds: n }));
          }}
        />
        {startBad && (
          <p role="alert" className="text-sm text-destructive">
            {t('editor.video.startInvalid')}
          </p>
        )}
      </div>

      <RadioRows
        legend={t('editor.video.headingPosition')}
        value={position}
        onValueChange={(v) => setData((d) => ({ ...d, headingPosition: v }))}
        options={[
          { value: 'above', title: t('editor.video.above') },
          { value: 'below', title: t('editor.video.below') },
        ]}
      />
      <p className="text-caption text-text-secondary">
        {t('editor.video.privacy')} {t('help.videoOnly')}
      </p>
    </div>
  );
}
