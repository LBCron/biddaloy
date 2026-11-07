/** MSW answers for the `/website` route tests (shared by index and wizard specs). */
import { server } from '@biddaloy/ui/test';
import { http, HttpResponse } from 'msw';

export const baseSite = {
  theme: 'BASIC',
  palette: 'green',
  enabled: false,
  noindex: false,
  subdomain: 'green-valley-1a2b',
  custom_domain: null,
  custom_domain_status: null,
  version: 1,
  draft_revision: 3,
  published_at: null,
  has_published: false,
  has_unpublished_changes: true,
  draft: { theme: 'BASIC', palette: 'green', pages: [] },
};

const palette = (id: string, en: string) => ({
  id,
  name: { bn: en, en },
  vars: { primary: '#0a0', secondary: '#0b0', accent: '#0c0', surface: '#fff', ink: '#000' },
});

export const themes = [
  {
    id: 'BASIC',
    name: { bn: 'সাধারণ', en: 'Basic' },
    palettes: [palette('green', 'Green'), palette('blue', 'Blue')],
    fonts: { bn: [], en: [] },
    defaultTypography: {},
    sections: [],
    pages: [],
  },
];

/** Registers the read routes; returns the order write calls arrive in. */
export function mockWebsite(site: Partial<typeof baseSite> = {}, taken: string[] = []) {
  const calls: string[] = [];
  let current = { ...baseSite, ...site };
  server.use(
    http.get('/api/v1/website', () => HttpResponse.json(current)),
    http.get('/api/v1/website/themes', () => HttpResponse.json(themes)),
    http.get('/api/v1/website/subdomain/suggest', () =>
      HttpResponse.json({ suggestions: ['green-valley', 'gvs'] }),
    ),
    http.get('/api/v1/website/subdomain/check', ({ request }) =>
      HttpResponse.json({
        available: !taken.includes(new URL(request.url).searchParams.get('value') ?? ''),
      }),
    ),
    http.get('/api/v1/website/media', () =>
      HttpResponse.json({ items: [], usedBytes: 12 * 1024 * 1024, quotaBytes: 100 * 1024 * 1024 }),
    ),
    http.get('/api/v1/website/preview-token', () =>
      HttpResponse.json({ url: 'https://rumsc.example.test/?preview=abc' }),
    ),
    http.put('/api/v1/website/subdomain', async ({ request }) => {
      const body = (await request.json()) as { value: string };
      calls.push(`rename:${body.value}`);
      current = { ...current, subdomain: body.value };
      return HttpResponse.json(current);
    }),
    http.put('/api/v1/website/draft', async ({ request }) => {
      const body = (await request.json()) as { config: { palette: string } };
      calls.push(`save:${body.config.palette}`);
      current = {
        ...current,
        draft_revision: current.draft_revision + 1,
        has_unpublished_changes: true,
      };
      return HttpResponse.json(current);
    }),
    http.post('/api/v1/website/publish', async ({ request }) => {
      const body = (await request.json()) as { version: number; draft_revision: number };
      calls.push(`publish:${body.version}:${body.draft_revision}`);
      current = {
        ...current,
        version: current.version + 1,
        has_published: true,
        has_unpublished_changes: false,
      };
      return HttpResponse.json(current);
    }),
    http.post('/api/v1/website/enabled', async ({ request }) => {
      const body = (await request.json()) as { enabled: boolean };
      calls.push(`enabled:${body.enabled}`);
      current = { ...current, enabled: body.enabled };
      return HttpResponse.json(current);
    }),
  );
  return calls;
}
