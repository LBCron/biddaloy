import { UserRole } from '@biddaloy/shared';
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { academicYearFactory, classFactory, examFactory } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';
import { baseSite, mockWebsite } from '../../website/-test-handlers';


afterEach(async () => {
  await cleanupTestState();
});

const year = academicYearFactory({ id: 'year-1', name: '2026-2027' });
const klass = classFactory({ id: 'class-7', name: 'Class 7' });

function setup(exam: Record<string, unknown> = {}, siteOn = true) {
  const calls: string[] = [];
  const doc = examFactory({
    id: 'exam-1',
    name: 'Half Yearly 2026',
    status: 'PUBLISHED',
    academic_year: year,
    academic_year_id: year.id,
    class: klass,
    class_id: klass.id,
    ...exam,
  } as never);
  mockWebsite(siteOn ? { enabled: true, has_published: true } : {});
  server.use(
    http.get('/api/v1/exams/:id', () => HttpResponse.json(doc)),
    http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
    http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)),
    http.get('/api/v1/exams/:examId/results', () => HttpResponse.json([])),
    http.get('/api/v1/exams/:examId/marks/progress', () =>
      HttpResponse.json({ counts: {}, outstanding: [] }),
    ),
    http.patch('/api/v1/exams/exam-1/website-names', async ({ request }) => {
      const b = (await request.json()) as { showNames: boolean };
      calls.push(`names:${b.showNames}`);
      return HttpResponse.json(b);
    }),
    http.post('/api/v1/exams/exam-1/website-publish', () => {
      calls.push('publish');
      return HttpResponse.json({ websitePublished: true });
    }),
    http.post('/api/v1/exams/exam-1/website-unpublish', () => {
      calls.push('unpublish');
      return HttpResponse.json({ websitePublished: false });
    }),
  );
  renderWithRouter(routeTree, {
    initialEntries: ['/exams/exam-1'],
    tenantId: 'tenant-1',
    role: UserRole.ADMIN,
    locale: 'en',
  });
  return calls;
}

describe('WebsitePublishDialog', () => {
  it('publishes with names on by default, saving no names change', async () => {
    const calls = setup({ website_show_names: true });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Show results on the website' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Student names will also be shown/)).toBeTruthy();
    expect(within(dialog).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show on website' }));
    await waitFor(() => expect(calls).toEqual(['publish']));
  });

  it('turning names off saves that first, then publishes', async () => {
    const calls = setup({ website_show_names: true });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Show results on the website' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('switch'));
    expect(within(dialog).getByText(/Student names will not be shown/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show on website' }));
    await waitFor(() => expect(calls).toEqual(['names:false', 'publish']));
  });

  it('withdraw is a plain confirm with no names switch', async () => {
    const calls = setup({ website_published_at: '2026-11-01T00:00:00.000Z' });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Take results off the website' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('switch')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Take off website' }));
    await waitFor(() => expect(calls).toEqual(['unpublish']));
  });

  it('says the website is off when it is, without echoing the server text', async () => {
    setup({}, false);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Show results on the website' }),
    );
    expect(await screen.findByText(/Set up the school website first/)).toBeTruthy();
  });

  it('a 409 shows one fixed sentence', async () => {
    setup();
    server.use(
      http.post('/api/v1/exams/exam-1/website-publish', () =>
        HttpResponse.json(
          apiErrorBody(409, 'Only exam published results can go on website.', '/x'),
          { status: 409 },
        ),
      ),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Show results on the website' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show on website' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).queryByText(/exam published results/)).toBeNull();
    expect(baseSite).toBeTruthy();
  });
});
