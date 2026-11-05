/**
 * [70.5.x] `/my-class/$sectionId/notes?for=<examId|final>`: the class teacher's remark + conduct
 * grid for one result (D7, D13). Own chromeless route (`FullPageShell`, like `/students/new`):
 * Close / Esc / browser Back ask before dropping unsaved edits. A published target is read-only.
 */
import { captureNotificationTenant, isNotFoundError, notifyOutcome } from '@biddaloy/ui/api';
import {
  ConfirmDialog,
  ErrorState,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  myClassSectionsQueryOptions,
  useMyClassSections,
  useReportCardNotes,
  useSaveReportCardNotes,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { NotesGrid, type NoteDraft } from './-notes-grid';
import { useNotesTargets } from './-notes-targets';

const searchSchema = z.object({
  for: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/my-class/$sectionId_/notes')({
  staticData: { chromeless: true },
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myClassSectionsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('myClass', 'nav'),
    ]),
  pendingComponent: NotesPending,
  component: NotesPage,
});

function NotesPending() {
  const { t } = useTranslation('myClass');
  return <RoutePending variant="form" label={t('loading')} />;
}

const toDrafts = (
  rows: { student_id: string; remark: string | null; conduct: NoteDraft['conduct'] }[],
) =>
  Object.fromEntries(
    rows.map((r) => [r.student_id, { remark: r.remark ?? '', conduct: { ...r.conduct } }]),
  ) as Record<string, NoteDraft>;

// Key-order independent, so editing a grade and putting it back is not "dirty".
const sig = (d: Record<string, NoteDraft>) =>
  JSON.stringify(
    Object.keys(d)
      .sort()
      .map((id) => [
        id,
        d[id]?.remark,
        Object.entries(d[id]?.conduct ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      ]),
  );

function NotesPage() {
  const { t } = useTranslation('myClass');
  const { t: tCommon } = useTranslation('common');
  const { sectionId } = Route.useParams();
  const { for: forKey } = Route.useSearch();
  const navigate = useNavigate();
  const sections = useMyClassSections();
  const section = sections.data?.find((s) => s.section_id === sectionId);
  const targets = useNotesTargets(section?.class_id);

  // A named `?for=` that no longer exists shows nothing rather than another target's notes.
  const option = forKey
    ? targets.options.find((o) => o.key === forKey)
    : (targets.options.find((o) => o.key === 'final') ?? targets.options[0]);
  const notes = useReportCardNotes(sectionId, option?.target);
  const save = useSaveReportCardNotes(sectionId, option?.target ?? { exam_id: '' });

  const [drafts, setDrafts] = React.useState<Record<string, NoteDraft>>({});
  const [baseline, setBaseline] = React.useState('');
  const [loadedView, setLoadedView] = React.useState<unknown>(null);
  const [lockedByServer, setLockedByServer] = React.useState(false);
  const [pendingKey, setPendingKey] = React.useState<string | null>(null);
  const view = notes.data;
  // Latest drafts/baseline for the effect below (it must not re-run on every keystroke).
  const draftsRef = React.useRef(drafts);
  const baselineRef = React.useRef(baseline);
  draftsRef.current = drafts;
  baselineRef.current = baseline;
  const loadedKeyRef = React.useRef<string | null>(null);
  const resetRef = React.useRef(false); // set by a successful save / a 409: take the server's data
  // A new view replaces the drafts only for a new target, a clean page, or after a save. A
  // background refetch of the same target keeps what the teacher typed.
  React.useEffect(() => {
    if (!view) return;
    const key = option?.key ?? null;
    const keep =
      loadedKeyRef.current === key &&
      !resetRef.current &&
      sig(draftsRef.current) !== baselineRef.current;
    setLoadedView(view);
    if (keep) return;
    resetRef.current = false;
    loadedKeyRef.current = key;
    const next = toDrafts(view.rows);
    setDrafts(next);
    setBaseline(sig(next));
    setLockedByServer(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the data only
  }, [view]);

  const sectionTitle = section ? `${section.class_name} – ${section.section_name}` : '';
  const title = `${t('notes.title')}${sectionTitle ? ` — ${sectionTitle}` : ''}`;
  // The tab title follows the shell's heading (the app's title hook), so no `document.title` here.

  const close = useCloseFullPage(
    React.useCallback(
      () => void navigate({ to: '/my-class/$sectionId', params: { sectionId } }),
      [navigate, sectionId],
    ),
  );

  if (sections.isPending) return <NotesPending />;
  if (!section) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw notFound();
  }
  if (notes.isError && isNotFoundError(notes.error)) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw notFound();
  }

  const synced = loadedView === view;
  const dirty = view !== undefined && synced && sig(drafts) !== baseline;
  const locked = (view?.locked ?? option?.published ?? false) || lockedByServer;
  const missingRemark = Object.values(drafts).filter((d) => d.remark.trim() === '').length;
  const items = view?.conduct_items ?? [];
  const missingConduct = Object.values(drafts).filter((d) =>
    items.some((i) => d.conduct[i.key] === undefined),
  ).length;

  const switchTo = (key: string) => void navigate({ to: '.', search: { for: key }, replace: true });

  const onSave = () => {
    if (!view) return;
    const tenantId = captureNotificationTenant();
    save.mutate(
      {
        notes: view.rows.map((r) => {
          const d = drafts[r.student_id] ?? { remark: '', conduct: {} };
          return {
            student_id: r.student_id,
            remark: d.remark.trim() === '' ? null : d.remark,
            conduct: d.conduct,
          };
        }),
      },
      {
        onSuccess: () => {
          resetRef.current = true;
          notifyOutcome({ tenantId, variant: 'success', message: t('notes.saved') });
        },
        onError: (err) => {
          if ((err as { statusCode?: number }).statusCode === 409) {
            resetRef.current = true;
            setLockedByServer(true);
            void notes.refetch();
          } else notifyOutcome({ tenantId, variant: 'error', message: t('notes.saveError') });
        },
      },
    );
  };

  let body: React.ReactNode;
  if (targets.isPending || (option !== undefined && notes.isPending)) {
    body = <RoutePending variant="form" label={t('loading')} />;
  } else if (targets.isError || notes.isError) {
    body = (
      <ErrorState
        message={t('notes.loadError')}
        retryLabel={t('retry')}
        onRetry={() => {
          targets.refetch();
          void notes.refetch();
        }}
      />
    );
  } else if (!view || view.rows.length === 0) {
    body = <p className="text-text-secondary">{t('notes.empty')}</p>;
  } else {
    body = (
      <NotesGrid
        rows={view.rows}
        items={items}
        drafts={drafts}
        disabled={locked || save.isPending}
        onChange={(id, next) => setDrafts((d) => ({ ...d, [id]: next }))}
      />
    );
  }

  return (
    <FullPageShell
      title={title}
      onClose={close}
      size="wide"
      dirty={dirty}
      primary={{
        label: t('notes.save'),
        onClick: onSave,
        busy: save.isPending,
        disabled: locked || !dirty || !synced,
      }}
      secondary={{ label: t('notes.cancel'), onClick: close }}
    >
      <ConfirmDialog
        open={pendingKey !== null}
        onOpenChange={(open) => !open && setPendingKey(null)}
        title={tCommon('fullPage.discardTitle')}
        description={tCommon('fullPage.discardDescription')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        confirmLabel={tCommon('fullPage.discardConfirm')}
        tone="danger"
        onConfirm={() => {
          if (pendingKey) switchTo(pendingKey);
          setPendingKey(null);
        }}
      />
      <div className="flex flex-col gap-4 p-4">
        {targets.options.length > 0 && option && (
          <div className="flex flex-col gap-1 md:max-w-sm">
            <label id="notes-for" className="text-label">
              {t('notes.forLabel')}
            </label>
            <Select
              value={option.key}
              onValueChange={(key) => (dirty ? setPendingKey(key) : switchTo(key))}
            >
              <SelectTrigger aria-labelledby="notes-for">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.options.map((o) => {
                  const name = o.label ?? t('notes.forFinal');
                  return (
                    <SelectItem key={o.key} value={o.key}>
                      {o.published ? t('notes.lockedMark', { name }) : name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        )}
        {targets.finalError && (
          <ErrorState
            message={t('notes.loadError')}
            retryLabel={t('retry')}
            onRetry={() => targets.refetch()}
          />
        )}
        {view && view.rows.length > 0 && (
          <p role="status" className="text-text-secondary">
            {t('notes.missing', { remark: missingRemark, conduct: missingConduct })}
          </p>
        )}
        {locked && view && (
          <p role="alert" className="text-text-secondary">
            {t('notes.locked')}
          </p>
        )}
        {body}
      </div>
    </FullPageShell>
  );
}
