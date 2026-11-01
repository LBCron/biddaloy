/**
 * [53.3.g2.01] New / edit notice, one full-page modal in three steps: write and attach, who gets
 * it, check. The draft is created on the first save and saved again on every step change, so the
 * audience (which is stored on the server, not here) is never lost (D14). After publishing the
 * audience is read-only (D5). The route files mount this; they are not part of this ticket.
 */
import { NoticeStatus, NOTICE_LIMITS, UserRole } from '@biddaloy/shared';
import { AudienceBuilder } from '@biddaloy/ui';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Checkbox,
  DatePicker,
  Input,
  Label,
  Textarea,
  ErrorState,
  Skeleton,
} from '@biddaloy/ui/components';
import { useActiveRole } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { toIsoDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import {
  INITIAL_FILTERS,
  audienceQuery,
  needsClass,
  pendingHint,
  personRow,
  recipientRow,
  tabKeys,
  useAudienceColumns,
  useAudienceTabs,
  type AudienceFilterState,
  type AudienceRow,
  type TabKey,
} from './audience-tabs';
import { NoticeFilesField } from './notice-files-field';
import { PublishConfirmDialog } from './publish-confirm-dialog';
import {
  RECIPIENTS_PAGE,
  useAddMatching,
  useAddRecipients,
  useAllRecipients,
  useAudiencePeople,
  useNotice,
  useNewPublicLink,
  usePublishNotice,
  useRecipients,
  useRemoveNoticeFile,
  useRemoveRecipients,
  useSaveNotice,
  useUploadNoticeFiles,
  type NoticeFileDto,
} from './use-compose';

type Step = 'write' | 'audience' | 'review';

export interface NoticeComposeProps {
  /** Edit mode: the notice to load. Omit for a new notice. */
  noticeId?: string | undefined;
  onClose: () => void;
  /** After publishing (or saving a published notice): go to the detail page. */
  onPublished: (id: string) => void;
}

const parseDate = (iso: string | null) => {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

function Counter({ value, max }: { value: string; max: number }) {
  const { t } = useTranslation('noticeCompose');
  return (
    <span className="text-caption text-text-secondary">
      {t('fields.counter', { count: value.length, max })}
    </span>
  );
}

export function NoticeCompose({ noticeId, onClose, onPublished }: NoticeComposeProps) {
  const { t } = useTranslation('noticeCompose');
  const config = useRegionConfig();
  const isTeacher = useActiveRole() === UserRole.TEACHER;

  const [id, setId] = React.useState(noticeId);
  const existing = useNotice(noticeId);
  const [status, setStatus] = React.useState<NoticeStatus>(NoticeStatus.DRAFT);
  const [step, setStep] = React.useState<Step>('write');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [important, setImportant] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const [isPublic, setIsPublic] = React.useState(false);
  const [sms, setSms] = React.useState(false);
  const [expires, setExpires] = React.useState<Date | undefined>(undefined);
  const [pending, setPending] = React.useState<File[]>([]);
  const [saved, setSaved] = React.useState<NoticeFileDto[]>([]);
  const [errors, setErrors] = React.useState<{ title?: string; body?: string }>({});
  const [message, setMessage] = React.useState<string | undefined>(undefined);
  const [dirty, setDirty] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const [tab, setTab] = React.useState<TabKey>(tabKeys(isTeacher)[0] ?? 'guardians');
  const [filters, setFilters] = React.useState<AudienceFilterState>(INITIAL_FILTERS);
  const [matchPage, setMatchPage] = React.useState(1);
  const [chosenPage, setChosenPage] = React.useState(1);

  // Fill the form once from the loaded notice (edit mode).
  const loaded = React.useRef(false);
  React.useEffect(() => {
    const n = existing.data;
    if (!n || loaded.current) return;
    loaded.current = true;
    setTitle(n.title);
    setBody(n.body ?? '');
    setImportant(n.important);
    setPinned(n.pinned);
    setIsPublic(n.isPublic);
    setExpires(parseDate(n.expiresOn));
    setStatus(n.status as NoticeStatus);
    // Saved files show in the form and count against the file limit.
    setSaved(n.files ?? []);
  }, [existing.data]);

  const saveNotice = useSaveNotice();
  const upload = useUploadNoticeFiles();
  const removeFile = useRemoveNoticeFile();
  // Guardians and students wait for a class: without one the server answers 400.
  const waitingForClass = needsClass(tab, filters);
  const people = useAudiencePeople(
    audienceQuery(tab, filters, matchPage, RECIPIENTS_PAGE),
    step === 'audience' && id !== undefined && !waitingForClass,
  );
  const recipients = useRecipients(id, chosenPage);
  const allRecipients = useAllRecipients(id, step === 'review');
  const addRecipients = useAddRecipients(id ?? '');
  const removeRecipients = useRemoveRecipients(id ?? '');
  const addMatching = useAddMatching(id ?? '');
  const publish = usePublishNotice(id ?? '');
  const newLink = useNewPublicLink(id ?? '');
  // The public link is shown once: hold the page here until the admin has seen it. No token yet
  // means it is being made, or making it failed (the notice is published either way).
  const [linkDone, setLinkDone] = React.useState<{ id: string; token?: string } | undefined>();
  const finish = (noticeId: string, token?: string | null) =>
    token ? setLinkDone({ id: noticeId, token }) : onPublished(noticeId);
  /** Only `POST :id/public-link`: a failure here never sends publish again (Rule 25). */
  const mintLink = (noticeId: string) => {
    setLinkDone({ id: noticeId });
    newLink.mutate(undefined, { onSuccess: (l) => setLinkDone({ id: noticeId, token: l.token }) });
  };

  const columns = useAudienceColumns();
  const setFilter = (next: Partial<AudienceFilterState>) => {
    setFilters((f) => ({ ...f, ...next }));
    setMatchPage(1);
  };
  const tabs = useAudienceTabs(isTeacher, filters, setFilter);

  const failed = () => setMessage(t('errors.generic'));

  const touch = () => {
    setDirty(true);
    setMessage(undefined);
  };

  function validate(): boolean {
    const next: { title?: string; body?: string } = {};
    const tt = title.trim();
    if (!tt) next.title = t('errors.titleRequired');
    else if (tt.length > NOTICE_LIMITS.titleMax)
      next.title = t('errors.titleTooLong', { max: NOTICE_LIMITS.titleMax });
    const bb = body.trim();
    if (!bb) next.body = t('errors.bodyRequired');
    else if (bb.length > NOTICE_LIMITS.bodyMax)
      next.body = t('errors.bodyTooLong', { max: NOTICE_LIMITS.bodyMax });
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  /** Create or update the draft, then upload the files that are still waiting. */
  const mintedToken = React.useRef<string | undefined>(undefined);
  async function persist(): Promise<string> {
    let current = id;
    if (current === undefined || dirty) {
      const notice = await saveNotice.mutateAsync({
        id: current,
        fields: {
          title: title.trim(),
          body: body.trim(),
          important,
          pinned,
          isPublic,
          expiresOn: expires ? toIsoDate(expires) : null,
        },
      });
      current = notice.id;
      setId(current);
      if (notice.publicLinkToken) mintedToken.current = notice.publicLinkToken;
    }
    if (pending.length > 0) {
      const files = await upload.mutateAsync({ id: current, files: pending });
      setSaved((s) => [...s, ...files]);
      setPending([]);
    }
    setDirty(false);
    return current;
  }

  // One write at a time: a double-click lands before the first render of `busy`.
  const inFlight = React.useRef(false);
  const [busy, setBusy] = React.useState(false);
  async function guarded<T>(
    fn: () => Promise<T>,
    failure: 'errors.generic' | 'errors.publishFailed' = 'errors.generic',
  ): Promise<T | undefined> {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      return await fn();
    } catch {
      setMessage(t(failure));
      return undefined;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const saveDraft = () =>
    guarded(async () => {
      if (!validate()) return;
      await persist();
      setMessage(t('saved'));
    });

  const published = status !== NoticeStatus.DRAFT;
  const steps: Step[] = published ? ['write', 'audience'] : ['write', 'audience', 'review'];
  const last = step === steps[steps.length - 1];

  const next = () =>
    guarded(async () => {
      if (step === 'write' && !validate()) return;
      if (last) {
        // A published notice: save the edit and go to the detail page.
        const saved = await persist();
        finish(saved, mintedToken.current);
        mintedToken.current = undefined;
        return;
      }
      if (step === 'write' || dirty) await persist();
      setStep(steps[steps.indexOf(step) + 1] ?? step);
    });

  const counts = React.useMemo(() => {
    const rows = allRecipients.data ?? [];
    const by = (r: AudienceRow['reach']) => rows.filter((x) => recipientRow(x).reach === r).length;
    return { app: by('app'), smsOnly: by('sms'), unreachable: by('none'), total: rows.length };
  }, [allRecipients.data]);

  const publishNow = () =>
    guarded(async () => {
      if (published) return;
      const saved2 = await persist();
      const notice = await publish.mutateAsync(sms);
      // Published from here on: nothing on this page may publish again.
      setStatus(notice.status as NoticeStatus);
      setConfirmOpen(false);
      // Publish never returns the token (its answer is cached); ask for it in its own step.
      if (notice.isPublic) mintLink(saved2);
      else onPublished(saved2);
    }, 'errors.publishFailed');

  // Edit mode: never show (or overwrite) the form before the notice has loaded.
  if (noticeId !== undefined && !loaded.current && !existing.isError && existing.isPending) {
    return (
      <FullPageShell title={t('editTitle')} onClose={onClose} size="wide">
        <Skeleton className="h-40 w-full" />
      </FullPageShell>
    );
  }
  if (noticeId !== undefined && existing.isError) {
    return (
      <FullPageShell title={t('editTitle')} onClose={onClose} size="wide">
        <ErrorState
          message={t('errors.loadNotice')}
          retryLabel={t('actions.retry')}
          onRetry={() => void existing.refetch()}
        />
      </FullPageShell>
    );
  }

  const primaryLabel = last && !published ? t('actions.publish') : t('actions.next');
  const reviewReady = step !== 'review' || (allRecipients.isSuccess && counts.total > 0);

  return (
    <FullPageShell
      title={noticeId ? t('editTitle') : t('title')}
      onClose={onClose}
      dirty={dirty}
      size="wide"
      primary={{
        label: primaryLabel,
        busy: busy && !confirmOpen,
        disabled: !reviewReady,
        onClick: () => (step === 'review' && !published ? setConfirmOpen(true) : void next()),
      }}
      {...(!published
        ? {
            secondary: {
              label: t('actions.saveDraft'),
              onClick: () => void saveDraft(),
              disabled: busy,
            },
          }
        : {})}
    >
      <ol className="flex flex-wrap gap-4 text-text-secondary">
        {steps.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={s === step ? 'text-text font-semibold' : ''}
          >
            {i + 1}. {t(`steps.${s}`)}
          </li>
        ))}
      </ol>
      {message && !confirmOpen && (
        <p role="status" className="text-text-secondary">
          {message}
        </p>
      )}

      {step === 'write' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-title">{t('fields.title')}</Label>
            <Input
              id="notice-title"
              value={title}
              // Slack past 140 so a paste shows the "too long" message instead of silently cutting.
              maxLength={NOTICE_LIMITS.titleMax + 20}
              aria-invalid={errors.title !== undefined}
              aria-describedby={errors.title ? 'notice-title-error' : undefined}
              onChange={(e) => {
                setTitle(e.target.value);
                touch();
              }}
            />
            <Counter value={title} max={NOTICE_LIMITS.titleMax} />
            {errors.title && (
              <p id="notice-title-error" role="alert" className="text-sm text-destructive">
                {errors.title}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-body">{t('fields.body')}</Label>
            <Textarea
              id="notice-body"
              rows={8}
              value={body}
              aria-invalid={errors.body !== undefined}
              aria-describedby={errors.body ? 'notice-body-error' : undefined}
              onChange={(e) => {
                setBody(e.target.value);
                touch();
              }}
            />
            <Counter value={body} max={NOTICE_LIMITS.bodyMax} />
            {errors.body && (
              <p id="notice-body-error" role="alert" className="text-sm text-destructive">
                {errors.body}
              </p>
            )}
          </div>

          <NoticeFilesField
            pending={pending}
            saved={saved}
            disabled={busy}
            onPendingChange={(files) => {
              setPending(files);
              touch();
            }}
            onRemoveSaved={(file) =>
              id !== undefined &&
              removeFile.mutate(
                { id, fileId: file.id },
                {
                  onSuccess: () => setSaved((s) => s.filter((x) => x.id !== file.id)),
                  onError: failed,
                },
              )
            }
          />

          <div className="flex flex-col gap-3">
            {(
              [
                ['important', important, setImportant],
                ['pinned', pinned, setPinned],
                ['isPublic', isPublic, setIsPublic],
                ['sms', sms, setSms],
              ] as const
            ).map(([key, value, set]) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`notice-${key}`}
                  checked={value}
                  onCheckedChange={(c) => {
                    set(c === true);
                    // The SMS request is asked at publish time; it is not part of the draft.
                    if (key !== 'sms') touch();
                  }}
                />
                <Label htmlFor={`notice-${key}`}>{t(`fields.${key}`)}</Label>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-expires">{t('fields.expires')}</Label>
            <div className="flex items-center gap-3">
              <DatePicker
                id="notice-expires"
                aria-label={t('fields.expires')}
                config={config}
                value={expires}
                placeholder={t('fields.noExpiry')}
                onValueChange={(d) => {
                  setExpires(d);
                  touch();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {step === 'audience' &&
        (published ? (
          <p>{t('audience.readOnly')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-text-secondary">{t('audience.intro')}</p>
            {waitingForClass && <p role="status">{t(`audience.${pendingHint(tab, filters)}`)}</p>}
            <AudienceBuilder<AudienceRow>
              tabs={tabs}
              activeTab={tab}
              onTabChange={(k) => {
                setTab(k as TabKey);
                setMatchPage(1);
              }}
              onClearFilters={() => {
                setFilters(INITIAL_FILTERS);
                setMatchPage(1);
              }}
              matches={{
                rows: waitingForClass ? [] : (people.data?.items ?? []).map(personRow),
                total: waitingForClass ? 0 : (people.data?.total ?? 0),
                page: matchPage,
                pageSize: RECIPIENTS_PAGE,
                loading: people.isFetching,
                error: people.isError ? t('audience.loadError') : undefined,
              }}
              onPageChange={setMatchPage}
              onRetry={() => void people.refetch()}
              rowKey={(r) => r.key}
              columns={columns}
              onAddSelected={(rows) =>
                addRecipients
                  .mutateAsync(rows.flatMap((r) => (r.ref ? [r.ref] : [])))
                  .catch((e: unknown) => {
                    failed();
                    throw e;
                  })
              }
              onAddAll={() =>
                addMatching
                  .mutateAsync(audienceQuery(tab, filters, 1, RECIPIENTS_PAGE))
                  .catch((e: unknown) => {
                    failed();
                    throw e;
                  })
              }
              chosen={{
                rows: (recipients.data?.items ?? []).map(recipientRow),
                total: recipients.data?.total ?? 0,
                page: chosenPage,
                pageSize: RECIPIENTS_PAGE,
              }}
              onChosenPage={setChosenPage}
              onRemove={(rows) =>
                removeRecipients.mutate(
                  rows.flatMap((r) => (r.recipientId ? [r.recipientId] : [])),
                  { onError: failed },
                )
              }
              // ponytail: compares Chosen rows (a guardian counts once per child), while the
              // server caps distinct people, so a big guardian list is refused here a little
              // early. Rows also drive the SMS fan-out. Feed a people count if schools hit it.
              max={NOTICE_LIMITS.recipientsMax}
            />
          </div>
        ))}

      {step === 'review' &&
        (allRecipients.isError ? (
          <ErrorState
            message={t('audience.loadError')}
            retryLabel={t('actions.retry')}
            onRetry={() => void allRecipients.refetch()}
          />
        ) : (
          <section aria-labelledby="notice-review" className="flex flex-col gap-3">
            <h2 id="notice-review" className="text-h2">
              {t('review.heading')}
            </h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2">
              <dt>{t('review.app')}</dt>
              <dd>{counts.app}</dd>
              <dt>{t('review.smsOnly')}</dt>
              <dd>{counts.smsOnly}</dd>
              <dt>{t('review.unreachable')}</dt>
              <dd>{counts.unreachable}</dd>
            </dl>
            <p className="text-text-secondary">{t('review.total', { count: counts.total })}</p>
            {allRecipients.isSuccess && counts.total === 0 && (
              <p role="alert" className="text-sm text-destructive">
                {t('errors.noRecipients')}
              </p>
            )}
          </section>
        ))}

      {step !== 'write' && (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setStep(steps[steps.indexOf(step) - 1] ?? 'write')}
          >
            {t('actions.back')}
          </Button>
        </div>
      )}

      <Dialog open={linkDone !== undefined}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('publicLink.title')}</DialogTitle>
            <DialogDescription>{t('publicLink.hint')}</DialogDescription>
          </DialogHeader>
          {linkDone?.token ? (
            <Input
              readOnly
              aria-label={t('publicLink.title')}
              value={`${window.location.origin}/n/${linkDone.token}`}
              onFocus={(e) => e.currentTarget.select()}
            />
          ) : newLink.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t('publicLink.failed')}
            </p>
          ) : (
            <p role="status">{t('publicLink.creating')}</p>
          )}
          <DialogFooter>
            {linkDone && !linkDone.token && newLink.isError && (
              <Button type="button" variant="outline" onClick={() => mintLink(linkDone.id)}>
                {t('publicLink.retry')}
              </Button>
            )}
            <Button
              type="button"
              disabled={newLink.isPending}
              onClick={() => linkDone && onPublished(linkDone.id)}
            >
              {t('publicLink.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PublishConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        counts={counts}
        sms={sms}
        busy={busy}
        error={message}
        onConfirm={() => void publishNow()}
      />
    </FullPageShell>
  );
}
