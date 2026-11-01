/**
 * [8.15.17] The download control on a list screen: one button that downloads **everything that
 * matches the current filters** as Excel, and a small arrow beside it for the rest (only the rows
 * the person ticked, or a CSV for other software). The common job needs no menu.
 *
 * ```
 *  [ Download to Excel · 1,234 people ][v]
 *                                       └ Only the 3 you ticked
 *                                         For other software (CSV)
 * ```
 *
 * The component never fetches. A page hands it `onExportAll(format)` (usually
 * `downloadListExport(...)` from `@biddaloy/ui/hooks`) and this component owns what is around the
 * call: one request at a time, a busy state, and an inline message — never a silent no-op — when
 * the download is refused or fails. A rejection carrying `code: 'EXPORT_TOO_LARGE'` (what
 * `ExportTooLargeError` is) gets the "narrow it down" sentence; anything else gets a retry sentence.
 *
 * Without `canExportAll` (no `REPORTS_EXPORT`) the "everything" items are hidden. The ticked-rows
 * download is a client-side CSV that needs no such permission, so it stays when rows are ticked.
 *
 * [8.15.52] `onKeepAsReport` adds one more item, "Keep this as a report" (glossary: রিপোর্ট হিসেবে
 * রাখুন). A page passes it only for a person who may design reports (`REPORTS_DESIGN`); the
 * component never checks a permission itself. It needs no download permission, so it also shows
 * when `canExportAll` is false (the overdue-only dues view has no "everything" download).
 *
 * ```
 *  [ Download to Excel · 1,234 people ][v]
 *                                       └ For other software (CSV)
 *                                         ───────────────
 *                                         Keep this as a report
 * ```
 *
 * Words come from `common.json` `export.*` (Epic 8.15 glossary: "Excel-এ নামান", never "export").
 */
import { BookmarkPlusIcon, ChevronDownIcon, DownloadIcon } from 'lucide-react';
import * as React from 'react';

import { useRegionConfig, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { formatNumber } from '../utils';

import { Button } from './button';
import { HelpHint, useHelp } from './help-hint';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './menu';

export type ExportMenuFormat = 'xlsx' | 'csv';

export interface ExportMenuProps {
  /** Rows matching the current filters, across every page — the number "everything" will download. */
  totalCount: number;
  /** Rows ticked in the table (all pages). The ticked-rows item shows only when this is above 0. */
  selectedCount?: number;
  /** Downloads everything that matches. Reject to show the inline message. */
  onExportAll: (format: ExportMenuFormat) => Promise<void>;
  /** Downloads only the ticked rows. Omit on a list that has no row selection. */
  onExportSelected?: () => void | Promise<void>;
  /** The person holds `REPORTS_EXPORT`. */
  canExportAll: boolean;
  /**
   * [8.15.52] Opens the "keep this as a report" dialog. Pass it only for a person who holds
   * `REPORTS_DESIGN`; leave it out and the item is not shown.
   */
  onKeepAsReport?: () => void;
  /**
   * A (?) after the download button (Epic 44). Shown only with the download button itself, so a
   * person who may not download never sees a lone (?).
   */
  helpId?: string | undefined;
  /** What a row is: a person ("1,234 people") or a thing ("1,234 items"). */
  unit?: 'people' | 'items';
  /** The "too large" sentence suggests narrowing by class or section instead of by filters. */
  narrowByClass?: boolean;
  className?: string;
}

/** A rejection that says "more rows than one download holds" (`ExportTooLargeError`), by shape. */
function tooLargeRows(error: unknown): number | null {
  const candidate = error as { code?: unknown; rows?: unknown } | null | undefined;
  if (candidate?.code !== 'EXPORT_TOO_LARGE') return null;
  return typeof candidate.rows === 'number' ? candidate.rows : 5000;
}

export function ExportMenu({
  totalCount,
  selectedCount = 0,
  onExportAll,
  onExportSelected,
  canExportAll,
  onKeepAsReport,
  unit = 'items',
  narrowByClass = false,
  helpId,
  className,
}: ExportMenuProps) {
  const { t } = useTranslation();
  const { resolve } = useHelp();
  const regionConfig = useRegionConfig();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  // A fast double-click can fire before React re-renders the disabled button.
  const inFlight = React.useRef(false);

  const showSelected = onExportSelected !== undefined && selectedCount > 0;
  const showKeep = onKeepAsReport !== undefined;
  if (!canExportAll && !showSelected && !showKeep) return null;

  const countText = (n: number) =>
    t(unit === 'people' ? 'export.people' : 'export.items', {
      count: n,
      n: formatNumber(n, regionConfig),
    });

  function failureText(error: unknown): string {
    const rows = tooLargeRows(error);
    if (rows === null) return t('export.failed');
    const n = formatNumber(rows, regionConfig);
    if (narrowByClass) return t('export.tooLargeClass', { n });
    return t(unit === 'people' ? 'export.tooLargePeople' : 'export.tooLargeItems', { n });
  }

  async function run(job: () => void | Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await job();
    } catch (error) {
      setMessage(failureText(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const selectedLabel = t('export.selectedOnly', { n: formatNumber(selectedCount, regionConfig) });

  const keepLabel = t('export.keepAsReport');

  const body = !canExportAll ? (
    // No permission for "everything": only the ticked-rows download and keep-as-report are left.
    <div className="inline-flex flex-wrap items-center gap-2">
      {showSelected && (
        <Button
          type="button"
          variant="outline"
          loading={busy}
          onClick={() => void run(() => onExportSelected?.())}
        >
          <DownloadIcon aria-hidden="true" />
          {selectedLabel}
        </Button>
      )}
      {showKeep && (
        <Button type="button" variant="outline" onClick={() => onKeepAsReport?.()}>
          <BookmarkPlusIcon aria-hidden="true" />
          {keepLabel}
        </Button>
      )}
    </div>
  ) : (
    <div role="group" aria-label={t('export.groupLabel')} className="inline-flex">
      <Button
        type="button"
        variant="outline"
        className="rounded-e-none"
        loading={busy}
        disabled={totalCount === 0}
        onClick={() => void run(() => onExportAll('xlsx'))}
      >
        <DownloadIcon aria-hidden="true" />
        <span>{t('export.excel')}</span>
        <span className="text-text-secondary">· {countText(totalCount)}</span>
      </Button>
      <Menu>
        <MenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            iconOnly
            aria-label={t('export.moreOptions')}
            className="rounded-s-none border-s-0"
            disabled={busy}
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end" className="min-w-64">
          {showSelected && (
            <MenuItem onSelect={() => void run(() => onExportSelected?.())}>
              {selectedLabel}
            </MenuItem>
          )}
          <MenuItem disabled={totalCount === 0} onSelect={() => void run(() => onExportAll('csv'))}>
            {t('export.csv')}
          </MenuItem>
          {showKeep && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={() => onKeepAsReport?.()}>{keepLabel}</MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
    </div>
  );

  // The row wrapper only exists when a (?) renders, so a menu without help keeps its DOM.
  const hinted = canExportAll && helpId !== undefined && resolve(helpId) !== null;

  return (
    <div className={cn('flex flex-col items-start gap-1 md:items-end', className)}>
      {hinted ? (
        <div className="inline-flex items-center gap-1">
          {body}
          <HelpHint helpId={helpId} />
        </div>
      ) : (
        body
      )}
      {message !== null && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
