/**
 * Test data for the Pages and Design specs: a draft with sections and two designs with fields and
 * fonts, plus a `PUT /website/draft` answer that records the config it was sent.
 */
import { server } from '@biddaloy/ui/test';
import { http, HttpResponse } from 'msw';

import { baseSite, mockWebsite } from './-test-handlers';

const loc = (bn: string, en: string) => ({ bn, en });
const vars = (c: string) => ({
  primary: c,
  secondary: c,
  accent: c,
  surface: '#fff',
  ink: '#000',
});

export const draft = {
  theme: 'basic',
  palette: 'green',
  typography: {
    bn: { heading: 'hind-siliguri', body: 'hind-siliguri' },
    en: { heading: 'inter', body: 'inter' },
  },
  announcements: { style: 'static', speed: 'NORMAL', items: [] as unknown[] },
  pages: [
    {
      page: 'home',
      enabled: true,
      sections: [
        { key: 'hero', enabled: true, data: { headline: loc('আমার হেডলাইন', 'My headline') } },
        { key: 'about', enabled: true, data: {} },
        { key: 'notices', enabled: true, data: {} },
        { key: 'teachers', enabled: false, data: {} },
      ],
    },
    { page: 'about', enabled: true, sections: [{ key: 'about', enabled: true, data: {} }] },
  ],
};

const theme = (id: string, name: [string, string], c: string) => ({
  id,
  name: loc(...name),
  palettes: [
    { id: 'green', name: loc('সবুজ', 'Green'), vars: vars(c) },
    { id: 'blue', name: loc('নীল', 'Blue'), vars: vars('#00f') },
  ],
  fonts: {
    bn: [
      { id: 'hind-siliguri', family: 'Hind Siliguri', files: ['hind-siliguri-400-bengali.woff2'] },
      { id: 'noto-serif-bengali', family: 'Noto Serif Bengali', files: ['n-400-bengali.woff2'] },
    ],
    en: [
      { id: 'inter', family: 'Inter', files: ['inter-400-latin.woff2'] },
      { id: 'source-serif', family: 'Source Serif', files: ['s-400-latin.woff2'] },
    ],
  },
  defaultTypography: {
    bn: { heading: 'hind-siliguri', body: 'hind-siliguri' },
    en: { heading: 'inter', body: 'inter' },
  },
  sections: [
    {
      key: 'hero',
      fields: [
        {
          key: 'headline',
          kind: 'text',
          required: true,
          defaults: loc('ডিফল্ট', 'Default headline'),
        },
        { key: 'images', kind: 'images', required: false, slot: 'hero' },
      ],
    },
    {
      key: 'about',
      fields: [
        { key: 'body', kind: 'richtext', required: true, defaults: loc('বিবরণ', 'About text') },
      ],
    },
  ],
  pages: [],
});

export const designThemes = [
  theme('basic', ['বেসিক', 'Basic'], '#0a0'),
  theme('primary', ['প্রাইমারি', 'Primary'], '#a50'),
];

/** The part of a saved draft the specs read. */
export type SavedDraft = typeof draft & {
  pages: Array<{
    page: string;
    enabled: boolean;
    sections: Array<{
      key: string;
      enabled: boolean;
      data: Record<string, unknown>;
      typography?: unknown;
    }>;
  }>;
};

/** Registers the site (with `draft`) and both designs; returns every config the draft was saved with. */
export function mockDraftSite(site: Partial<typeof baseSite> = {}) {
  const saved: SavedDraft[] = [];
  mockWebsite({ has_published: true, theme: 'basic', ...site, draft: draft as never });
  server.use(
    http.get('/api/v1/website/themes', () => HttpResponse.json(designThemes)),
    http.put('/api/v1/website/draft', async ({ request }) => {
      const body = (await request.json()) as { config: SavedDraft };
      saved.push(body.config);
      return HttpResponse.json({
        ...baseSite,
        has_published: true,
        ...site,
        draft: body.config,
        draft_revision: baseSite.draft_revision + saved.length,
      });
    }),
  );
  return saved;
}
