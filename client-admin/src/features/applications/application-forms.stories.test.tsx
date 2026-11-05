/**
 * [52.4.3] Smoke test: client-admin stories aren't in any Storybook build, so
 * render every story of the forms file once. Fails on a thrown error or a
 * missing i18n key. Stories with a `play` (ValidationError) are not run — only
 * the first render is checked.
 */
import { useTranslation } from '@biddaloy/ui/i18n';
import { server } from '@biddaloy/ui/test';
import { composeStories } from '@storybook/react-vite';
import type { RequestHandler } from 'msw';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { missingKeysOf } from '../../test/missing-keys';

import * as storyModule from './application-forms.stories';

const stories = composeStories(storyModule as never) as Record<
  string,
  React.ComponentType & { parameters?: { msw?: { handlers?: RequestHandler[] } } }
>;

describe('application forms stories', () => {
  it('the missing-key check catches a key that does not exist', async () => {
    // The key comes in as a prop so `check:i18n`'s static scan doesn't flag this deliberate miss.
    function Broken({ k }: { k: string }) {
      const { t } = useTranslation('applicationForms');
      return <p>{t(k)}</p>;
    }
    expect(await missingKeysOf(<Broken k="fields.doesNotExist" />)).toContain(
      'applicationForms:fields.doesNotExist',
    );
  });

  it.each(Object.entries(stories))('%s renders with no missing i18n key', async (_name, Story) => {
    server.use(...(Story.parameters?.msw?.handlers ?? []));
    expect(await missingKeysOf(<Story />)).toEqual([]);
  });
});
