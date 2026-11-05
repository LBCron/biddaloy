/**
 * [53.6.01] The two panels on the notice detail page: the public link (see, copy, renew, turn
 * off) and the SMS status (ask for one, jump to the approval page). The link token comes back
 * only once, from "New link", so the link is shown only until the page is left.
 */
import { apiClient } from '@biddaloy/ui/api';
import { Button, Card, ConfirmDialog, Input, StatusBadge, toast } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useSearchNavigate } from '@biddaloy/ui/routes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { noticeKeys, type Notice } from './use-notices';

function useNoticeWrites(notice: Notice) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: noticeKeys.all });
  // One key per attempt: a lost reply re-sends it, a success rotates it.
  const key = React.useRef<string | undefined>(undefined);
  const renew = useMutation({
    mutationFn: async () =>
      (await apiClient.post<{ token: string }>(`/notices/${notice.id}/public-link`)).data,
    retry: false,
    onSuccess: refresh,
  });
  const off = useMutation({
    mutationFn: async () => void (await apiClient.delete(`/notices/${notice.id}/public-link`)),
    retry: false,
    onSuccess: refresh,
  });
  const requestSms = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<unknown>(`/notices/${notice.id}/sms/request`, undefined, {
          headers: { 'Idempotency-Key': (key.current ??= crypto.randomUUID()) },
        })
      ).data,
    retry: false,
    onSuccess: () => {
      key.current = undefined;
      return refresh();
    },
  });
  return { renew, off, requestSms };
}

export function NoticeLinkPanel({ notice }: { notice: Notice }) {
  const { t } = useTranslation('notices');
  const { renew, off } = useNoticeWrites(notice);
  const [token, setToken] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<'renew' | 'off' | null>(null);
  const url = token ? `${window.location.origin}/n/${token}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('manage.link.copied'));
    } catch {
      toast.error(t('manage.actionError'));
    }
  }

  if (!notice.isPublic) {
    return (
      <Card className="flex flex-col gap-1 p-4">
        <h2 className="text-h3">{t('manage.link.title')}</h2>
        <p className="font-medium">{t('manage.link.onlyPeople')}</p>
        <p className="text-text-secondary">{t('manage.link.onlyPeopleBody')}</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-h3">{t('manage.link.title')}</h2>
      <p className="text-text-secondary">{t('manage.link.onBody')}</p>
      {url ? (
        <div className="flex items-center gap-2">
          <Input readOnly aria-label={t('manage.link.linkLabel')} value={url} />
          <Button variant="outline" onClick={() => void copy()}>
            {t('manage.link.copy')}
          </Button>
        </div>
      ) : (
        <p className="text-text-secondary">{t('manage.link.shownOnce')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDialog('renew')}>
          {t('manage.link.renew')}
        </Button>
        <Button variant="outline" onClick={() => setDialog('off')}>
          {t('manage.link.off')}
        </Button>
      </div>
      <ConfirmDialog
        open={dialog === 'renew'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('manage.link.renewTitle')}
        description={t('manage.link.renewBody')}
        confirmLabel={t('manage.link.renew')}
        tone="default"
        busy={renew.isPending}
        onConfirm={() =>
          renew.mutate(undefined, {
            onSuccess: (r) => setToken(r.token),
            onError: () => toast.error(t('manage.actionError')),
            onSettled: () => setDialog(null),
          })
        }
      />
      <ConfirmDialog
        open={dialog === 'off'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('manage.link.offTitle')}
        description={t('manage.link.offBody')}
        confirmLabel={t('manage.link.off')}
        busy={off.isPending}
        onConfirm={() =>
          off.mutate(undefined, {
            onSuccess: () => {
              setToken(null);
              toast.success(t('manage.link.offDone'));
            },
            onError: () => toast.error(t('manage.actionError')),
            onSettled: () => setDialog(null),
          })
        }
      />
    </Card>
  );
}

const SMS_TONE = {
  NONE: 'neutral',
  PENDING: 'warning',
  APPROVED: 'success',
  DECLINED: 'neutral',
} as const;

/** `canApprove`: NOTICE_SMS_APPROVE, so the review link only shows to someone who can open it. */
export function NoticeSmsPanel({ notice, canApprove }: { notice: Notice; canApprove: boolean }) {
  const { t } = useTranslation('notices');
  const { requestSms } = useNoticeWrites(notice);
  const navigateSearch = useSearchNavigate();
  const canAsk = notice.smsStatus === 'NONE' && notice.status === 'PUBLISHED';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-h3">{t('manage.sms.title')}</h2>
      <div>
        <StatusBadge
          tone={SMS_TONE[notice.smsStatus]}
          label={t(`manage.sms.status.${notice.smsStatus}`)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {canAsk && (
          <Button
            variant="outline"
            disabled={requestSms.isPending}
            onClick={() =>
              requestSms.mutate(undefined, {
                onSuccess: () => toast.success(t('manage.sms.requested')),
                onError: () => toast.error(t('manage.actionError')),
              })
            }
          >
            {t('manage.sms.request')}
          </Button>
        )}
        {canApprove && notice.smsStatus !== 'NONE' && (
          <Button variant="outline" onClick={() => navigateSearch((prev) => ({ ...prev, sms: 1 }))}>
            {t('manage.sms.review')}
          </Button>
        )}
      </div>
    </Card>
  );
}
