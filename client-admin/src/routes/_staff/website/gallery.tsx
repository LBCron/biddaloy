/**
 * [40.6.06] Website › Gallery. Gallery sections and their photos: create, name, add many photos,
 * caption, reorder, delete. These are server state (each change saves at once), so this tab never
 * touches the shared website draft; the home-page gallery block is switched on in the Pages tab.
 */
import { SITE_GALLERY_MAX_ALBUMS } from '@biddaloy/shared';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  toast,
} from '@biddaloy/ui/components';
import {
  useCreateGalleryAlbum,
  useDeleteGalleryAlbum,
  useGalleryAlbums,
  usePreviewToken,
  useReorderGalleryAlbums,
  useWebsiteMedia,
  type GalleryAlbum,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { ImagesIcon } from 'lucide-react';
import * as React from 'react';

import { galleryErrorKey, GallerySectionCard } from './-gallery-section-card';

export const Route = createFileRoute('/_staff/website/gallery')({
  component: WebsiteGallery,
});

const MB = 1024 * 1024;

function WebsiteGallery() {
  const { t, i18n } = useTranslation('website');
  const albumsQuery = useGalleryAlbums();
  const media = useWebsiteMedia();
  const preview = usePreviewToken({ enabled: true });
  const create = useCreateGalleryAlbum();
  const reorder = useReorderGalleryAlbums();
  const remove = useDeleteGalleryAlbum();
  const [deleting, setDeleting] = React.useState<GalleryAlbum | null>(null);

  const fail = (error: unknown) => toast.error(t(`gallery.errors.${galleryErrorKey(error)}`));

  if (albumsQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (albumsQuery.isError) {
    return (
      <ErrorState
        message={t('gallery.loadError')}
        retryLabel={t('gallery.retry')}
        onRetry={() => void albumsQuery.refetch()}
      />
    );
  }

  const albums = [...albumsQuery.data].sort((a, b) => a.sortOrder - b.sortOrder);
  const full = albums.length >= SITE_GALLERY_MAX_ALBUMS;
  const usedBytes = media.data?.usedBytes ?? 0;
  const quotaBytes = media.data?.quotaBytes ?? 0;
  // The media list has no picture URL, so a stored photo is read from the site's own address:
  // the origin of the preview link (never the token), same trick as the blog editor.
  const origin = preview.data?.url ? new URL(preview.data.url).origin : null;
  const imageUrl = (mediaId: string) => (origin ? `${origin}/media/${mediaId}` : undefined);

  const addSection = () => {
    // The name starts as "Gallery section N" in the language being read; the admin renames it.
    const text = t('gallery.sectionHeading', { position: albums.length + 1 });
    const bn = i18n.language.startsWith('bn');
    create.mutate({ title: bn ? { bn: text, en: '' } : { bn: '', en: text } }, { onError: fail });
  };

  const move = (from: number, to: number) => {
    const ids = albums.map((a) => a.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    reorder.mutate(ids, { onError: fail });
  };

  const newButton = (
    <Button type="button" disabled={full || create.isPending} onClick={addSection}>
      {t('gallery.newSection')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-caption text-text-secondary">
          {t('overview.usageLabel')}:{' '}
          {t('overview.usage', {
            used: (usedBytes / MB).toFixed(1),
            total: Math.round(quotaBytes / MB),
          })}
        </p>
        {albums.length > 0 && (
          <div className="ms-auto flex flex-col items-end gap-1">
            {newButton}
            {full && (
              <p className="text-caption text-text-secondary">{t('gallery.limitReached')}</p>
            )}
          </div>
        )}
      </div>

      {albums.length === 0 ? (
        <EmptyState
          icon={<ImagesIcon aria-hidden="true" />}
          title={t('gallery.tab')}
          explanation={t('gallery.empty')}
          action={{ label: t('gallery.newSection'), onClick: addSection }}
        />
      ) : (
        albums.map((album, i) => (
          <GallerySectionCard
            key={album.id}
            album={album}
            index={i}
            count={albums.length}
            imageUrl={imageUrl}
            usedBytes={usedBytes}
            quotaBytes={quotaBytes}
            onMove={move}
            onDelete={() => setDeleting(album)}
          />
        ))
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('gallery.deleteSectionConfirm.title')}
        description={t('gallery.deleteSectionConfirm.body', {
          count: deleting?.photos.length ?? 0,
        })}
        confirmLabel={t('gallery.deleteSectionConfirm.confirm')}
        busy={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onError: fail,
            onSettled: () => setDeleting(null),
          });
        }}
      />
    </div>
  );
}
