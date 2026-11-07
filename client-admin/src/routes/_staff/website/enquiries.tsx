/**
 * [40.3.08] Website › Enquiries: what visitors wrote through the site's contact form. Tick a
 * message as seen, delete it, and decide whether each new one also sends an SMS to the office
 * phone. The switch lives on the contact section of the website draft (D22, D37), so it takes
 * effect when the website is published.
 */
import { SitePage, SiteSectionKey, type SiteConfig } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  ConfirmDialog,
  DataTable,
  RoutePending,
  Switch,
  toast,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import {
  ENQUIRY_PAGE_SIZE,
  setSectionData,
  useDeleteEnquiry,
  useEnquiries,
  useMarkEnquirySeen,
  usePreviewToken,
  useSaveDraft,
  useWebsiteConfig,
  type SiteEnquiry,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useListShellState } from '@biddaloy/ui/shells';
import { formatDateTime } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/website/enquiries')({
  loader: () => loadRouteNamespaces('website', 'nav'),
  pendingComponent: EnquiriesPending,
  component: Enquiries,
});

function EnquiriesPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label')} />;
}

const contactSection = (draft: SiteConfig | undefined) =>
  draft?.pages
    .find((p) => p.page === SitePage.CONTACT)
    ?.sections.find((s) => s.key === SiteSectionKey.CONTACT);

/** A long message shows two lines; the button opens the rest in place. */
function Message({ text }: { text: string }) {
  const { t } = useTranslation('website');
  const [open, setOpen] = React.useState(false);
  const long = text.length > 120;
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={open ? 'whitespace-pre-wrap' : 'line-clamp-2'}>{text}</span>
      {long && (
        <button
          type="button"
          className="link text-caption"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('enquiries.less') : t('enquiries.more')}
        </button>
      )}
    </div>
  );
}

function Enquiries() {
  const { t } = useTranslation('website');
  const region = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: ENQUIRY_PAGE_SIZE });
  const query = useEnquiries(state.page);
  const markSeen = useMarkEnquirySeen();
  const remove = useDeleteEnquiry();
  const [deleting, setDeleting] = React.useState<SiteEnquiry | null>(null);

  const site = useWebsiteConfig();
  const saveDraft = useSaveDraft();
  const preview = usePreviewToken({ enabled: true });
  const draft = site.data?.draft as unknown as SiteConfig | undefined;
  const contact = contactSection(draft);
  const smsOn = contact?.data.enquirySmsToOffice === true;
  const liveOrigin = preview.data?.url ? new URL(preview.data.url).origin : null;

  async function setSms(next: boolean) {
    if (!site.data || !draft || !contact) return;
    try {
      await saveDraft.mutateAsync({
        config: {
          ...setSectionData(draft, SitePage.CONTACT, SiteSectionKey.CONTACT, {
            ...contact.data,
            enquirySmsToOffice: next,
          }),
        },
        draft_revision: site.data.draft_revision,
      });
      toast.success(t('enquiries.smsSaved'));
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.statusCode === 409
          ? t('overview.stale')
          : t('enquiries.actionError'),
      );
    }
  }

  const columns: DataTableColumn<SiteEnquiry>[] = [
    {
      id: 'name',
      header: t('enquiries.name'),
      accessorFn: (e) => <span className={e.seen_at ? '' : 'font-semibold'}>{e.name}</span>,
      card: 'title',
    },
    {
      id: 'phone',
      header: t('enquiries.phone'),
      accessorFn: (e) => (
        <a
          href={`tel:${e.phone}`}
          dir="ltr"
          className="link"
          aria-label={t('enquiries.callLabel', { name: e.name })}
        >
          {e.phone}
        </a>
      ),
      card: 'subtitle',
    },
    {
      id: 'message',
      header: t('enquiries.message'),
      accessorFn: (e) => (
        <div className={e.seen_at ? '' : 'font-semibold'}>
          <Message text={e.message} />
        </div>
      ),
    },
    {
      id: 'date',
      header: t('enquiries.received'),
      accessorFn: (e) => formatDateTime(e.created_at, region),
    },
    {
      id: 'seen',
      header: t('enquiries.seen'),
      accessorFn: (e) => (
        <Switch
          checked={!!e.seen_at}
          // The API only ticks a message as seen; there is no untick.
          disabled={!!e.seen_at || markSeen.isPending}
          aria-label={t('enquiries.markSeenLabel', { name: e.name })}
          onCheckedChange={() =>
            markSeen.mutate(e.id, { onError: () => toast.error(t('enquiries.actionError')) })
          }
        />
      ),
      card: 'badge',
    },
  ];

  const rowActions = (e: SiteEnquiry): RowAction[] => [
    { intent: 'remove', label: t('enquiries.delete'), onClick: () => setDeleting(e) },
  ];

  return (
    <>
      <label className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Switch
          checked={smsOn}
          disabled={!contact || saveDraft.isPending}
          onCheckedChange={(next) => void setSms(next)}
        />
        <span>{t('enquiries.smsSwitch')}</span>
        <span className="text-caption text-text-secondary">
          {contact
            ? site.data?.has_unpublished_changes
              ? t('enquiries.smsNeedsPublish')
              : t('enquiries.smsHelp')
            : t('enquiries.smsOff')}
        </span>
      </label>

      <DataTable
        tableId="website-enquiries"
        caption={t('enquiries.tableCaption')}
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(e) => e.id}
        sorting={null}
        onSortingChange={() => undefined}
        page={state.page}
        pageSize={state.limit}
        totalCount={query.data?.total ?? 0}
        onPageChange={actions.setPage}
        loading={query.isLoading}
        isFetching={query.isFetching}
        rowActions={rowActions}
        {...(query.isError ? { error: t('enquiries.loadError') } : {})}
        emptyState={{
          title: t('enquiries.empty'),
          explanation: t('enquiries.emptyBody'),
          ...(liveOrigin
            ? {
                action: {
                  label: t('enquiries.emptyAction'),
                  onClick: () =>
                    void navigator.clipboard
                      .writeText(liveOrigin)
                      .then(() => toast.success(t('enquiries.copied')))
                      .catch(() => toast.error(t('overview.copyFailed'))),
                },
              }
            : {}),
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t('enquiries.deleteTitle')}
        description={t('enquiries.deleteBody')}
        confirmLabel={t('enquiries.delete')}
        busy={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => toast.success(t('enquiries.deleted')),
            onError: () => toast.error(t('enquiries.actionError')),
            onSettled: () => setDeleting(null),
          });
        }}
      />
    </>
  );
}
