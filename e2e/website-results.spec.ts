import {
  activateInvite,
  applyPreset,
  createClassSection,
  currentAcademicYear,
  newClassSubject,
  post,
  provisionSchool,
  publishedTermExam,
  resendSchoolAdminInvitation,
  superAdminApiSession,
} from './api';
import type { ApiSession } from './api';
import { shells } from './config';
import { expect, test } from './fixtures/test';
import { t } from './i18n';

/**
 * [40.5.09 #3657] Exam results on the school website. The ADMIN opens a PUBLISHED exam, puts its
 * results on the website with the names switch off, checks the public list shows the exam, takes the
 * results off again, and checks the public list no longer shows it.
 *
 * The public side is read through the API (`island/results`), because the e2e stack does not run the
 * site container. Page rendering and the lookup form are covered by `site/` and the server e2e specs.
 *
 * Runs in its own school (like `website-themes.spec.ts`): publishing a site here must not turn the
 * shared school's website into "published" under `journeys/website-setup.spec.ts`. The preset gives
 * the new school a year, classes, subjects and a grading scale, which processing results needs.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

interface Site {
  subdomain: string;
  version: number;
  draft_revision: number;
  draft: { pages: { page: string; enabled: boolean; sections: unknown[] }[] };
}

test('admin puts exam results on the website, hides names, then takes them off', async ({
  browser,
  playwright,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const setup = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  const superAdmin = await superAdminApiSession(setup);
  const provisioned = await provisionSchool(
    setup,
    superAdmin,
    `E2E Results Site ${suffix}`,
    `e2e-results-site-${suffix}`,
    'Results Admin',
    `results-admin-${suffix}@e2e.example.com`,
  );
  const token = await resendSchoolAdminInvitation(
    setup,
    superAdmin,
    provisioned.schoolId,
    provisioned.adminUserId,
  );
  const activated = await activateInvite(setup, token, 'A-strong-results-pw-1');
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

  try {
    await applyPreset(setup, session, {
      presetId: 'bd/nctb',
      startYear: new Date().getFullYear(),
      stages: ['PRIMARY'],
      versions: ['bangla'],
    });
    const year = await currentAcademicYear(setup, session);
    const chain = await createClassSection(setup, session, year);
    const student = await post<{ id: string }>(setup, session, '/students', {
      full_name: `E2E Results Pupil ${suffix}`,
      class_section_id: chain.sectionId,
    });
    const subject = await newClassSubject(setup, session, chain.classId, year.id);
    const examName = `E2E Website Exam ${suffix}`;
    const exam = await publishedTermExam(
      setup,
      session,
      { ...chain, subjectId: subject.id },
      examName,
      { [student.id]: '80.00' },
    );

    // Website on, with the Results page switched on (D12: no theme has it by default).
    const read = async <T>(path: string) => {
      const r = await setup.get(`/api/v1${path}`, { headers });
      expect(r.ok(), `GET ${path}: ${r.status()}`).toBe(true);
      return (await r.json()) as T;
    };
    let site = await read<Site>('/website');
    // The admin's real path (Website > Pages > "Results page" switch > Save draft). That switch exists
    // from accum-23 on; a base without its i18n key falls back to writing the same draft by API.
    let resultsLabel: string | null = null;
    try {
      resultsLabel = t('website.pages.results.show');
    } catch {
      resultsLabel = null;
    }
    if (resultsLabel) {
      await page.goto('/website/pages');
      const sw = page.getByRole('switch', { name: resultsLabel });
      await sw.click();
      await expect(sw).toBeChecked();
      const saved = page.waitForResponse(
        (r) => r.url().includes('/api/v1/website/draft') && r.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: t('website.pages.saveDraft') }).click();
      expect((await saved).ok()).toBe(true);
    } else {
      const config = site.draft;
      const existing = config.pages.find((p) => p.page === 'results');
      if (existing) existing.enabled = true;
      else config.pages.push({ page: 'results', enabled: true, sections: [] });
      const saved = await setup.put('/api/v1/website/draft', {
        headers,
        data: { config, draft_revision: site.draft_revision },
      });
      expect(saved.ok(), `draft: ${saved.status()}`).toBe(true);
    }
    site = await read<Site>('/website');
    const published = await setup.post('/api/v1/website/publish', {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: { version: site.version, draft_revision: site.draft_revision },
    });
    expect(published.ok(), `publish: ${published.status()}`).toBe(true);
    const on = await setup.post('/api/v1/website/enabled', { headers, data: { enabled: true } });
    expect(on.ok(), `enable: ${on.status()}`).toBe(true);
    site = await read<Site>('/website');

    const publicList = async () => {
      const r = await setup.get(
        `/api/v1/public/site/by-host/${site.subdomain}.sites.e2e.test/island/results`,
      );
      expect(r.ok(), `island/results: ${r.status()}`).toBe(true);
      return JSON.stringify(await r.json());
    };

    await test.step('before: the public list does not show the exam', async () => {
      expect(await publicList()).not.toContain(examName);
    });

    await test.step('admin shows the results on the website with names off', async () => {
      await page.goto(`/exams/${exam.id}`);
      await page.getByRole('button', { name: t('exams.website.publish') }).click();
      const names = page.getByRole('switch', { name: new RegExp(t('exams.website.showNames')) });
      await expect(names).toBeChecked(); // names are on by default (D36)
      await names.click();
      await expect(names).not.toBeChecked();
      await page.getByRole('button', { name: t('exams.website.publishConfirm') }).click();
      await expect(page.getByText(t('exams.website.published'))).toBeVisible();
    });

    await test.step('the exam keeps the names switch and the public list shows it', async () => {
      const saved = await read<{ website_published_at: string | null; website_show_names: boolean }>(
        `/exams/${exam.id}`,
      );
      expect(saved.website_published_at).not.toBeNull();
      expect(saved.website_show_names).toBe(false);
      expect(await publicList()).toContain(examName);
    });

    await test.step('admin takes the results off and the public list drops the exam', async () => {
      await page.reload();
      await page.getByRole('button', { name: t('exams.website.unpublish') }).click();
      await page.getByRole('button', { name: t('exams.website.unpublishConfirm') }).click();
      await expect(page.getByText(t('exams.website.unpublished'))).toBeVisible();
      expect(await publicList()).not.toContain(examName);
    });
  } finally {
    await context.close();
    await setup.dispose();
  }
});
