/**
 * [8.15.47] Kept copies of a report: "Keep today's copy" (the dialog) and "Kept copies" (the panel).
 *
 * ```
 *  Keep today's copy                         Kept copies            (only when there are some)
 *  What is it for? [ BANBEIS 2026 submission ]   Date        What for  
 *  Numbers as of   [ 2026-10-31 ]                31 Oct 2026 BANBEIS 2026 submission  [Download to Excel]
 *                       [Cancel] [Keep copy]
 * ```
 *
 * A kept copy is a stored file of one run (Epic 8.15 D15). It never changes and never expires, so a
 * BANBEIS submission can be downloaded later exactly as it was sent. The list is the server's own
 * `GET /reports/snapshots` (every copy this person may take out); this panel keeps the ones of the
 * report on screen and shows nothing at all when there are none. A role that cannot take files out
 * gets an empty list from the server, so it never sees the panel.
 *
 * "Numbers as of" starts at the school's today and is sent only when the person changes it, so the
 * server's own today (school time) stays the default. Saving carries an `Idempotency-Key` and never
 * retries (`useKeepReportCopy`).
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@biddaloy/ui/components';
import {
  downloadReportSnapshot,
  useKeepReportCopy,
  useReportSnapshots,
  type ReportSnapshot,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, tenantTodayIso } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface KeepCopyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The run on screen: the copy is made from it. */
  runId: string;
}

export function KeepCopyDialog({ open, onOpenChange, runId }: KeepCopyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <KeepCopyForm runId={runId} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function KeepCopyForm({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { t } = useTranslation('reports');
  const { t: tCommon } = useTranslation('common');
  const config = useRegionConfig();
  const keep = useKeepReportCopy();
  const today = React.useMemo(() => tenantTodayIso(config), [config]);
  const [label, setLabel] = React.useState('');
  const [asOf, setAsOf] = React.useState(today);
  const labelId = React.useId();
  const dateId = React.useId();

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (keep.isPending) return;
    keep.mutate(
      { runId, label, ...(asOf !== today && asOf !== '' ? { asOf } : {}) },
      {
        onSuccess: () => {
          toast.success(t('copies.keep.saved'));
          onClose();
        },
      },
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('copies.keep.title')}</DialogTitle>
        <DialogDescription>{t('copies.keep.description')}</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={labelId}>{t('copies.keep.whatFor')}</Label>
          <Input
            id={labelId}
            value={label}
            maxLength={160}
            placeholder={t('copies.keep.whatForPlaceholder')}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={dateId}>{t('copies.keep.asOf')}</Label>
          <Input
            id={dateId}
            type="date"
            value={asOf}
            max={today}
            onChange={(event) => setAsOf(event.target.value)}
          />
        </div>
        {keep.isError && (
          <p role="alert" className="text-destructive">
            {t('copies.keep.error')}
          </p>
        )}
        <DialogFooter showCloseButton closeLabel={tCommon('actions.cancel')}>
          <Button type="submit" loading={keep.isPending}>
            {t('copies.keep.save')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function SnapshotsPanel({
  definitionId,
  enabled,
}: {
  definitionId: string;
  enabled: boolean;
}) {
  const { t } = useTranslation('reports');
  const config = useRegionConfig();
  const snapshots = useReportSnapshots({ enabled });
  const [busy, setBusy] = React.useState<string | null>(null);
  const copies: ReportSnapshot[] = (snapshots.data?.items ?? []).filter(
    (s) => s.definition_id === definitionId,
  );
  if (copies.length === 0) return null;

  async function download(copy: ReportSnapshot) {
    setBusy(copy.id);
    try {
      await downloadReportSnapshot(copy.id);
    } catch {
      toast.error(t('copies.panel.downloadError'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="kept-copies" className="flex flex-col gap-2 print:hidden">
      <h2 id="kept-copies" className="text-h2">
        {t('copies.panel.title')}
      </h2>
      <table className="w-full text-start">
        <caption className="sr-only">{t('copies.panel.title')}</caption>
        <thead>
          <tr className="text-text-secondary">
            <th scope="col" className="py-1 pe-3 text-start font-medium">
              {t('copies.panel.date')}
            </th>
            <th scope="col" className="py-1 pe-3 text-start font-medium">
              {t('copies.panel.forWhat')}
            </th>
            <th scope="col">
              <span className="sr-only">{t('copies.panel.download')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {copies.map((copy) => (
            <tr key={copy.id} className="border-t border-border-subtle">
              <td className="py-2 pe-3">{formatDate(copy.as_of, config)}</td>
              <td className="py-2 pe-3">{copy.label}</td>
              <td className="py-2 text-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={busy === copy.id}
                  aria-label={t('copies.panel.downloadLabel', { label: copy.label })}
                  onClick={() => void download(copy)}
                >
                  {t('copies.panel.download')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
