/**
 * School website gallery hooks (Epic 40, W6). Albums and photos are server state, not part of
 * the shared draft config. Every type comes from the generated `schema.d.ts`.
 *
 * Every mutation is `retry: false` (Rule 25); create and upload carry an `Idempotency-Key`.
 * An upload or a delete changes the photo storage used, so both refresh the media list, which
 * is where the usage numbers come from.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { shouldRetryQuery } from './retry';
import { websiteKeys } from './use-website';

export type GalleryAlbum = components['schemas']['GalleryAlbumDto'];
export type GalleryPhoto = components['schemas']['GalleryPhotoDto'];
export type SaveGalleryAlbumInput = components['schemas']['SaveAlbumDto'];

export const websiteGalleryKeys = {
  albums: () => ['website', 'gallery', 'albums'] as const,
};

const BASE = '/website/gallery';

export function useGalleryAlbums() {
  return useQuery({
    queryKey: websiteGalleryKeys.albums(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<GalleryAlbum[]>(`${BASE}/albums`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  const albums = () => qc.invalidateQueries({ queryKey: websiteGalleryKeys.albums() });
  // The storage-used numbers ride on the media list.
  const withUsage = () =>
    Promise.all([albums(), qc.invalidateQueries({ queryKey: websiteKeys.media() })]);
  return { albums, withUsage };
}

export function useCreateGalleryAlbum() {
  const { albums } = useRefresh();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: SaveGalleryAlbumInput) =>
      (
        await apiClient.post<GalleryAlbum>(`${BASE}/albums`, input, {
          headers: { 'Idempotency-Key': keyFor(input) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      return albums();
    },
    retry: false,
  });
}

export function useRenameGalleryAlbum() {
  const { albums } = useRefresh();
  return useMutation({
    mutationFn: async ({ id, ...input }: SaveGalleryAlbumInput & { id: string }) =>
      (await apiClient.patch<GalleryAlbum>(`${BASE}/albums/${id}`, input)).data,
    onSuccess: albums,
    retry: false,
  });
}

/** Deleting an album takes its photos with it, so storage used changes. */
export function useDeleteGalleryAlbum() {
  const { withUsage } = useRefresh();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`${BASE}/albums/${id}`);
    },
    onSuccess: withUsage,
    retry: false,
  });
}

/** `ids` is the complete list in the new order. */
export function useReorderGalleryAlbums() {
  const { albums } = useRefresh();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      (await apiClient.put<GalleryAlbum[]>(`${BASE}/albums/order`, { ids })).data,
    onSuccess: albums,
    retry: false,
  });
}

/** `blob` is the cropped WebP from `GalleryPhotoUploader`, never the original file. */
export function useUploadGalleryPhoto(albumId: string) {
  const { withUsage } = useRefresh();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (blob: Blob) => {
      const form = new FormData();
      form.append('file', blob, `photo.${blob.type === 'image/jpeg' ? 'jpg' : 'webp'}`);
      return (
        await apiClient.post<GalleryPhoto>(`${BASE}/albums/${albumId}/photos`, form, {
          headers: { 'Idempotency-Key': keyFor({ albumId, size: blob.size, type: blob.type }) },
        })
      ).data;
    },
    onSuccess: () => {
      rotate();
      return withUsage();
    },
    retry: false,
  });
}

/** `ids` is the complete list of the album's photos in the new order. */
export function useReorderGalleryPhotos(albumId: string) {
  const { albums } = useRefresh();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      (await apiClient.put<GalleryAlbum>(`${BASE}/albums/${albumId}/photos/order`, { ids })).data,
    onSuccess: albums,
    retry: false,
  });
}

/** `caption: null` clears it. */
export function useCaptionGalleryPhoto() {
  const { albums } = useRefresh();
  return useMutation({
    mutationFn: async ({
      id,
      caption,
    }: {
      id: string;
      caption: components['schemas']['UpdateGalleryPhotoDto']['caption'];
    }) => (await apiClient.patch<GalleryPhoto>(`${BASE}/photos/${id}`, { caption })).data,
    onSuccess: albums,
    retry: false,
  });
}

export function useDeleteGalleryPhoto() {
  const { withUsage } = useRefresh();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`${BASE}/photos/${id}`);
    },
    onSuccess: withUsage,
    retry: false,
  });
}
