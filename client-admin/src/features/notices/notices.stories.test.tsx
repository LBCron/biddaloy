/**
 * Smoke test: client-admin stories are in no Storybook build, so render every notice story once
 * (the staff list and detail, the link and SMS panels, the SMS page, the reader's list and detail,
 * the Overview card, compose, and the public `/n/<token>` page). Fails on a thrown error or a
 * missing i18n key. Only the first render is checked.
 */
import { server } from '@biddaloy/ui/test';
import { composeStories } from '@storybook/react-vite';
import type { RequestHandler } from 'msw';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { missingKeysOf } from '../../test/missing-keys';

type Story = React.ComponentType & { parameters?: { msw?: { handlers?: RequestHandler[] } } };

const modules = {
  ...import.meta.glob('./**/*.stories.tsx', { eager: true }),
  ...import.meta.glob('../../routes/-public-notice.stories.tsx', { eager: true }),
};

const stories = Object.entries(modules).flatMap(([file, mod]) =>
  Object.entries(composeStories(mod as never) as Record<string, Story>).map(
    ([name, Story]) => [`${file} › ${name}`, Story] as const,
  ),
);

describe('notice stories', () => {
  it('finds the story files', () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(7);
  });

  it.each(stories)('%s renders with no missing i18n key', async (_name, Story) => {
    server.use(...(Story.parameters?.msw?.handlers ?? []));
    expect(await missingKeysOf(<Story />)).toEqual([]);
  });
});
