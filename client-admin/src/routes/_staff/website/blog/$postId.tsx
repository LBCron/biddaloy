/**
 * [40.3.07] Website › Blog post editor (`postId === 'new'` writes a new post). Bangla title is
 * required, English is optional (D8). One rich-text body, a cover photo, and Save / Publish /
 * Unpublish / Delete. The body is Slate JSON that the server re-checks and renders itself; this
 * screen never writes HTML.
 */
import { SiteMediaSlot } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  BilingualField,
  Button,
  ConfirmDialog,
  ErrorState,
  ImageSlotUpload,
  Skeleton,
  toast,
  type BilingualValue,
} from '@biddaloy/ui/components';
import {
  useCreatePost,
  useDeletePost,
  usePost,
  usePreviewToken,
  usePublishPost,
  websiteContentKeys,
  useUpdatePost,
  useUploadSiteMedia,
  type SitePost,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { RichTextValue } from '@biddaloy/ui/rich-text-editor';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../../route-loaders';

// Slate is heavy: its own chunk, loaded only when an editor opens.
const RichTextEditor = React.lazy(() =>
  import('@biddaloy/ui/rich-text-editor').then((m) => ({ default: m.RichTextEditor })),
);

/** A failed chunk load (offline, new deploy) would otherwise blank the whole page. */
class EditorBoundary extends React.Component<
  { message: string; retryLabel: string; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrorState
        message={this.props.message}
        retryLabel={this.props.retryLabel}
        onRetry={() => this.setState({ failed: false })}
      />
    );
  }
}

const EMPTY_BODY: RichTextValue = [{ type: 'paragraph', children: [{ text: '' }] }];

export const Route = createFileRoute('/_staff/website/blog/$postId')({
  loader: () => loadRouteNamespaces('website', 'nav', 'common'),
  component: PostPage,
});

function PostPage() {
  const { t } = useTranslation('website');
  const { postId } = Route.useParams();
  const isNew = postId === 'new';
  const query = usePost(isNew ? undefined : postId);

  // One stable key: creating a post navigates new -> its id, and the editor must keep its state.
  if (isNew) return <PostEditor key="editor" post={null} />;
  if (query.isError) {
    return (
      <ErrorState
        message={t('blog.loadPostError')}
        retryLabel={t('blog.edit')}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) return <Skeleton className="h-64 w-full" />;
  return <PostEditor key="editor" post={query.data} />;
}

function PostEditor({ post: initial }: { post: SitePost | null }) {
  const { t } = useTranslation('website');
  const navigate = useNavigate();
  const qc = useQueryClient();
  // The post once it exists on the server: set right after create, so a later click updates it.
  const [post, setPost] = React.useState<SitePost | null>(initial);
  const close = useCloseFullPage(() => void navigate({ to: '/website/blog' }));

  const [title, setTitle] = React.useState<BilingualValue>({
    bn: post?.title.bn ?? '',
    en: post?.title.en ?? '',
  });
  const [body, setBody] = React.useState<RichTextValue>(
    post && post.body.length > 0 ? (post.body as RichTextValue) : EMPTY_BODY,
  );
  const [coverId, setCoverId] = React.useState<string | null>(post?.cover_media_id ?? null);
  const [coverPreview, setCoverPreview] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(() => JSON.stringify([title, body, coverId]));
  const [deleting, setDeleting] = React.useState(false);
  const [gone, setGone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const create = useCreatePost();
  const update = useUpdatePost();
  const publish = usePublishPost();
  const remove = useDeletePost();
  const uploadCover = useUploadSiteMedia(SiteMediaSlot.POST_COVER);
  const uploadImage = useUploadSiteMedia(SiteMediaSlot.POST_IMAGE);
  const preview = usePreviewToken({ enabled: true });

  // The live link is the origin of the preview link (same trick as the Overview page). The
  // media list has no url, so a body photo and the public address are built from that origin.
  const origin = preview.data?.url ? new URL(preview.data.url).origin : null;
  const imageUrl = (mediaId: string) => (origin ? `${origin}/media/${mediaId}` : undefined);

  const dirty = !gone && JSON.stringify([title, body, coverId]) !== saved;
  const busy = create.isPending || update.isPending || publish.isPending || remove.isPending;
  const canSave = title.bn.trim() !== '' && !busy;
  const isPublished = !!post?.published_at;

  const fail = (error: unknown) => {
    const status = error instanceof ApiError ? error.statusCode : 0;
    const code = error instanceof ApiError ? error.messages[0] : undefined;
    setError(
      code === 'site.post_slug_taken'
        ? t('blog.slugTaken')
        : code === 'site.post_in_use'
          ? t('blog.inUse')
          : status === 400
            ? t('blog.invalid')
            : t('blog.error'),
    );
  };

  /** Saves the draft text; a new post is created first and its page opened in place. */
  async function save(): Promise<SitePost | null> {
    setError(null);
    const input = {
      title: { bn: title.bn.trim(), en: title.en.trim() },
      body,
      cover_media_id: coverId,
    };
    try {
      const next = post
        ? await update.mutateAsync({ id: post.id, ...input })
        : await create.mutateAsync({ ...input, kind: 'POST' });
      setSaved(JSON.stringify([title, body, coverId]));
      if (!post) {
        // Created: remember it and open its page NOW, so a failed publish never creates a second post.
        setPost(next);
        qc.setQueryData(websiteContentKeys.post(next.id), next);
        void navigate({ to: '/website/blog/$postId', params: { postId: next.id }, replace: true });
      }
      return next;
    } catch (error) {
      fail(error);
      return null;
    }
  }

  async function onSave() {
    const next = await save();
    if (!next) return;
    toast.success(t('blog.savedToast'));
  }

  async function onPublish(on: boolean) {
    const next = await save();
    if (!next) return;
    try {
      const next2 = await publish.mutateAsync({ id: next.id, publish: on });
      setPost(next2);
      toast.success(on ? t('blog.publishedToast') : t('blog.unpublishedToast'));
    } catch (error) {
      fail(error);
    }
  }

  async function onDelete() {
    if (!post) return;
    try {
      await remove.mutateAsync(post.id);
      setGone(true);
      toast.success(t('blog.deletedToast'));
      close();
    } catch (error) {
      setDeleting(false);
      fail(error);
    }
  }

  return (
    <FullPageShell
      title={post ? t('blog.edit') : t('blog.newTitle')}
      onClose={close}
      dirty={dirty}
      size="wide"
    >
      <div className="flex flex-col gap-6">
        <BilingualField label={t('blog.postTitle')} value={title} onChange={setTitle} required />

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('blog.slugLabel')}</span>
          {post && origin ? (
            <span dir="ltr" className="text-caption text-text-secondary">
              {`${origin}/bn/blog/${post.slug}`}
            </span>
          ) : (
            <span className="text-caption text-text-secondary">{t('blog.slugNew')}</span>
          )}
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('blog.cover')}</h3>
          <ImageSlotUpload
            slot={SiteMediaSlot.POST_COVER}
            value={coverPreview ?? (coverId ? (imageUrl(coverId) ?? null) : null)}
            onUpload={async (blob) => {
              try {
                const media = await uploadCover.mutateAsync(blob);
                setCoverId(media.id);
                setCoverPreview(URL.createObjectURL(blob));
              } catch {
                toast.error(t('blog.error'));
              }
            }}
            labels={{
              choose: t('wizard.logo.choose'),
              zoom: t('wizard.logo.zoom'),
              save: t('wizard.logo.save'),
              svgRefused: t('wizard.logo.svgRefused'),
              tooLarge: t('wizard.logo.tooLarge'),
              unreadable: t('wizard.logo.unreadable'),
              pan: t('wizard.logo.pan'),
            }}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('blog.postBody')}</h3>
          <EditorBoundary message={t('blog.editorLoadError')} retryLabel={t('blog.retry')}>
            <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <RichTextEditor
                value={body}
                onChange={setBody}
                lang="bn"
                imageUrl={imageUrl}
                onUploadImage={async (blob) => ({
                  mediaId: (await uploadImage.mutateAsync(blob)).id,
                })}
                labels={{
                  editor: t('blog.editor.editor'),
                  toolbar: t('blog.editor.toolbar'),
                  bold: t('blog.editor.bold'),
                  italic: t('blog.editor.italic'),
                  paragraph: t('blog.editor.paragraph'),
                  heading2: t('blog.editor.heading2'),
                  heading3: t('blog.editor.heading3'),
                  bulleted: t('blog.editor.bulleted'),
                  numbered: t('blog.editor.numbered'),
                  quote: t('blog.editor.quote'),
                  table: t('blog.editor.table'),
                  addRow: t('blog.editor.addRow'),
                  addColumn: t('blog.editor.addColumn'),
                  deleteTable: t('blog.editor.deleteTable'),
                  image: t('blog.editor.image'),
                  imageAlt: t('blog.editor.imageAlt'),
                  link: t('blog.editor.link'),
                  linkUrl: t('blog.editor.linkUrl'),
                  linkApply: t('blog.editor.linkApply'),
                  linkRemove: t('blog.editor.linkRemove'),
                  linkInvalid: t('blog.editor.linkInvalid'),
                  imageUpload: {
                    choose: t('wizard.logo.choose'),
                    zoom: t('wizard.logo.zoom'),
                    save: t('wizard.logo.save'),
                    svgRefused: t('wizard.logo.svgRefused'),
                    tooLarge: t('wizard.logo.tooLarge'),
                    unreadable: t('wizard.logo.unreadable'),
                    pan: t('wizard.logo.pan'),
                  },
                }}
              />
            </React.Suspense>
          </EditorBoundary>
        </section>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {title.bn.trim() === '' && (
          <p className="text-caption text-text-secondary">{t('blog.publishNeeds')}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={!canSave} onClick={() => void onSave()}>
            {t('blog.save')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void onPublish(!isPublished)}>
            {isPublished ? t('blog.unpublish') : t('blog.publish')}
          </Button>
          {post && (
            <Button
              type="button"
              variant="outline"
              className="ms-auto"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              {t('blog.delete')}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('blog.deleteTitle')}
        description={t('blog.deleteBody')}
        confirmLabel={t('blog.delete')}
        busy={remove.isPending}
        onConfirm={() => void onDelete()}
      />
    </FullPageShell>
  );
}
