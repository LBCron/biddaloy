import type { Page } from '@playwright/test';

/**
 * [8.5.4] Determinism kit — every visual capture goes through this.
 * Frozen clock, no animations/transitions/carets, fonts loaded. Data
 * determinism comes from the seeded DB; specs must not create
 * time-or-random-named records for captured screens.
 */

export const FROZEN_TIME = new Date('2026-01-15T10:00:00+06:00');

const KILL_MOTION_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
`;

const prepared = new WeakSet<Page>();

/** Idempotent per page: the clock and the CSS are init scripts, so they
 * survive every later navigation (addStyleTag would not). */
export async function applyDeterminism(page: Page): Promise<void> {
  if (prepared.has(page)) return;
  prepared.add(page);
  await page.clock.install({ time: FROZEN_TIME });
  await page.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    });
  }, KILL_MOTION_CSS);
}

/** Call after navigation, immediately before the capture. */
export async function readyForCapture(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}

/** Baselines are Linux-only (font rendering differs per platform) —
 * refuse to compare or write them anywhere else. */
export function assertLinux(): void {
  if (process.platform !== 'linux' && process.env.ALLOW_NON_LINUX_VISUAL !== '1') {
    throw new Error(
      'The visual suite only runs on Linux (baselines are rendered in the pinned ' +
        'Playwright Docker image). Use `yarn e2e:visual:update` / CI, or set ' +
        'ALLOW_NON_LINUX_VISUAL=1 if you really know what you are doing.',
    );
  }
}
