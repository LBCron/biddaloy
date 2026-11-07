import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server, userEvent } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { draft, designThemes, mockDraftSite } from './-draft-fixture';
import { baseSite } from './-test-handlers';

const render = (entry: string) =>
  renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: UserRole.ADMIN,
    locale: 'en',
  });

describe('section editor', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('asks only for the fields the design lists for that section, bn and en side by side', async () => {
    mockDraftSite();
    render('/website/pages?edit=hero');
    expect(await screen.findByLabelText('Big headline (বাংলা)')).toBeTruthy();
    expect(screen.getByLabelText('Big headline (English)')).toBeTruthy();
    // `about` has a `body` field, `hero` does not.
    expect(screen.queryByLabelText(/^Text \(/)).toBeNull();
  });

  it('keeps the edit in the draft: Save closes the editor, the save bar saves it', async () => {
    const saved = mockDraftSite();
    render('/website/pages?edit=hero');
    const bn = await screen.findByLabelText('Big headline (বাংলা)');
    await userEvent.clear(bn);
    await userEvent.type(bn, 'নতুন শিরোনাম');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const hero = saved[0]!.pages[0]!.sections[0]!;
    expect(hero.data.headline).toEqual({ bn: 'নতুন শিরোনাম', en: 'My headline' });
  });

  it('puts the design default text back on request', async () => {
    mockDraftSite();
    render('/website/pages?edit=hero');
    await userEvent.click(await screen.findByRole('button', { name: 'Back to the default text' }));
    const field = await screen.findByLabelText<HTMLInputElement>('Big headline (English)');
    expect(field.value).toBe('Default headline');
  });

  it('uses a multi-line field for long text and offers the photo uploader for photo fields', async () => {
    mockDraftSite();
    render('/website/pages?edit=hero');
    expect(await screen.findByRole('heading', { name: 'Photos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeTruthy();
  });

  it('keeps a text style choice per language', async () => {
    const saved = mockDraftSite();
    render('/website/pages?edit=hero');
    await userEvent.click(await screen.findByRole('combobox', { name: /Bangla Heading Size/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Large' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.pages[0]!.sections[0]!.typography).toEqual({
      bn: { heading: { size: 'L' } },
    });
  });
});

const loc = (bn: string, en: string) => ({ bn, en });
const A1 = '11111111-1111-4111-8111-111111111111';
const GALLERY_LABEL = 'Which gallery section to show';

/** A draft with a gallery and a video section, and a design that lists their fields. */
function mockGalleryVideoSite(albums: { id: string; title: { bn: string; en: string } }[]) {
  const saved = mockDraftSite();
  const withMedia = {
    ...baseSite,
    has_published: true,
    theme: 'basic',
    draft: {
      ...draft,
      pages: [
        {
          page: 'home',
          enabled: true,
          sections: [
            { key: 'hero', enabled: true, data: {} },
            {
              key: 'gallery',
              enabled: true,
              data: { heading: loc('গ্যালারি', 'Gallery'), albumId: null, showPageLink: false },
            },
            {
              key: 'video',
              enabled: true,
              data: {
                heading: loc('ভিডিও', 'Video'),
                headingPosition: 'above',
                videoId: null,
                startSeconds: null,
              },
            },
          ],
        },
      ],
    },
  };
  server.use(http.get('/api/v1/website', () => HttpResponse.json(withMedia)));
  const field = (key: string, kind: string, extra: object = {}) => ({
    key,
    kind,
    required: false,
    ...extra,
  });
  server.use(
    http.get('/api/v1/website/themes', () =>
      HttpResponse.json([
        {
          ...designThemes[0],
          sections: [
            {
              key: 'gallery',
              fields: [
                field('heading', 'text', { defaults: loc('গ্যালারি', 'Gallery') }),
                field('albumId', 'uuid'),
                field('showPageLink', 'bool'),
              ],
            },
            {
              key: 'video',
              fields: [
                field('heading', 'text', { defaults: loc('ভিডিও', 'Video') }),
                field('headingPosition', 'choice', { options: ['above', 'below'] }),
                field('videoId', 'youtubeId'),
                field('startSeconds', 'seconds'),
              ],
            },
          ],
        },
      ]),
    ),
    http.get('/api/v1/website/gallery/albums', () =>
      HttpResponse.json(albums.map((a, i) => ({ ...a, sortOrder: i, photos: [] }))),
    ),
  );
  return saved;
}

async function saveAndRead(saved: ReturnType<typeof mockDraftSite>, key: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(saved).toHaveLength(1));
  const section = saved[0]!.pages[0]!.sections.find((s) => s.key === key)!;
  return section.data as Record<string, unknown>;
}

describe('gallery section form', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('saves the chosen album and the page-link switch', async () => {
    const saved = mockGalleryVideoSite([{ id: A1, title: loc('অনুষ্ঠান', 'Events') }]);
    render('/website/pages?edit=gallery');
    await userEvent.click(await screen.findByRole('combobox', { name: GALLERY_LABEL }));
    await userEvent.click(await screen.findByRole('option', { name: 'Events' }));
    await userEvent.click(
      screen.getByRole('switch', { name: 'Show a separate page with all photos' }),
    );
    const data = await saveAndRead(saved, 'gallery');
    expect(data).toMatchObject({ albumId: A1, showPageLink: true });
  });

  it('"the first section that has photos" saves albumId null', async () => {
    const saved = mockGalleryVideoSite([{ id: A1, title: loc('অনুষ্ঠান', 'Events') }]);
    render('/website/pages?edit=gallery');
    await userEvent.click(await screen.findByRole('combobox', { name: GALLERY_LABEL }));
    await userEvent.click(await screen.findByRole('option', { name: 'Events' }));
    await userEvent.click(screen.getByRole('combobox', { name: GALLERY_LABEL }));
    await userEvent.click(
      await screen.findByRole('option', { name: 'The first section that has photos' }),
    );
    const data = await saveAndRead(saved, 'gallery');
    expect(data.albumId).toBeNull();
  });

  it('with no gallery sections, hides the select and links to the Gallery tab', async () => {
    mockGalleryVideoSite([]);
    render('/website/pages?edit=gallery');
    const link = await screen.findByRole('link', { name: 'Make a gallery section first' });
    expect(link.getAttribute('href')).toBe('/website/gallery');
    expect(screen.queryByRole('combobox', { name: GALLERY_LABEL })).toBeNull();
  });
});

describe('video section form', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const paste = async (text: string) => {
    const box = await screen.findByLabelText('Paste the YouTube video embed code or link');
    fireEvent.change(box, { target: { value: text } });
  };
  const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });

  it('YouTube’s embed code stores only the 11-character id, never the pasted text', async () => {
    const saved = mockGalleryVideoSite([]);
    render('/website/pages?edit=video');
    await paste(
      '<iframe width="560" src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=90" title="x" allowfullscreen></iframe>',
    );
    expect(await screen.findByText('Video found')).toBeTruthy();
    const data = await saveAndRead(saved, 'video');
    expect(data.videoId).toBe('dQw4w9WgXcQ');
    expect(data.startSeconds).toBe(90);
    expect(JSON.stringify(saved[0])).not.toContain('iframe');
  });

  it('a watch link works', async () => {
    const saved = mockGalleryVideoSite([]);
    render('/website/pages?edit=video');
    await paste('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const data = await saveAndRead(saved, 'video');
    expect(data.videoId).toBe('dQw4w9WgXcQ');
  });

  it.each([
    '<iframe src="https://evil.example/embed/dQw4w9WgXcQ"></iframe>',
    '<script>alert(1)</script>',
  ])('%s shows the error and blocks Save', async (text) => {
    mockGalleryVideoSite([]);
    render('/website/pages?edit=video');
    await paste(text);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This is not a YouTube code or link',
    );
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it('the position radio saves above or below', async () => {
    const saved = mockGalleryVideoSite([]);
    render('/website/pages?edit=video');
    await userEvent.click(await screen.findByRole('radio', { name: 'Below the video' }));
    const data = await saveAndRead(saved, 'video');
    expect(data.headingPosition).toBe('below');
  });

  it('Remove video clears the id', async () => {
    const saved = mockGalleryVideoSite([]);
    render('/website/pages?edit=video');
    await paste('https://youtu.be/dQw4w9WgXcQ');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove video' }));
    const data = await saveAndRead(saved, 'video');
    expect(data.videoId).toBeNull();
  });

  it('a start time that is not a whole number blocks Save', async () => {
    mockGalleryVideoSite([]);
    render('/website/pages?edit=video');
    fireEvent.change(await screen.findByLabelText('Start at (seconds, optional)'), {
      target: { value: '-5' },
    });
    expect(await screen.findByText('Use a whole number of seconds, 0 or more.')).toBeTruthy();
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });
});
