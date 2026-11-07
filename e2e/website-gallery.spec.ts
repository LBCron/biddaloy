import sharp from 'sharp';
import {
  activateInvite,
  provisionSchool,
  resendSchoolAdminInvitation,
  superAdminApiSession,
} from './api';
import type { ApiSession } from './api';
import { shells } from './config';
import { expect, test } from './fixtures/test';
import { t } from './i18n';

/**
 * [40.6.10 #3671] Gallery and video, admin to public.
 *
 * 1. The ADMIN makes a gallery section on Website > Gallery, adds three 1200x800 JPEGs (through the API: see the note in the test), and the public home page feed carries all three. Deleting one
 *    drops the photo-space bar and the public feed. Turning the page link off makes the public
 *    gallery page answer 404.
 * 2. A video section takes only a public YouTube id: a pasted link is a 400, a good id comes back
 *    on the public home page as the id alone.
 *
 * The public side is read through the API (`page/<name>`), because the e2e stack does not run the
 * site container; rendering is covered by `site/`. Own school, like `website-themes.spec.ts`.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

interface Section {
  key: string;
  enabled: boolean;
  data: Record<string, unknown>;
  feed?: { photos: unknown[] }[];
}
interface Config {
  pages: { page: string; enabled: boolean; sections: Section[] }[];
}
interface Site {
  subdomain: string;
  version: number;
  draft_revision: number;
  draft: Config;
}

const jpeg = (n: number) =>
  sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 40 * n, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();

test('gallery: upload, public carousel, delete a photo, page link off', async ({
  browser,
  playwright,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const setup = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  const superAdmin = await superAdminApiSession(setup);
  const provisioned = await provisionSchool(
    setup,
    superAdmin,
    `E2E Gallery School ${suffix}`,
    `e2e-gallery-school-${suffix}`,
    'Gallery Admin',
    `gallery-admin-${suffix}@e2e.example.com`,
  );
  const token = await resendSchoolAdminInvitation(
    setup,
    superAdmin,
    provisioned.schoolId,
    provisioned.adminUserId,
  );
  const activated = await activateInvite(setup, token, 'A-strong-gallery-pw-1');
  const session: ApiSession = { token: activated.token, tenantId: activated.tenantId };
  const headers = { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId };
  const state = await setup.storageState();
  const context = await browser.newContext({
    storageState: {
      ...state,
      origins: [
        {
          origin: shells.app.baseURL.replace(/\/$/, ''),
          localStorage: [
            {
              name: 'biddaloy:activeTenant',
              value: JSON.stringify({ tenantId: activated.tenantId, role: activated.role }),
            },
          ],
        },
      ],
    },
  });
  const page = await context.newPage();

  const read = async <T>(path: string) => {
    const r = await setup.get(`/api/v1${path}`, { headers });
    expect(r.ok(), `GET ${path}: ${r.status()}`).toBe(true);
    return (await r.json()) as T;
  };
  const usedBytes = async () => (await read<{ usedBytes: number }>('/website/media')).usedBytes;
  /** Edit the draft through the API, publish it, return the site. */
  const publishWith = async (edit: (c: Config) => void): Promise<Site> => {
    let site = await read<Site>('/website');
    edit(site.draft);
    const saved = await setup.put('/api/v1/website/draft', {
      headers,
      data: { config: site.draft, draft_revision: site.draft_revision },
    });
    expect(saved.ok(), `draft: ${saved.status()} ${await saved.text()}`).toBe(true);
    site = await read<Site>('/website');
    const published = await setup.post('/api/v1/website/publish', {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: { version: site.version, draft_revision: site.draft_revision },
    });
    expect(published.ok(), `publish: ${published.status()}`).toBe(true);
    return read<Site>('/website');
  };
  const publicPage = (site: Site, name: string) =>
    setup.get(`/api/v1/public/site/by-host/${site.subdomain}.sites.e2e.test/page/${name}`);
  const gallerySection = async (site: Site, name: string) => {
    const r = await publicPage(site, name);
    expect(r.ok(), `page/${name}: ${r.status()}`).toBe(true);
    const body = (await r.json()) as { data?: { sections: Section[] }; sections?: Section[] };
    const sections = body.data?.sections ?? body.sections ?? [];
    return sections.find((s) => s.key === 'gallery');
  };
  const photosIn = (s: Section | undefined) =>
    (s?.feed ?? []).reduce((n, album) => n + album.photos.length, 0);

  try {
    await page.goto('/website/gallery');
    await test.step('admin makes a gallery section', async () => {
      await page.getByRole('button', { name: t('website.gallery.newSection') }).first().click();
      await expect(
        page.getByRole('button', { name: t('website.gallery.deleteSection') }),
      ).toBeVisible();
    });

    // Photos go in through the API with a caption. The page's own file picker is NOT used: a photo
    // without a caption crashes the admin tab (`caption` is null, the card reads `caption.bn`), see the
    // bug listed in the #3671 report. The server wants the exact 1200x800 size the page would produce.
    const [album] = await read<{ id: string }[]>('/website/gallery/albums');
    for (const n of [1, 2, 3]) {
      const up = await setup.post(`/api/v1/website/gallery/albums/${album.id}/photos`, {
        headers,
        multipart: {
          file: { name: `photo-${n}.jpg`, mimeType: 'image/jpeg', buffer: await jpeg(n) },
          caption: JSON.stringify({ bn: `ছবি ${n}`, en: `Photo ${n}` }),
        },
      });
      expect(up.ok(), `photo ${n}: ${up.status()} ${await up.text()}`).toBe(true);
    }
    await page.reload();
    await expect(
      page.getByRole('button', { name: t('website.gallery.removePhoto', { position: 3 }) }),
    ).toBeVisible();

    const albums = await read<{ id: string; photos: { id: string }[] }[]>('/website/gallery/albums');
    expect(albums).toHaveLength(1);
    expect(albums[0].photos).toHaveLength(3);
    const before = await usedBytes();
    expect(before).toBeGreaterThan(0);

    let site = await publishWith((c) => {
      const s = c.pages
        .find((p) => p.page === 'home')!
        .sections.find((x) => x.key === 'gallery')!;
      s.enabled = true;
      s.data.albumId = albums[0].id;
      s.data.showPageLink = true;
    });
    const enabled = await setup.post('/api/v1/website/enabled', { headers, data: { enabled: true } });
    expect(enabled.ok(), `enable: ${enabled.status()}`).toBe(true);

    await test.step('the public home page carries all three photos, and so does the gallery page', async () => {
      expect(photosIn(await gallerySection(site, 'home'))).toBe(3);
      expect(photosIn(await gallerySection(site, 'gallery'))).toBe(3);
    });

    await test.step('deleting one photo drops the usage and the public feed', async () => {
      await page.reload();
      await page.getByRole('button', { name: t('website.gallery.removePhoto', { position: 1 }) }).click();
      await page.getByRole('button', { name: t('website.gallery.removePhotoYes'), exact: true }).click();
      await expect(
        page.getByRole('button', { name: t('website.gallery.removePhoto', { position: 3 }) }),
      ).toHaveCount(0);
      expect(await usedBytes()).toBeLessThan(before);
      expect(photosIn(await gallerySection(site, 'home'))).toBe(2);
    });

    await test.step('turning the page link off makes the gallery page a 404', async () => {
      site = await publishWith((c) => {
        const home = c.pages.find((p) => p.page === 'home')!;
        home.sections.find((x) => x.key === 'gallery')!.data.showPageLink = false;
        c.pages.find((p) => p.page === 'gallery')!.enabled = false;
      });
      expect((await publicPage(site, 'gallery')).status()).toBe(404);
      expect(photosIn(await gallerySection(site, 'home'))).toBe(2);
    });
  } finally {
    await context.close();
    await setup.dispose();
  }
});

test('video: only a public YouTube id is accepted and published', async ({ playwright }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const setup = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    const superAdmin = await superAdminApiSession(setup);
    const provisioned = await provisionSchool(
      setup,
      superAdmin,
      `E2E Video School ${suffix}`,
      `e2e-video-school-${suffix}`,
      'Video Admin',
      `video-admin-${suffix}@e2e.example.com`,
    );
    const token = await resendSchoolAdminInvitation(
      setup,
      superAdmin,
      provisioned.schoolId,
      provisioned.adminUserId,
    );
    const activated = await activateInvite(setup, token, 'A-strong-video-pw-1');
    const headers = {
      Authorization: `Bearer ${activated.token}`,
      'X-Tenant-ID': activated.tenantId,
    };
    const site = (await (await setup.get('/api/v1/website', { headers })).json()) as Site;
    const video = site.draft.pages
      .find((p) => p.page === 'home')!
      .sections.find((s) => s.key === 'video')!;
    video.enabled = true;

    // A pasted link is not an id: refused, fixed sentence (the draft keeps its last good state).
    video.data.videoId = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
    const bad = await setup.put('/api/v1/website/draft', {
      headers,
      data: { config: site.draft, draft_revision: site.draft_revision },
    });
    expect(bad.status()).toBe(400);

    video.data.videoId = 'aqz-KE-bpKQ';
    video.data.headingPosition = 'below';
    const good = await setup.put('/api/v1/website/draft', {
      headers,
      data: { config: site.draft, draft_revision: site.draft_revision },
    });
    expect(good.ok(), `draft: ${good.status()}`).toBe(true);
    const fresh = (await (await setup.get('/api/v1/website', { headers })).json()) as Site;
    const published = await setup.post('/api/v1/website/publish', {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: { version: fresh.version, draft_revision: fresh.draft_revision },
    });
    expect(published.ok(), `publish: ${published.status()}`).toBe(true);
    await setup.post('/api/v1/website/enabled', { headers, data: { enabled: true } });

    const home = await setup.get(
      `/api/v1/public/site/by-host/${fresh.subdomain}.sites.e2e.test/page/home`,
    );
    expect(home.ok(), `page/home: ${home.status()}`).toBe(true);
    const text = await home.text();
    expect(text).toContain('aqz-KE-bpKQ');
    expect(text).not.toContain('youtube.com'); // the id alone, never a link
  } finally {
    await setup.dispose();
  }
});
