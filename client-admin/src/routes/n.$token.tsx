/**
 * [53.6.01] The public notice page: `/n/<token>`, no login, no session, no `apiClient` call (same
 * rules as `/i/$token`: `__root.tsx` lists `/n/` in `PUBLIC_PATH_PREFIXES`, and a phone opening
 * the link has no tenant). Text only: the body is shown as text, never as HTML.
 *
 * Every dead link (unknown, turned off, withdrawn, expired) gets one fixed message that never
 * repeats the token (rule 23). A dropped connection is different: that one can be retried.
 * Opening the page also tells the server the link was opened; a personal link marks its person
 * seen, a public link writes nothing.
 */
import { API_BASE_URL, type components } from '@biddaloy/ui/api';
import { AuthLayout, Button, Skeleton } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { FileQuestion, FileText, RotateCcw, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../route-loaders';

import { GuestStatus } from './-guest-status';

type PublicNotice = components['schemas']['PublicNoticeDto'];

export const Route = createFileRoute('/n/$token')({
  loader: () => loadRouteNamespaces('notices', 'common'),
  component: PublicNoticePage,
});

class DeadLink extends Error {}

async function fetchPublicNotice(token: string, signal: AbortSignal): Promise<PublicNotice> {
  const res = await fetch(`${API_BASE_URL}/public/notices/${encodeURIComponent(token)}`, {
    signal,
  });
  if (res.status === 404 || res.status === 410) throw new DeadLink();
  if (!res.ok) throw new Error('load failed');
  return (await res.json()) as PublicNotice;
}

function PublicNoticePage() {
  return (
    <AuthLayout>
      <NoticeBody />
    </AuthLayout>
  );
}

function NoticeBody() {
  const { t } = useTranslation('notices');
  const region = useRegionConfig();
  const { token } = Route.useParams();
  const query = useQuery({
    queryKey: ['public-notice', token] as const,
    queryFn: ({ signal }) => fetchPublicNotice(token, signal),
    // A dead link never comes back; a dropped connection is for the Try again button.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const loaded = query.isSuccess;

  // Best effort and silent: the reader must never see a failure here.
  const opened = useMutation({
    mutationFn: (tk: string) =>
      fetch(`${API_BASE_URL}/public/notices/${encodeURIComponent(tk)}/opened`, { method: 'POST' }),
    retry: false,
    onError: () => undefined,
  });
  const markOpened = opened.mutate;
  React.useEffect(() => {
    if (loaded) markOpened(token);
  }, [loaded, token, markOpened]);

  if (query.isPending) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t('public.loading')}
        className="flex flex-col gap-3"
      >
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.error instanceof DeadLink) {
    return (
      <GuestStatus
        icon={FileQuestion}
        tone="warning"
        title={t('public.notFoundTitle')}
        explanation={t('public.notFoundBody')}
      />
    );
  }
  if (query.isError) {
    return (
      <GuestStatus
        icon={TriangleAlert}
        tone="danger"
        title={t('public.errorTitle')}
        explanation={t('public.errorBody')}
      >
        <Button variant="outline" className="w-full" onClick={() => void query.refetch()}>
          <RotateCcw aria-hidden="true" />
          {t('public.retry')}
        </Button>
      </GuestStatus>
    );
  }

  const n = query.data;
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-caption text-text-secondary">
          {t('public.school', { school: n.schoolName })}
        </p>
        <h1 className="text-h1 text-balance">{n.title}</h1>
        <p className="text-caption text-text-secondary">
          {n.publishedAt && t('public.published', { date: formatDate(n.publishedAt, region) })}
          {n.editedAt && ` · ${t('public.edited', { date: formatDate(n.editedAt, region) })}`}
        </p>
      </header>
      <p className="whitespace-pre-line">{n.body}</p>
      {n.files.length > 0 && (
        <section aria-labelledby="public-notice-files" className="flex flex-col gap-2">
          <h2 id="public-notice-files" className="text-h3">
            {t('public.files')}
          </h2>
          <ul className="flex flex-col gap-2">
            {n.files.map((f) => (
              <li key={f.id}>
                <a
                  className="inline-flex items-center gap-2 text-primary underline"
                  href={`${API_BASE_URL}/public/notices/${encodeURIComponent(token)}/files/${f.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText aria-hidden="true" className="size-4" />
                  {t('public.openFile', { name: f.name })}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
