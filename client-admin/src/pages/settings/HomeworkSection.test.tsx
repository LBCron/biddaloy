import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HomeworkSection } from './HomeworkSection';
import { WithTestRouter } from './with-test-router';

const SCHOOL_ID = 'school-1';
const ASSIGN = 'Text guardians when homework is assigned or changed';
const DEFAULTERS = 'Text guardians when homework is not submitted';
const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: SCHOOL_ID };

describe('HomeworkSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders both checkboxes unchecked by default, with the paper-homework hint', async () => {
    renderWithProviders(
      <WithTestRouter>
        <HomeworkSection schoolId={SCHOOL_ID} homework={undefined} smsConfigured />
      </WithTestRouter>,
      opts,
    );
    expect((await screen.findByLabelText(ASSIGN)).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByLabelText(DEFAULTERS).getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByText('Leave off if homework is collected on paper and ticked later.'),
    ).toBeTruthy();
  });

  it('saves both switches in the homework slice', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );
    const { user } = renderWithProviders(
      <WithTestRouter>
        <HomeworkSection schoolId={SCHOOL_ID} homework={undefined} smsConfigured />
      </WithTestRouter>,
      opts,
    );
    await user.click(await screen.findByLabelText(ASSIGN));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0]).toEqual({
      version: 1,
      homework: { notifyOnAssign: true, notifyDefaulters: false },
    });
  });

  it('shows the SMS hint and link when no SMS company is set up', async () => {
    renderWithProviders(
      <WithTestRouter>
        <HomeworkSection schoolId={SCHOOL_ID} homework={undefined} />
      </WithTestRouter>,
      opts,
    );
    expect(await screen.findByText('No SMS company added.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Communication › add SMS company' }).getAttribute('href'),
    ).toBe('/settings?section=communication');
  });
});
