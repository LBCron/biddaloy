/**
 * [40.6.06] One gallery section on the Gallery tab: its name, the photo uploader, and the photo
 * grid (caption, move up and down, delete with an inline confirm). Albums and photos are server
 * state, so every change saves on its own; nothing here touches the website draft.
 *
 * Every failure shows one fixed sentence per server code and never echoes what was sent.
 */
import {
  SITE_GALLERY_CAPTION_MAX_CHARS,
  SITE_GALLERY_MAX_PHOTOS_PER_ALBUM,
} from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  BilingualField,
  Button,
  Card,
  GalleryPhotoUploader,
  ReorderButtons,
  toast,
} from '@biddaloy/ui/components';
import {
  useCaptionGalleryPhoto,
  useDeleteGalleryPhoto,
  useRenameGalleryAlbum,
  useReorderGalleryPhotos,
  useUploadGalleryPhoto,
  type GalleryAlbum,
  type GalleryPhoto,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Trash2Icon } from 'lucide-react';
import * as React from 'react';

type Text = { bn: string; en: string };
const same = (a: Text, b: Text) => a.bn === b.bn && a.en === b.en;
const clip = (v: Text): Text => ({
  bn: v.bn.slice(0, SITE_GALLERY_CAPTION_MAX_CHARS),
  en: v.en.slice(0, SITE_GALLERY_CAPTION_MAX_CHARS),
});

const ERROR_KEYS: Record<string, string> = {
  'site.gallery_invalid': 'invalid',
  'site.gallery_limit': 'limit',
  'site.gallery_not_found': 'notFound',
  'site.media_rejected': 'rejected',
  'site.media_in_use': 'inUse',
};

/** The i18n key (under `gallery.errors`) for a failed gallery call. Never the server text. */
export function galleryErrorKey(error: unknown): string {
  return (error instanceof ApiError && ERROR_KEYS[error.message]) || 'failed';
}

export interface GallerySectionCardProps {
  album: GalleryAlbum;
  /** Position among the sections, 0-based. */
  index: number;
  count: number;
  /** Where a stored photo shows (the site's media origin), or null while it is not known. */
  imageUrl: (mediaId: string) => string | undefined;
  usedBytes: number;
  quotaBytes: number;
  onMove: (from: number, to: number) => void;
  onDelete: () => void;
}

export function GallerySectionCard({
  album,
  index,
  count,
  imageUrl,
  usedBytes,
  quotaBytes,
  onMove,
  onDelete,
}: GallerySectionCardProps) {
  const { t, i18n } = useTranslation('website');
  const lang = i18n.language.startsWith('bn') ? 'bn' : 'en';
  const [title, setTitle] = React.useState<Text>(album.title);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const rename = useRenameGalleryAlbum();
  const upload = useUploadGalleryPhoto(album.id);
  const reorder = useReorderGalleryPhotos(album.id);
  const caption = useCaptionGalleryPhoto();
  const removePhoto = useDeleteGalleryPhoto();

  // A saved rename (or a refetch) is the new baseline for the field.
  React.useEffect(() => setTitle(album.title), [album.title.bn, album.title.en]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (error: unknown) => toast.error(t(`gallery.errors.${galleryErrorKey(error)}`));
  const photos = [...album.photos].sort((a, b) => a.sortOrder - b.sortOrder);
  const name = (album.title[lang] || album.title.bn || album.title.en).trim();
  const titleDirty = !same(title, album.title);
  const titleEmpty = !title.bn.trim() && !title.en.trim();

  const movePhoto = (from: number, to: number) => {
    const ids = photos.map((p) => p.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    reorder.mutate(ids, { onError: fail });
  };

  const saveCaption = (photo: GalleryPhoto, next: Text) => {
    const text = clip(next);
    if (same(text, photo.caption)) return;
    caption.mutate(
      { id: photo.id, caption: !text.bn && !text.en ? null : text },
      { onError: fail },
    );
  };

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-h2" dir="auto">
          {name || t('gallery.sectionHeading', { position: index + 1 })}
        </h2>
        <span className="text-caption text-text-secondary">
          {t('gallery.photoCount', { count: photos.length })}
        </span>
        <ReorderButtons
          index={index}
          count={count}
          onMove={onMove}
          upLabel={t('gallery.moveSectionUp', { name, position: index + 1 })}
          downLabel={t('gallery.moveSectionDown', { name, position: index + 1 })}
        />
        <Button
          type="button"
          variant="ghost"
          iconOnly
          className="size-11 text-destructive md:size-8"
          aria-label={t('gallery.deleteSection')}
          onClick={onDelete}
        >
          <Trash2Icon aria-hidden />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <BilingualField
          label={t('gallery.sectionTitle')}
          value={title}
          required
          enHint={t('editor.enHint')}
          onChange={setTitle}
        />
        {titleDirty && (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={titleEmpty || rename.isPending}
            onClick={() => rename.mutate({ id: album.id, title }, { onError: fail })}
          >
            {t('gallery.renameSection')}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-caption text-text-secondary">{t('help.galleryConsent')}</p>
        <p className="text-caption text-text-secondary">
          {t('help.galleryCrop')} {t('help.galleryStorage')}
        </p>
        <GalleryPhotoUploader
          remaining={Math.max(0, SITE_GALLERY_MAX_PHOTOS_PER_ALBUM - photos.length)}
          onUpload={async (file) => {
            await upload.mutateAsync(file);
          }}
          errorText={(error) => t(`gallery.errors.${galleryErrorKey(error)}`)}
          // The server answers a full storage with the same sentence as a bad file.
          isStorageFull={(error, file) =>
            galleryErrorKey(error) === 'rejected' && usedBytes + file.size > quotaBytes
          }
          labels={{
            choose: t('gallery.addPhotos'),
            hint: t('gallery.dropHint'),
            pickerLabel: t('gallery.pickerLabel'),
            waiting: t('gallery.waiting'),
            uploading: t('gallery.uploading'),
            done: t('gallery.done'),
            failed: t('gallery.failed'),
            notPhoto: t('gallery.notPhoto'),
            notAdded: t('gallery.notAdded'),
            storageFull: t('gallery.storageFullWaiting'),
            retry: t('gallery.retryFile'),
            summary: (done, total) => t('gallery.summary', { done, total }),
          }}
        />
      </div>

      {photos.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo, i) => {
            const src = imageUrl(photo.mediaId);
            const position = i + 1;
            return (
              <li
                key={photo.id}
                className="flex flex-col gap-2 rounded-lg border border-border-subtle p-2"
              >
                <div className="aspect-[3/2] w-full overflow-hidden rounded-md bg-muted">
                  {src && (
                    <img
                      src={src}
                      alt={photo.caption[lang] || t('gallery.photoLabel', { position })}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  )}
                </div>
                <PhotoCaption
                  key={`${photo.id}-${photo.caption.bn}-${photo.caption.en}`}
                  photo={photo}
                  label={t('gallery.captionFor', { position })}
                  hint={t('editor.enHint')}
                  onSave={(next) => saveCaption(photo, next)}
                />
                <div className="flex items-center justify-between gap-2">
                  <ReorderButtons
                    index={i}
                    count={photos.length}
                    onMove={movePhoto}
                    upLabel={t('gallery.moveUp', { position })}
                    downLabel={t('gallery.moveDown', { position })}
                  />
                  {confirming === photo.id ? (
                    <div
                      role="group"
                      aria-label={t('gallery.removePhotoConfirm')}
                      className="flex items-center gap-2"
                    >
                      <span className="text-caption">{t('gallery.removePhotoConfirm')}</span>
                      <Button
                        type="button"
                        variant="destructive"
                        className="min-h-11"
                        disabled={removePhoto.isPending}
                        onClick={() =>
                          removePhoto.mutate(photo.id, {
                            onError: fail,
                            onSettled: () => setConfirming(null),
                          })
                        }
                      >
                        {t('gallery.removePhotoYes')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        onClick={() => setConfirming(null)}
                      >
                        {t('gallery.removePhotoNo')}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      className="size-11 text-destructive md:size-8"
                      aria-label={t('gallery.removePhoto', { position })}
                      onClick={() => setConfirming(photo.id)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Caption in both languages; saves when focus leaves the pair, not on every key. */
function PhotoCaption({
  photo,
  label,
  hint,
  onSave,
}: {
  photo: GalleryPhoto;
  label: string;
  hint: string;
  onSave: (next: Text) => void;
}) {
  const [value, setValue] = React.useState<Text>(photo.caption);
  return (
    <div
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onSave(value);
      }}
    >
      <BilingualField
        label={label}
        value={value}
        enHint={hint}
        onChange={(v) => setValue(clip(v))}
      />
    </div>
  );
}
