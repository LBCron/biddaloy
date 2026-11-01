/**
 * [53.3.03] One notice for its reader: title, date, "edited", body (pre-line), files, and — for an
 * important notice not yet acknowledged — the filled "পড়েছি" button. Opening it is the "seen"
 * write (D22), done by `useMyNotice`. `MyNoticeDetailView` is presentational (tests, stories).
 */
import { Button } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  fetchNoticeFileBlob,
  useAcknowledgeNotice,
  useMyNotice,
  type MyNoticeDetail,
  type MyNoticeFile,
} from './use-my-notices';

function NoticeFileItem({ noticeId, file }: { noticeId: string; file: MyNoticeFile }) {
  const { t } = useTranslation('portalNotices');
  const isImage = file.mime_type.startsWith('image/');
  // The blob is fetched through apiClient (bearer token), then shown from an object URL.
  const blob = useQuery({
    queryKey: ['notices', 'mine', 'file', noticeId, file.id],
    queryFn: () => fetchNoticeFileBlob(noticeId, file.id),
    enabled: isImage,
    staleTime: Infinity,
  });
  const imageUrl = useMemo(
    () => (blob.data ? URL.createObjectURL(blob.data) : undefined),
    [blob.data],
  );

  if (isImage) {
    return imageUrl ? (
      <img src={imageUrl} alt={file.original_name} className="max-h-96 rounded-md border" />
    ) : (
      <span className="text-caption text-text-secondary">{file.original_name}</span>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-11 justify-start"
      onClick={() =>
        void fetchNoticeFileBlob(noticeId, file.id).then((b) =>
          window.open(URL.createObjectURL(b), '_blank', 'noopener'),
        )
      }
    >
      {t('detail.openFile', { name: file.original_name })}
    </Button>
  );
}

export interface MyNoticeDetailViewProps {
  notice: MyNoticeDetail;
  onAcknowledge: () => void;
  acknowledging?: boolean;
}

export function MyNoticeDetailView({
  notice,
  onAcknowledge,
  acknowledging = false,
}: MyNoticeDetailViewProps) {
  const { t } = useTranslation('portalNotices');
  const config = useRegionConfig();
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-h2">{notice.title}</h2>
        <p className="text-caption text-text-secondary">
          {formatDate(notice.published_at, config)}
          {notice.edited ? ` · ${t('badge.edited')}` : ''}
        </p>
        {notice.forStudents.length > 0 ? (
          <p className="text-caption text-text-secondary">
            {t('forStudents', { names: notice.forStudents.join('; ') })}
          </p>
        ) : null}
      </header>
      <p className="whitespace-pre-line">{notice.body}</p>
      {notice.files.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {notice.files.map((file) => (
            <li key={file.id}>
              <NoticeFileItem noticeId={notice.id} file={file} />
            </li>
          ))}
        </ul>
      ) : null}
      {notice.important && !notice.acknowledged ? (
        <Button
          type="button"
          className="min-h-11 self-start"
          disabled={acknowledging}
          onClick={onAcknowledge}
        >
          {t('detail.acknowledge')}
        </Button>
      ) : null}
    </article>
  );
}

export function MyNoticeDetail({ id }: { id: string }) {
  const { t } = useTranslation('portalNotices');
  const query = useMyNotice(id);
  const acknowledge = useAcknowledgeNotice();
  if (query.isPending) return <p role="status">{t('detail.loading')}</p>;
  if (query.isError || !query.data) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p>{t('error.message')}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          {t('error.retry')}
        </Button>
      </div>
    );
  }
  return (
    <MyNoticeDetailView
      notice={query.data}
      acknowledging={acknowledge.isPending}
      onAcknowledge={() => acknowledge.mutate(id)}
    />
  );
}
