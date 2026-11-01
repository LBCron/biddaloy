/** [#3293] Test helpers: render a component under the help index and check a (?) is on the page. */
import { HelpProvider } from '@biddaloy/ui/components';
import { waitFor } from '@testing-library/react';
import type * as React from 'react';
import { expect } from 'vitest';

import { HELP_INDEX } from './help-index.gen';

export function withHelp(ui: React.ReactElement) {
  return (
    <HelpProvider index={HELP_INDEX} lang="en" baseUrl="https://guide.test">
      {ui}
    </HelpProvider>
  );
}

/** The (?) mounts once its field-text namespace has loaded, so wait for it. */
export async function expectHelp(id: string) {
  await waitFor(() => expect(document.querySelector(`[data-help-id="${id}"]`)).not.toBeNull());
}
