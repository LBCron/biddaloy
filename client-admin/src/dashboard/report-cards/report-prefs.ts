/**
 * [8.15.47] What this browser remembers about reports, for one person in one school:
 *
 * ```
 *  reports.pins.<school>.<person>       ["<report id>", ...]          reports shown on the dashboard
 *  reports.opened.<school>.<person>     { "<report id>": "<ISO time>" }  when each report was last opened
 *  reports.usefulCard.<school>.<person> "1"                           the "Reports you may need" card was hidden
 * ```
 *
 * Why the browser and not the server: a dashboard card is a widget key in `shared/`, and the saved
 * layout accepts known keys only (docs/architecture/26-dashboard.md, section 14), so a pinned report
 * cannot be saved in the layout without a shared change. The server also keeps no "who opened what"
 * list. So these three live in `localStorage`: they do not follow a person to another device.
 *
 * Every read and write is in try/catch (a blocked store is normal, see the `UsefulLine` in the runner).
 * When the store refuses a write, it is kept in memory, so the page still works for this visit.
 * Components read through `useSyncExternalStore`, so the runner's "Show on my dashboard" and the
 * dashboard cards agree without a reload.
 */
import { useActiveTenant, useCurrentUserId } from '@biddaloy/ui/hooks';
import * as React from 'react';

const CHANGE_EVENT = 'biddaloy:report-prefs';

/** Writes that the browser store refused, so the page keeps working for this visit. */
const memory = new Map<string, string>();

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeRaw(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    // A blocked store: the memory copy carries this visit.
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

function useRaw(key: string): string | null {
  return React.useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
}

/** One key for the active school and person, so two people on one browser never share a list. */
function useScope(): string {
  const tenant = useActiveTenant();
  const user = useCurrentUserId();
  return `${tenant ?? '-'}.${user ?? '-'}`;
}

function parseIds(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function parseOpened(raw: string | null): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return {};
  }
}

/** The reports this person put on their dashboard, in the order they were added. */
export function usePinnedReports() {
  const key = `reports.pins.${useScope()}`;
  const raw = useRaw(key);
  const ids = React.useMemo(() => parseIds(raw), [raw]);
  const toggle = React.useCallback(
    (id: string) => {
      const current = parseIds(readRaw(key));
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      writeRaw(key, JSON.stringify(next));
    },
    [key],
  );
  return { ids, isPinned: (id: string) => ids.includes(id), toggle };
}

/** When this person last opened each report (ISO time), and a way to note one more open. */
export function useOpenedReports() {
  const key = `reports.opened.${useScope()}`;
  const raw = useRaw(key);
  const opened = React.useMemo(() => parseOpened(raw), [raw]);
  const markOpened = React.useCallback(
    (id: string) => {
      writeRaw(
        key,
        JSON.stringify({ ...parseOpened(readRaw(key)), [id]: new Date().toISOString() }),
      );
    },
    [key],
  );
  return { opened, markOpened };
}

/** Whether the "Reports you may need" card was hidden by this person. */
export function useUsefulCardDismissed() {
  const key = `reports.usefulCard.${useScope()}`;
  const dismissed = useRaw(key) === '1';
  const dismiss = React.useCallback(() => writeRaw(key, '1'), [key]);
  return { dismissed, dismiss };
}
