import { i18n } from '@biddaloy/ui/i18n';
import { renderWithProviders } from '@biddaloy/ui/test';
import { waitFor } from '@testing-library/react';
import type * as React from 'react';
import { expect } from 'vitest';

/**
 * Renders `ui` and returns the keys it looked up that exist in no loaded resource. Used by the
 * story smoke tests: client-admin stories are in no Storybook build, so a test is what renders them.
 * i18next only emits `missingKey` with `saveMissing` on, so it is switched on for the
 * render, with a no-op `missingKeyHandler` (without one, the backend connector writes the
 * key into the store as its own value, and it would never look missing again). A lookup
 * made before its namespace finished loading also fires, so each hit is re-checked once
 * everything settled: only keys still missing then are reported.
 */
export async function missingKeysOf(ui: React.ReactElement): Promise<string[]> {
  const hits: { lng: string; ns: string; key: string }[] = [];
  const onMissing = (lngs: readonly string[], ns: string, key: string) =>
    hits.push({ lng: lngs[0] ?? i18n.language, ns, key });
  const { saveMissing, missingKeyHandler } = i18n.options;
  i18n.options.saveMissing = true;
  i18n.options.missingKeyHandler = () => undefined;
  i18n.on('missingKey', onMissing);
  try {
    const { container, queryClient, localeReady } = renderWithProviders(ui);
    await localeReady;
    // A dialog or full-page modal portals out of `container`, straight into `body`.
    await waitFor(() =>
      expect(container.childElementCount + document.body.childElementCount).toBeGreaterThan(1),
    );
    await waitFor(() => expect(queryClient.isFetching()).toBe(0)); // lookups settled
    return hits
      .filter(({ lng, ns, key }) => !i18n.exists(key, { lng, ns }))
      .map(({ ns, key }) => `${ns}:${key}`);
  } finally {
    i18n.off('missingKey', onMissing);
    i18n.options.saveMissing = saveMissing ?? false;
    i18n.options.missingKeyHandler = missingKeyHandler ?? false;
  }
}
