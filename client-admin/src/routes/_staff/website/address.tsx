/**
 * [40.5.04] Website › Address. Rename the web address (the old one forwards for 30 days, D34) and
 * attach or remove the school's own address (D5, D23). Both cards read server state; nothing here
 * goes through the shared draft, so the tab never counts as unsaved.
 *
 * The own-address card is hidden when the server says custom addresses are off (409). Every
 * refusal gets one fixed sentence: the server hides the reason on purpose and nothing the admin
 * typed is echoed back.
 */
import { SITE_SUBDOMAIN_RE } from '@biddaloy/shared';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Skeleton,
  StatusBadge,
  toast,
  type StatusTone,
} from '@biddaloy/ui/components';
import {
  useCustomDomain,
  usePreviewToken,
  useRecheckCustomDomain,
  useRemoveCustomDomain,
  useRenameSubdomain,
  useSetCustomDomain,
  useSubdomainCheck,
  useSubdomainSuggestions,
  useWebsiteConfig,
  type CustomDomainStatus,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { GlobeIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/website/address')({
  loader: () => loadRouteNamespaces('website', 'common'),
  component: WebsiteAddress,
});

/** Duck-typed like `isTenantSuspendedError`: a copy of the class from another bundle still counts. */
const statusOf = (error: unknown) => (error as { statusCode?: number } | null)?.statusCode ?? 0;

/** Recheck asks Cloudflare, which is rate limited: one click a minute (D35). */
const RECHECK_COOLDOWN_MS = 60_000;

function useCopy() {
  const { t } = useTranslation('website');
  return async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('address.copied'));
    } catch {
      toast.error(t('address.copyFailed'));
    }
  };
}

function WebsiteAddress() {
  return (
    <div className="flex flex-col gap-4">
      <SubdomainCard />
      <OwnDomainCard />
    </div>
  );
}

function SubdomainCard() {
  const { t } = useTranslation('website');
  const copy = useCopy();
  const config = useWebsiteConfig();
  const preview = usePreviewToken({ enabled: true });
  const rename = useRenameSubdomain();
  const suggestions = useSubdomainSuggestions();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const clean = value.trim().toLowerCase();
  const current = config.data?.subdomain;
  const check = useSubdomainCheck(clean);
  const formatOk = SITE_SUBDOMAIN_RE.test(clean);
  const free = formatOk && !check.isFetching && check.data?.available === true;
  const hint = !clean
    ? null
    : !formatOk
      ? t('address.invalid')
      : check.isFetching || check.data === undefined
        ? t('address.checking')
        : check.data.available
          ? t('address.available')
          : t('address.taken');
  const chips = (suggestions.data?.suggestions ?? []).filter((s) => s !== current);

  // The preview link is `https://<address>.<root>/?preview=…`; the live address is its origin.
  const liveUrl = preview.data?.url ? new URL(preview.data.url).origin : null;

  function close() {
    setEditing(false);
    setConfirming(false);
    setError(null);
    setValue('');
  }

  async function confirmRename() {
    try {
      await rename.mutateAsync(clean);
      toast.success(t('address.renamed'));
      void preview.refetch();
      close();
    } catch (failure) {
      setConfirming(false);
      const code = statusOf(failure);
      setError(
        code === 409
          ? t('address.taken')
          : code === 429
            ? t('address.renameLimit')
            : code === 503
              ? t('address.renameLater')
              : t('address.renameError'),
      );
    }
  }

  if (config.isPending) return <Skeleton className="h-32 w-full" />;
  if (config.isError) {
    return (
      <ErrorState
        message={t('address.loadError')}
        retryLabel={t('address.own.check')}
        onRetry={() => void config.refetch()}
      />
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5">
      <h2 className="text-h3">{t('address.title')}</h2>
      <div className="flex flex-col gap-1">
        <span className="text-caption text-text-secondary">{t('address.current')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span dir="ltr" className="font-medium">
            {liveUrl ?? current}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => void copy(liveUrl ?? current ?? '')}
          >
            {t('address.copy')}
          </Button>
          {!editing && (
            <Button type="button" onClick={() => setEditing(true)}>
              {t('address.change')}
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-subdomain">{t('address.newLabel')}</Label>
          <Input
            id="new-subdomain"
            dir="ltr"
            value={value}
            autoComplete="off"
            aria-describedby="new-subdomain-hint"
            aria-invalid={clean !== '' && !formatOk && !check.isFetching ? true : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
          <p id="new-subdomain-hint" role="status" className="text-caption text-text-secondary">
            {hint}
          </p>
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" aria-label={t('address.suggestions')}>
              {chips.map((s) => (
                <Button key={s} type="button" variant="outline" onClick={() => setValue(s)}>
                  {s}
                </Button>
              ))}
            </div>
          )}
          <p className="text-caption text-text-secondary">{t('address.changeNote')}</p>
          {error && (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" disabled={!free} onClick={() => setConfirming(true)}>
              {t('address.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              {t('address.cancel')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('address.confirm.title')}
        description={t('address.confirm.body')}
        confirmLabel={t('address.confirm.action')}
        tone="default"
        busy={rename.isPending}
        onConfirm={() => void confirmRename()}
      />
    </Card>
  );
}

const STATUS_TONE: Record<NonNullable<CustomDomainStatus['status']>, StatusTone> = {
  PENDING_DNS: 'warning',
  PENDING_SSL: 'info',
  ACTIVE: 'success',
  FAILED: 'danger',
};

function OwnDomainCard() {
  const { t } = useTranslation('website');
  const domain = useCustomDomain();

  if (domain.isPending) return <Skeleton className="h-32 w-full" />;
  if (domain.isError) {
    return (
      <ErrorState
        message={t('address.loadError')}
        retryLabel={t('address.own.check')}
        onRetry={() => void domain.refetch()}
      />
    );
  }
  // Off for this school (direct mode, or no Cloudflare): the card does not exist.
  if (domain.data === null) return null;

  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5">
      <h2 className="text-h3">{t('address.own.title')}</h2>
      {domain.data.host === null ? <AddDomain /> : <DomainStatus status={domain.data} />}
    </Card>
  );
}

function ownDomainError(error: unknown, t: (key: string) => string): string {
  const code = statusOf(error);
  return code === 409
    ? t('address.own.errors.unavailable')
    : code === 503
      ? t('address.own.errors.tryLater')
      : code === 429
        ? t('address.own.errors.rateLimited')
        : t('address.own.errors.generic');
}

function AddDomain() {
  const { t } = useTranslation('website');
  const set = useSetCustomDomain();
  const [host, setHost] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const clean = host.trim().toLowerCase();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await set.mutateAsync({ host: clean });
      toast.success(t('address.own.added'));
    } catch (failure) {
      setError(ownDomainError(failure, t));
    }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)}>
      <EmptyState
        icon={<GlobeIcon aria-hidden="true" />}
        title={t('address.own.title')}
        explanation={t('address.own.body')}
      />
      <Label htmlFor="own-host">{t('address.own.host')}</Label>
      <Input
        id="own-host"
        dir="ltr"
        value={host}
        autoComplete="off"
        placeholder={t('address.own.hostHint')}
        onChange={(e) => setHost(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={clean.length < 4 || set.isPending}>
          {t('address.own.add')}
        </Button>
      </div>
    </form>
  );
}

function DomainStatus({ status }: { status: CustomDomainStatus }) {
  const { t } = useTranslation('website');
  const region = useTenantRegionConfig();
  const copy = useCopy();
  const recheck = useRecheckCustomDomain();
  const remove = useRemoveCustomDomain();
  const [removing, setRemoving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [until, setUntil] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (until <= now) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [until, now]);

  const waitSeconds = Math.max(0, Math.ceil((until - now) / 1000));

  async function doRecheck() {
    setNow(Date.now());
    setUntil(Date.now() + RECHECK_COOLDOWN_MS);
    setError(null);
    try {
      await recheck.mutateAsync();
    } catch (failure) {
      setError(ownDomainError(failure, t));
    }
  }

  async function doRemove() {
    try {
      await remove.mutateAsync();
      toast.success(t('address.own.removed'));
    } catch (failure) {
      setError(ownDomainError(failure, t));
    }
    setRemoving(false);
  }

  const state = status.status;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span dir="ltr" className="font-medium">
          {status.host}
        </span>
        {state && <StatusBadge tone={STATUS_TONE[state]} label={t(`address.own.status.${state}`)} />}
      </div>
      {state && (
        <p className="text-caption text-text-secondary">{t(`address.own.statusHelp.${state}`)}</p>
      )}

      {state !== 'ACTIVE' && (
        <>
          <p>{t('address.own.steps')}</p>
          <ol className="flex flex-col gap-3">
            {status.records.map((record, index) => (
              <li
                key={`${record.type}-${record.name}`}
                className="flex flex-col gap-2 rounded-md border border-border-subtle p-3"
              >
                <span className="font-medium">{t('address.own.lineTitle', { n: index + 1 })}</span>
                {(
                  [
                    ['type', record.type, false],
                    ['name', record.name, true],
                    ['value', record.value, true],
                  ] as const
                ).map(([label, text, copyable]) => (
                  <div key={label} className="flex flex-wrap items-center gap-2">
                    <span className="w-16 text-caption text-text-secondary">
                      {t(`address.own.${label}`)}
                    </span>
                    <span dir="ltr" className="break-all">
                      {text}
                    </span>
                    {copyable && (
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={`${t('address.copy')}: ${t(`address.own.${label}`)} ${index + 1}`}
                        onClick={() => void copy(text)}
                      >
                        {t('address.copy')}
                      </Button>
                    )}
                  </div>
                ))}
              </li>
            ))}
          </ol>
          {status.hintKey === 'apex_needs_flattening' && (
            <p className="text-caption text-text-secondary">{t('address.own.apexHint')}</p>
          )}
        </>
      )}

      <p className="text-caption text-text-secondary">
        {status.lastCheckedAt
          ? t('address.own.lastChecked', { time: formatDateTime(status.lastCheckedAt, region) })
          : t('address.own.neverChecked')}
      </p>
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {state !== 'ACTIVE' && (
          <Button
            type="button"
            disabled={recheck.isPending || waitSeconds > 0}
            onClick={() => void doRecheck()}
          >
            {waitSeconds > 0
              ? t('address.own.recheckWait', { seconds: waitSeconds })
              : t('address.own.recheck')}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => setRemoving(true)}>
          {t('address.own.remove.action')}
        </Button>
      </div>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('address.own.remove.title')}
        description={t('address.own.remove.body')}
        confirmLabel={t('address.own.remove.confirm')}
        busy={remove.isPending}
        onConfirm={() => void doRemove()}
      />
    </>
  );
}
