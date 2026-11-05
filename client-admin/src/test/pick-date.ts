import { REGION_BD_BN, type RegionConfig } from '@biddaloy/ui/i18n';
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

const PREVIOUS_MONTH = /^(Previous month|আগের মাস)$/;
const NEXT_MONTH = /^(Next month|পরের মাস)$/;

/** A `DatePicker`'s accessible name is `<label>, <text on screen>` (WCAG 2.5.3), so a plain
 * label matches as that prefix; a RegExp is used as given. */
export function dateTriggerName(label: string | RegExp): RegExp {
  if (label instanceof RegExp) return label;
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `);
}

/**
 * Opens a `DatePicker` by its accessible name, steps to the target month and
 * clicks the day. Scoped to the open popover (the last `dialog`, portalled
 * last) so a second picker, or a surrounding dialog, is never touched.
 * `data-date` is Latin ISO in every locale, so `config` is only kept for
 * signature stability.
 */
export async function pickDate(
  user: UserEvent,
  triggerName: string | RegExp,
  iso: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _config: RegionConfig = REGION_BD_BN,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: dateTriggerName(triggerName) }));
  const root = (await screen.findAllByRole('dialog')).at(-1)!;
  const popover = within(root);
  let lastMonth = '';
  for (let i = 0; i < 240; i += 1) {
    const cell = root.querySelector<HTMLElement>(
      `[role="gridcell"][data-date="${iso}"]:not([data-outside])`,
    );
    if (cell) {
      await user.click(cell);
      return;
    }
    const visible = root
      .querySelector('[role="gridcell"]:not([data-outside])')
      ?.getAttribute('data-date')
      ?.slice(0, 7);
    lastMonth = visible ?? lastMonth;
    await user.click(
      popover.getByRole('button', {
        name: iso.slice(0, 7) < (visible ?? '') ? PREVIOUS_MONTH : NEXT_MONTH,
      }),
    );
  }
  throw new Error(`pickDate: ${iso} not reachable; last month seen ${lastMonth}`);
}
