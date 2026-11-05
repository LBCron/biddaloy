import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PALETTE_ALLOW_LIST, UNREGISTERED_ACTIONS } from './unregistered-actions';

/**
 * Real, currently-open epic ids this repo tracks, snapshotted 2026-09-20.
 * Only `UNREGISTERED_ACTIONS` (work owed to an epic) is checked against it;
 * allow-list entries are permanent decisions and name no epic.
 */
const KNOWN_OPEN_EPICS = new Set([
  '19.0',
  '20.0',
  '21.0',
  '22.0',
  '23.0',
  '24.0',
  '25.0',
  '26.0',
  '27.0',
  '28.0',
  '29.0',
  '30.0',
  '32.0',
  '33.0',
  '34.0',
  '35.0',
  '36.0',
  '37.0',
  '38.0',
  '39.0',
  '40.0',
  '41.0',
  '8.9',
  '8.15',
  '13.0',
  '42.0',
  '53.0',
  '70.0',
]);

// repo root is two levels up from client-admin/src
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIALOG_MARKUP = /<Dialog\b|DialogContent|<Sheet\b|SheetContent|<FullPageShell\b/;

describe('unregistered-actions.ts', () => {
  it('every deferred file exists and names a known open epic', () => {
    for (const entry of UNREGISTERED_ACTIONS) {
      expect(existsSync(path.join(REPO_ROOT, entry.file)), `missing file: ${entry.file}`).toBe(
        true,
      );
      expect(
        KNOWN_OPEN_EPICS.has(entry.owningEpic),
        `${entry.file} names unknown owningEpic "${entry.owningEpic}"`,
      ).toBe(true);
    }
  });

  describe('PALETTE_ALLOW_LIST', () => {
    it.each(PALETTE_ALLOW_LIST.map((entry) => [entry.file, entry] as const))(
      '%s: exists, has a reason, and still holds dialog markup',
      (file, entry) => {
        const abs = path.join(REPO_ROOT, file);
        expect(existsSync(abs), `missing file: ${file}`).toBe(true);
        expect(entry.reason.trim().length, `${file} has no reason`).toBeGreaterThan(0);
        expect(
          DIALOG_MARKUP.test(readFileSync(abs, 'utf8')),
          `${file} no longer holds dialog markup - remove its allow-list entry`,
        ).toBe(true);
      },
    );

    it('has no duplicates and does not overlap UNREGISTERED_ACTIONS', () => {
      const files = PALETTE_ALLOW_LIST.map((entry) => entry.file);
      expect(new Set(files).size).toBe(files.length);
      const deferred = new Set(UNREGISTERED_ACTIONS.map((entry) => entry.file));
      expect(files.filter((file) => deferred.has(file))).toEqual([]);
    });
  });
});
