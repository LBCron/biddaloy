import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrganisationSection } from './OrganisationSection';

const SCHOOL_ID = 'school-1';

const ORGANISATION = {
  shifts: ['Morning', 'Day'],
  versions: ['Bangla'],
  groups: [],
};

const CONDUCT = [
  { key: 'discipline', name_bn: 'শৃঙ্খলা', name_en: 'Discipline' },
  { key: 'neatness', name_bn: 'পরিচ্ছন্নতা', name_en: 'Neatness' },
];

describe('OrganisationSection', () => {
  beforeEach(() => {
    // The conduct card reads the saved settings itself.
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          organisation: ORGANISATION,
          exams: { conductItems: CONDUCT },
        }),
      ),
    );
  });

  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the three list editors with their current values', async () => {
    renderWithProviders(<OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const shifts = within(await screen.findByTestId('organisation-shifts'));
    expect(shifts.getByText('Morning')).toBeDefined();
    expect(shifts.getByText('Day')).toBeDefined();

    const versions = within(screen.getByTestId('organisation-versions'));
    expect(versions.getByText('Bangla')).toBeDefined();

    const groups = within(screen.getByTestId('organisation-groups'));
    expect(groups.getByText('No values yet.')).toBeDefined();
  });

  it('adding a value saves it in the organisation patch', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patchBody(body);
        return HttpResponse.json({
          version: 1,
          organisation: { ...ORGANISATION, groups: ['Science'] },
        });
      }),
    );

    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const groups = within(await screen.findByTestId('organisation-groups'));
    await user.type(groups.getByPlaceholderText('Add a value'), 'Science');
    await user.click(groups.getByRole('button', { name: 'Add' }));

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0].organisation.groups).toEqual(['Science']);
  });

  it('shows a translated refusal inline on the row when a value is still in use', async () => {
    server.use(
      http.patch('/api/v1/schools/:id/settings', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message:
              'Cannot remove "Day" from shifts — 2 row(s) still use it. Rename it instead, or reassign those rows first.',
            timestamp: new Date().toISOString(),
            path: '/api/v1/schools/school-1/settings',
            requestId: 'req-1',
          },
          { status: 400 },
        ),
      ),
    );

    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const shifts = within(await screen.findByTestId('organisation-shifts'));
    const dayRow = shifts.getByText('Day').closest('li')!;
    await user.click(within(dayRow).getByRole('button', { name: 'Remove: Day' }));

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    // The row shows a translated line, never the server's own text.
    expect(
      await within(dayRow).findByText(
        '"Day" is still used by classes or sections, so it can\'t be removed. Rename it instead.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/row\(s\) still use it/)).toBeNull();
  });

  it('a rename sends an explicit { list, from, to } instruction', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patchBody(body);
        return HttpResponse.json({
          version: 1,
          organisation: { ...ORGANISATION, shifts: ['Prabhati', 'Day'] },
        });
      }),
    );

    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const shifts = within(await screen.findByTestId('organisation-shifts'));
    const morningRow = shifts.getByText('Morning').closest('li')!;
    await user.click(within(morningRow).getByRole('button', { name: 'Rename: Morning' }));

    const renameInput = within(morningRow).getByPlaceholderText('New name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Prabhati');
    await user.click(within(morningRow).getByRole('button', { name: 'Save' }));

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    const body = patchBody.mock.calls[0]![0];
    expect(body.organisation.shifts).toEqual(['Prabhati', 'Day']);
    expect(body.organisationRenames).toEqual([{ list: 'shifts', from: 'Morning', to: 'Prabhati' }]);
  });

  // [CodeRabbit, PR #916] Only one rename per list per save — a second
  // rename on a *different* entry must not silently overwrite the first.
  it('refuses a second rename on a different entry in the same list', async () => {
    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const shifts = within(await screen.findByTestId('organisation-shifts'));
    const morningRow = shifts.getByText('Morning').closest('li')!;
    await user.click(within(morningRow).getByRole('button', { name: 'Rename: Morning' }));
    const renameInput = within(morningRow).getByPlaceholderText('New name');
    await user.type(renameInput, 'Prabhati');
    await user.click(within(morningRow).getByRole('button', { name: 'Save' }));

    // Morning's row now reads "Prabhati" — the Rename button on the
    // *other* row (Day) must be disabled while that rename is pending.
    // No jest-dom in this repo's test setup (same gotcha
    // `AttendanceSection.test.tsx`'s own comment documents) — a plain
    // `.disabled` read instead of `toBeDisabled()`.
    const dayRow = shifts.getByText('Day').closest('li')!;
    const dayRenameButton = within(dayRow).getByRole('button', { name: 'Rename: Day' });
    expect((dayRenameButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('a chained rename on the same entry sends a single { from: original, to: latest }', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patchBody(body);
        return HttpResponse.json({
          version: 1,
          organisation: { ...ORGANISATION, shifts: ['Shokal', 'Day'] },
        });
      }),
    );

    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const shifts = within(await screen.findByTestId('organisation-shifts'));
    let row = shifts.getByText('Morning').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Rename: Morning' }));
    let renameInput = within(row).getByPlaceholderText('New name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Prabhati');
    await user.click(within(row).getByRole('button', { name: 'Save' }));

    // Re-rename the same entry, now reading "Prabhati".
    row = shifts.getByText('Prabhati').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Rename: Prabhati' }));
    renameInput = within(row).getByPlaceholderText('New name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Shokal');
    await user.click(within(row).getByRole('button', { name: 'Save' }));

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    const body = patchBody.mock.calls[0]![0];
    expect(body.organisation.shifts).toEqual(['Shokal', 'Day']);
    expect(body.organisationRenames).toEqual([{ list: 'shifts', from: 'Morning', to: 'Shokal' }]);
  });

  it('shows an alert when the save fails for another reason, and clears it on the next edit', async () => {
    server.use(
      http.patch('/api/v1/schools/:id/settings', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'Something else went wrong.',
            timestamp: new Date().toISOString(),
            path: '/api/v1/schools/school-1/settings',
            requestId: 'req-2',
          },
          { status: 400 },
        ),
      ),
    );
    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const groups = within(await screen.findByTestId('organisation-groups'));
    await user.type(groups.getByPlaceholderText('Add a value'), 'Science');
    await user.click(groups.getByRole('button', { name: 'Add' }));
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save. Try again.");
    expect(screen.queryByText('Something else went wrong.')).toBeNull();

    // A new edit makes the earlier error stale.
    await user.type(groups.getByPlaceholderText('Add a value'), 'Arts');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a removed value can be restored before saving', async () => {
    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const versions = within(await screen.findByTestId('organisation-versions'));
    await user.click(versions.getByRole('button', { name: 'Remove: Bangla' }));
    await user.click(versions.getByRole('button', { name: 'Undo remove: Bangla' }));

    expect(versions.getByRole('button', { name: 'Remove: Bangla' })).toBeTruthy();
  });

  describe('conduct items card', () => {
    const renderCard = () =>
      renderWithProviders(
        <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
        {
          locale: 'en',
          role: 'ADMIN',
          tenantId: SCHOOL_ID,
        },
      );
    const conductSave = () => screen.getAllByRole('button', { name: 'Save' })[1]!;

    it('lists the saved lines with both names and the read-only key', async () => {
      renderCard();
      const list = within(await screen.findByTestId('conduct-items'));
      await waitFor(() => expect(list.getAllByLabelText('English name')).toHaveLength(2));
      expect((list.getAllByLabelText('English name')[0] as HTMLInputElement).value).toBe(
        'Discipline',
      );
      expect((list.getAllByLabelText('Bangla name')[1] as HTMLInputElement).value).toBe(
        'পরিচ্ছন্নতা',
      );
      expect(list.getByText('Saved as: neatness')).toBeTruthy();
    });

    it('adds a line and saves the whole list, keeping saved keys and slugging the new one', async () => {
      const patchBody = vi.fn();
      server.use(
        http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
          patchBody(await request.json());
          return HttpResponse.json({ version: 1, exams: { conductItems: CONDUCT } });
        }),
      );
      const { user } = renderCard();
      const list = within(await screen.findByTestId('conduct-items'));
      await waitFor(() => expect(list.getAllByLabelText('English name')).toHaveLength(2));

      await user.click(screen.getAllByRole('button', { name: 'Add' }).at(-1)!);
      await user.type(list.getAllByLabelText('Bangla name')[2]!, 'খেলাধুলা');
      await user.type(list.getAllByLabelText('English name')[2]!, 'Sports Day');
      await user.click(conductSave());

      await waitFor(() => expect(patchBody).toHaveBeenCalled());
      expect(patchBody.mock.calls[0]![0]).toEqual({
        version: 1,
        exams: {
          conductItems: [
            ...CONDUCT,
            { key: 'sports_day', name_bn: 'খেলাধুলা', name_en: 'Sports Day' },
          ],
        },
      });
    });

    it('removes a line from the payload', async () => {
      const patchBody = vi.fn();
      server.use(
        http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
          patchBody(await request.json());
          return HttpResponse.json({ version: 1 });
        }),
      );
      const { user } = renderCard();
      await screen.findByTestId('conduct-items');
      await user.click(await screen.findByRole('button', { name: 'Remove: Discipline' }));
      await user.click(conductSave());

      await waitFor(() => expect(patchBody).toHaveBeenCalled());
      expect(patchBody.mock.calls[0]![0].exams.conductItems).toEqual([CONDUCT[1]]);
    });

    it('refuses an empty name and a duplicate key without sending', async () => {
      const patchBody = vi.fn();
      server.use(
        http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
          patchBody(await request.json());
          return HttpResponse.json({ version: 1 });
        }),
      );
      const { user } = renderCard();
      const list = within(await screen.findByTestId('conduct-items'));
      await waitFor(() => expect(list.getAllByLabelText('English name')).toHaveLength(2));

      await user.click(screen.getAllByRole('button', { name: 'Add' }).at(-1)!);
      await user.click(conductSave());
      expect(await screen.findByText('Write both the Bangla and the English name.')).toBeTruthy();

      // A new line that slugs to an existing key.
      await user.type(list.getAllByLabelText('Bangla name')[2]!, 'শৃঙ্খলা');
      await user.type(list.getAllByLabelText('English name')[2]!, 'Discipline');
      await user.click(conductSave());
      expect(
        await screen.findByText(
          'The English name must start with a letter, be 2 to 31 letters or digits long, and differ from the other lines.',
        ),
      ).toBeTruthy();
      expect(patchBody).not.toHaveBeenCalled();
    });
  });
});
