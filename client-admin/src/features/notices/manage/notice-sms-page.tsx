/**
 * [53.6.01] Full page for approving the SMS copy of a notice (D24, D25): who gets it, the text,
 * the credit cost, then Approve or Decline. Tick or untick people while the request is waiting.
 * Opens on the detail route with `?sms=1`. Nothing is sent without the Approve click.
 */
import { ApiError, apiClient, type components } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { renderDigits } from '@biddaloy/ui/utils';
import {
  keepPreviousData,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import * as React from 'react';

import { noticeKeys } from './use-notices';

type SmsView = components['schemas']['NoticeSmsViewDto'];
type SmsPerson = SmsView['items'][number];
type SmsDecision = components['schemas']['SmsDecisionDto'];

const PAGE_SIZE = 25;
const smsKey = (id: string, page: number) => ['notices', 'sms', id, page] as const;
/** Every SMS write on one notice (tick, approve, decline) sits under this key. */
const writeKey = (id: string) => ['notices', 'sms', id, 'write'] as const;
const tickKey = (id: string) => [...writeKey(id), 'tick'] as const;

/** One recipient's tick box; held while a tick, approve or decline on this notice is on its way. */
function SendBox(props: {
  noticeId: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (smsWanted: boolean) => void;
}) {
  const busy = useIsMutating({ mutationKey: writeKey(props.noticeId) }) > 0;
  return (
    <Checkbox
      aria-label={props.label}
      checked={props.checked}
      disabled={props.disabled || busy}
      onCheckedChange={(c) => props.onChange(c === true)}
    />
  );
}

const statusOf = (e: unknown) => (e instanceof ApiError ? e.statusCode : undefined);

/** Which sentence a failed tick or decision shows. Every 409 here carries a
 * `details.code`, except the idempotency interceptor's "still being processed". */
function smsErrorKey(e: unknown): string {
  if (!(e instanceof ApiError) || e.statusCode !== 409) return 'manage.actionError';
  switch (e.details?.['code']) {
    case 'NOTICE_SMS_NOT_PENDING':
      return 'manage.sms.alreadyDecided';
    case 'NOTICE_SMS_NOT_LIVE':
      return 'manage.sms.notLive';
    case 'INSUFFICIENT_SMS_CREDIT':
      return 'manage.sms.noCredit';
    default:
      return 'manage.sms.inFlight';
  }
}

export function NoticeSmsPage({ noticeId, onClose }: { noticeId: string; onClose: () => void }) {
  const { t } = useTranslation('notices');
  const config = useTenantRegionConfig();
  const qc = useQueryClient();
  // One key per decision attempt: a lost reply re-sends it, a success rotates it.
  const keys = React.useRef<Partial<Record<'approve' | 'decline', string>>>({});
  const [page, setPage] = React.useState(1);
  const [declining, setDeclining] = React.useState(false);
  const fmt = (n: number) => renderDigits(String(n), config.numerals);

  const query = useQuery({
    queryKey: smsKey(noticeId, page),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<SmsView>(`/notices/${noticeId}/sms`, {
          params: { page, limit: PAGE_SIZE },
          signal,
        })
      ).data,
    placeholderData: keepPreviousData,
    // A 403/404 is the answer; only a dropped connection is worth trying again.
    retry: false,
  });
  const view = query.data;

  const refresh = () => qc.invalidateQueries({ queryKey: noticeKeys.all });
  const tick = useMutation({
    mutationKey: tickKey(noticeId),
    mutationFn: async (v: { id: string; smsWanted: boolean }) =>
      (
        await apiClient.patch<unknown>(`/notices/${noticeId}/sms/recipients`, {
          ids: [v.id],
          smsWanted: v.smsWanted,
        })
      ).data,
    retry: false,
    // The box snaps back on the refetch; say why, so no one thinks the person is out.
    onError: (e) => toast.error(t(smsErrorKey(e))),
    onSettled: refresh,
  });
  const decide = useMutation({
    mutationKey: [...writeKey(noticeId), 'decide'],
    mutationFn: async (action: 'approve' | 'decline') =>
      (
        await apiClient.post<SmsDecision>(`/notices/${noticeId}/sms/${action}`, undefined, {
          headers: { 'Idempotency-Key': (keys.current[action] ??= crypto.randomUUID()) },
        })
      ).data,
    retry: false,
    onSettled: refresh,
  });

  function send(action: 'approve' | 'decline') {
    decide.mutate(action, {
      onSuccess: (r) => {
        keys.current = {};
        toast.success(
          action === 'approve'
            ? t('manage.sms.approved', { n: fmt(r.queued) })
            : t('manage.sms.declined'),
        );
        onClose();
      },
      // A second click, a colleague who decided first, too little credit: say which.
      onError: (e) => toast.error(t(smsErrorKey(e))),
      onSettled: () => setDeclining(false),
    });
  }

  const pending = view?.status === 'PENDING';
  const columns: DataTableColumn<SmsPerson>[] = [
    {
      id: 'name',
      header: t('manage.sms.colName'),
      accessorFn: (p) => p.guardianName,
      card: 'title',
    },
    { id: 'for', header: t('manage.sms.colFor'), accessorFn: (p) => p.forStudent ?? '' },
    {
      id: 'phone',
      header: t('manage.sms.colPhone'),
      accessorFn: (p) => p.phone ?? t('manage.sms.noPhoneRow'),
    },
    {
      id: 'send',
      header: t('manage.sms.colSend'),
      // DataTable caches this element until `data` changes, so the box reads the
      // pending write itself (useIsMutating) instead of a stale `tick.isPending`.
      accessorFn: (p) => (
        <SendBox
          noticeId={noticeId}
          // A guardian has one row per child (D17); the student keeps the two names apart (#3486).
          label={
            p.forStudent
              ? t('manage.sms.sendToFor', { name: p.guardianName, student: p.forStudent })
              : t('manage.sms.sendTo', { name: p.guardianName })
          }
          checked={p.smsWanted}
          disabled={!pending || !p.reachable}
          onChange={(smsWanted) => tick.mutate({ id: p.id, smsWanted })}
        />
      ),
    },
  ];

  const noAccess = statusOf(query.error) === 403;
  const body = noAccess ? (
    <p role="alert">{t('manage.sms.noAccess')}</p>
  ) : query.isError ? (
    <div role="alert" className="flex flex-col items-start gap-3">
      <p>{t('manage.sms.loadError')}</p>
      <Button variant="outline" onClick={() => void query.refetch()}>
        {t('manage.retry')}
      </Button>
    </div>
  ) : !view ? (
    <div aria-busy="true" />
  ) : (
    <div className="flex flex-col gap-4">
      {view.requester && (
        <p className="text-text-secondary">
          {t('manage.sms.requestedBy', { name: view.requester })}
        </p>
      )}
      {!pending && <p className="text-text-secondary">{t('manage.sms.readOnly')}</p>}
      {pending && !view.live && <p role="alert">{t('manage.sms.notLive')}</p>}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {(
          [
            ['willSend', view.counts.willSend],
            ['optedOut', view.counts.optedOut],
            ['noPhone', view.counts.noPhone],
            ['cost', view.sms.creditCost],
          ] as const
        ).map(([k, n]) => (
          <Card key={k} className="p-3">
            <dt className="text-caption text-text-secondary">{t(`manage.sms.${k}`)}</dt>
            <dd className="text-h3">{fmt(n)}</dd>
          </Card>
        ))}
      </dl>
      <Card className="flex flex-col gap-1 p-3">
        <h2 className="text-caption text-text-secondary">{t('manage.sms.text')}</h2>
        <p className="whitespace-pre-line">{view.sms.text}</p>
        <p className="text-caption text-text-secondary">
          {t('manage.sms.textStats', {
            length: fmt(view.sms.length),
            segments: fmt(view.sms.segments),
          })}
        </p>
      </Card>
      <DataTable
        tableId="notice-sms"
        caption={t('manage.sms.tableCaption')}
        columns={columns}
        data={view.items}
        getRowId={(p) => p.id}
        sorting={null}
        onSortingChange={() => undefined}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={view.total}
        onPageChange={setPage}
        loading={query.isLoading}
        isFetching={query.isFetching}
        emptyState={{ title: t('manage.sms.empty'), explanation: t('manage.sms.emptyBody') }}
      />
    </div>
  );

  const shellActions =
    pending && view
      ? {
          primary: {
            label: t('manage.sms.approve'),
            onClick: () => send('approve'),
            busy: decide.isPending,
            // Wait for a tick to land: Approve sends to whoever is ticked on the server.
            disabled:
              !view.live || view.counts.willSend === 0 || decide.isPending || tick.isPending,
          },
          secondary: {
            label: t('manage.sms.decline'),
            onClick: () => setDeclining(true),
            disabled: decide.isPending,
          },
        }
      : {};

  return (
    <FullPageShell
      title={t('manage.sms.pageTitle')}
      onClose={onClose}
      size="wide"
      {...shellActions}
    >
      {body}
      <ConfirmDialog
        open={declining}
        onOpenChange={(open) => !open && setDeclining(false)}
        title={t('manage.sms.declineTitle')}
        description={t('manage.sms.declineBody')}
        confirmLabel={t('manage.sms.decline')}
        tone="default"
        busy={decide.isPending}
        onConfirm={() => send('decline')}
      />
    </FullPageShell>
  );
}
