/**
 * [8.15.55] The quiet tip on the students and dues lists: "Need this often? Keep this as a report".
 *
 * ```
 *  [ Export menu ]
 *  Need this often?  [Keep this as a report]  [x]      <- one line, under the toolbar, never a modal
 * ```
 *
 * It learns that a person keeps coming back to the same narrowing. The third time they pick a filter in
 * one browser session it shows once, and then never again for that person on that list, whether they
 * press the link, press the X, or just ignore it. Typing in the search box does not count (every
 * letter would). The link opens the same "keep as report" dialog the Export menu opens. It is shown
 * only to a person who may design reports, because that is who the dialog is for.
 *
 * Memory: the count is in `sessionStorage` (this tab's session); "already shown" is in `localStorage`
 * under the school and the person. Every read and write is in try/catch: a blocked store only means the
 * count restarts or the tip may come back, never an error.
 */
import { Permission } from '@biddaloy/shared';
import { Button } from '@biddaloy/ui/components';
import { useActiveTenant, useCurrentUserId, useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { XIcon } from 'lucide-react';
import * as React from 'react';

/** The filter the third time they apply one. */
export const LIST_HINT_AFTER = 3;

export type ListHintKey = 'students' | 'dues';

export interface ListReportHintProps {
  /** Which list; the tip is remembered per list. */
  list: ListHintKey;
  /** The list's filters as its address holds them. */
  filters: Readonly<Record<string, string | undefined>>;
  /** Filters that never count, such as the free-text search. */
  ignore?: readonly string[];
  /** Opens the "keep as report" dialog. */
  onKeep: () => void;
}

function safeGet(store: 'session' | 'local', key: string): string | null {
  try {
    return (store === 'session' ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store: 'session' | 'local', key: string, value: string) {
  try {
    (store === 'session' ? sessionStorage : localStorage).setItem(key, value);
  } catch {
    // A blocked store: the count restarts, or the tip may come back once. That is all.
  }
}

export function ListReportHint({
  list,
  filters,
  ignore = ['search'],
  onKeep,
}: ListReportHintProps) {
  const { t } = useTranslation('reports');
  const canDesign = useHasPermission(Permission.REPORTS_DESIGN);
  const scope = `${useActiveTenant() ?? '-'}.${useCurrentUserId() ?? '-'}.${list}`;
  const countKey = `reports.listHint.count.${scope}`;
  const shownKey = `reports.listHint.shown.${scope}`;

  // The filters that count, as one string: it changes only when a person picks something different.
  const active = Object.entries(filters)
    .filter(([key, value]) => !ignore.includes(key) && value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const signature = JSON.stringify(active);
  const previous = React.useRef<string | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // The first render is where the person starts (maybe a bookmarked filter): not a change.
    if (previous.current === null) {
      previous.current = signature;
      return;
    }
    if (previous.current === signature) return;
    previous.current = signature;
    // Clearing a filter is not applying one.
    if (active.length === 0 || !canDesign) return;
    const count = Number(safeGet('session', countKey) ?? '0') + 1;
    safeSet('session', countKey, String(count));
    if (count >= LIST_HINT_AFTER && safeGet('local', shownKey) === null) {
      // Marked at once, so a reload or a later visit never shows it again.
      safeSet('local', shownKey, '1');
      setVisible(true);
    }
    // `active` is rebuilt every render; `signature` says when it really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (!visible || !canDesign) return null;
  return (
    <div role="note" className="flex basis-full items-center gap-1 text-text-secondary">
      <span>{t('listHint.question')}</span>
      <Button
        type="button"
        variant="link"
        className="h-auto min-h-11 px-1 md:min-h-0"
        onClick={() => {
          setVisible(false);
          onKeep();
        }}
      >
        {t('listHint.action')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        iconOnly
        className="size-11 md:size-8"
        aria-label={t('listHint.dismiss')}
        onClick={() => setVisible(false)}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
