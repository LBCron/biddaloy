/**
 * [34.4.1], D5/D9 — `MilestoneEditor`: adds a milestone, edits one, deletes
 * one via the confirm step, reorders with the ↑/↓ buttons, and hides every
 * manage control when `canManage` is false (D5's `PROGRAM_RECORD`-only
 * viewer). Same hand-rolled provider stack as `-record-dialog.test.tsx`.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { expectHelp, withHelp } from '../../../help/test-utils';

import { MilestoneEditor, type MilestoneEditorProps } from './-milestone-editor';

afterEach(async () => {
  await cleanupTestState();
});

const MILESTONES = [
  { id: 'm-1', program_id: 'p-1', name: 'First', description: null, sequence: 1 },
  {
    id: 'm-2',
    program_id: 'p-1',
    name: 'Second',
    description: null,
    sequence: 2,
    achievement_count: 3,
  },
];

async function renderEditor(props: Partial<MilestoneEditorProps> = {}) {
  await i18n.changeLanguage('en');
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');

  const queryClient = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        {withHelp(
          <MilestoneEditor programId="p-1" milestones={MILESTONES} canManage {...props} />,
        )}
      </I18nProvider>
    </QueryClientProvider>,
  );

  return view;
}

describe('MilestoneEditor', () => {
  it('shows the empty hint with no milestones', async () => {
    await renderEditor({ milestones: [] });
    await screen.findByText('Add milestones to track progress');
  });

  it('adds a milestone', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(
      http.post('/api/v1/programs/:id/milestones', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ id: 'm-3', name: 'Third', sequence: 3 });
      }),
    );
    await renderEditor();

    const input = await screen.findByLabelText('New milestone name');
    await user.type(input, 'Third');
    await user.click(screen.getByRole('button', { name: 'Add milestone' }));

    await waitFor(() => expect(requestBody).toMatchObject({ name: 'Third' }));
  });

  it('edits a milestone', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(
      http.patch('/api/v1/programs/:id/milestones/:milestoneId', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ id: 'm-1', name: 'First (renamed)', sequence: 1 });
      }),
    );
    await renderEditor();

    await user.click((await screen.findAllByRole('button', { name: 'Edit milestone' }))[0]!);
    const editInput = screen.getByLabelText(/^Name/);
    await user.clear(editInput);
    await user.type(editInput, 'First (renamed)');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(requestBody).toMatchObject({ name: 'First (renamed)' }));
  });

  it('removes a milestone after confirming, showing the achievement count', async () => {
    const user = userEvent.setup();
    let deleted = false;
    server.use(
      http.delete('/api/v1/programs/:id/milestones/:milestoneId', () => {
        deleted = true;
        return HttpResponse.json({ deleted: true });
      }),
    );
    await renderEditor();

    const removeButtons = await screen.findAllByRole('button', { name: 'Remove milestone' });
    await user.click(removeButtons[1]!); // m-2 has achievement_count: 3
    const confirm = await screen.findByRole('alertdialog');
    await expectHelp('people.programs.action.removeMilestone');
    await within(confirm).findByText(
      /This milestone has (3|৩) recorded achievements. Removing them will delete those records too./,
    );
    await user.click(within(confirm).getByRole('button', { name: 'Remove milestone' }));

    await waitFor(() => expect(deleted).toBe(true));
  });

  it('reorders with the move-down button', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(
      http.put('/api/v1/programs/:id/milestones/order', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json(MILESTONES);
      }),
    );
    await renderEditor();

    // m-1's own move-down button (first in DOM order).
    await user.click(screen.getAllByRole('button', { name: 'Move milestone down' })[0]!);

    await waitFor(() => expect(requestBody).toMatchObject({ milestone_ids: ['m-2', 'm-1'] }));
  });

  it('drops the failure alert once a later change succeeds', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/programs/:id/milestones', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'boom', requestId: 'r', path: '/', timestamp: '' },
          { status: 500 },
        ),
      ),
      http.put('/api/v1/programs/:id/milestones/order', () => HttpResponse.json(MILESTONES)),
    );
    await renderEditor();

    await user.type(await screen.findByLabelText('New milestone name'), 'Third');
    await user.click(screen.getByRole('button', { name: 'Add milestone' }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Move milestone down' })[0]!);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('hides add/edit/remove/reorder controls when canManage is false', async () => {
    await renderEditor({ canManage: false });
    await screen.findByText('First');

    expect(screen.queryByLabelText('New milestone name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit milestone' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove milestone' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move milestone up' })).toBeNull();
  });
});
