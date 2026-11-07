import { SitePage, SiteSectionKey, SiteTheme, type SiteConfig } from '@biddaloy/shared';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  moveSection,
  setPalette,
  setSectionData,
  setTheme,
  toggleSection,
  useCreatePost,
  useDeleteEnquiry,
  useDeletePost,
  useMarkEnquirySeen,
  usePublishPost,
  useUpdatePost,
  useUpsertWebTeacher,
} from './use-website-content';

const section = (key: SiteSectionKey, data: Record<string, unknown> = {}) => ({
  key,
  enabled: true,
  data,
});

const config = {
  theme: SiteTheme.BASIC,
  palette: 'blue',
  pages: [
    {
      page: SitePage.HOME,
      enabled: true,
      sections: [
        section(SiteSectionKey.HERO),
        section(SiteSectionKey.ABOUT, { title: { bn: 'ক', en: 'a' } }),
        section(SiteSectionKey.NOTICES),
        section(SiteSectionKey.TEACHERS),
      ],
    },
  ],
} as unknown as SiteConfig;

const keys = (c: SiteConfig) => c.pages[0]!.sections.map((s) => s.key);

describe('draft helpers', () => {
  it('moveSection never moves the pinned hero, nor moves anything onto it', () => {
    expect(keys(moveSection(config, SitePage.HOME, 0, 2))).toEqual(keys(config));
    expect(keys(moveSection(config, SitePage.HOME, 2, 0))).toEqual(keys(config));
  });

  it('moveSection swaps the movable ones and leaves the input alone', () => {
    const next = moveSection(config, SitePage.HOME, 1, 3);
    expect(keys(next)).toEqual(['hero', 'notices', 'teachers', 'about']);
    expect(keys(config)[1]).toBe('about');
  });

  it('moveSection ignores an out-of-range index', () => {
    expect(keys(moveSection(config, SitePage.HOME, 1, 9))).toEqual(keys(config));
  });

  it('toggleSection keeps the section data', () => {
    const off = toggleSection(config, SitePage.HOME, SiteSectionKey.ABOUT, false);
    const about = off.pages[0]!.sections[1]!;
    expect(about.enabled).toBe(false);
    expect(about.data).toEqual({ title: { bn: 'ক', en: 'a' } });
    expect(
      toggleSection(off, SitePage.HOME, SiteSectionKey.ABOUT, true).pages[0]!.sections[1]!.enabled,
    ).toBe(true);
  });

  it('setSectionData / setPalette / setTheme change only their own field', () => {
    const d = setSectionData(config, SitePage.HOME, SiteSectionKey.NOTICES, { x: 1 });
    expect(d.pages[0]!.sections[2]!.data).toEqual({ x: 1 });
    expect(setPalette(config, 'green').palette).toBe('green');
    expect(setTheme(config, SiteTheme.PREMIUM).pages).toBe(config.pages);
  });
});

const fail = () => HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 });

/** Each mutation answers 500 once and must not be retried. */
const cases: [string, 'post' | 'put' | 'delete', string, () => unknown, boolean][] = [
  ['create post', 'post', '/api/v1/website/posts', () => useCreatePost(), true],
  ['update post', 'put', '/api/v1/website/posts/p1', () => useUpdatePost(), false],
  ['publish post', 'post', '/api/v1/website/posts/p1/publish', () => usePublishPost(), true],
  ['delete post', 'delete', '/api/v1/website/posts/p1', () => useDeletePost(), false],
  ['mark seen', 'post', '/api/v1/website/enquiries/e1/seen', () => useMarkEnquirySeen(), false],
  ['delete enquiry', 'delete', '/api/v1/website/enquiries/e1', () => useDeleteEnquiry(), false],
  ['upsert teacher', 'put', '/api/v1/website/teachers/u1', () => useUpsertWebTeacher(), false],
];

const arg: Record<string, unknown> = {
  'create post': { kind: 'POST', title: { bn: 'ক', en: 'a' }, body: [] },
  'update post': { id: 'p1', kind: 'POST', title: { bn: 'ক', en: 'a' }, body: [] },
  'publish post': { id: 'p1' },
  'delete post': 'p1',
  'mark seen': 'e1',
  'delete enquiry': 'e1',
  'upsert teacher': { userId: 'u1', show_on_website: true, featured: false, subjects: [] },
};

describe('content mutations', () => {
  it.each(cases)('%s is not retried', async (name, method, url, hook, needsKey) => {
    let calls = 0;
    let key: string | null = null;
    server.use(
      http[method](url, ({ request }) => {
        calls += 1;
        key = request.headers.get('Idempotency-Key');
        return fail();
      }),
    );
    const { result } = renderHookWithProviders(
      hook as () => {
        mutate: (v: unknown) => void;
        isError: boolean;
      },
      { tenantId: 't1' },
    );
    result.current.mutate(arg[name]);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
    if (needsKey) expect(key).toBeTruthy();
  });
});
