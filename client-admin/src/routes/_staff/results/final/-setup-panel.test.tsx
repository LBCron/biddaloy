/**
 * [70.5.3] Setup tab: shares must total 100 (checked as you type), the rarely used rules sit in a
 * closed fold, best-of hides the shares, and Save sends the whole weight set once.
 */
import type { FinalResultSummary } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

// The route-permission entries for these pages land with the nav/route-map ticket (#3421). Until then
// the closed-by-default gate would refuse them, so the same two entries are added here.
vi.mock('../../../../route-permissions', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../../route-permissions')>();
  const { Permission } = await import('@biddaloy/shared');
  return {
    ...mod,
    STAFF_ROUTE_PERMISSIONS: {
      ...mod.STAFF_ROUTE_PERMISSIONS,
      '/_staff/results/final/': Permission.RESULT_PROCESS,
      '/_staff/results/final/$finalResultId': Permission.RESULT_PROCESS,
    },
  };
});

import { mockFinal, summary, type Status } from './-test-fixtures';

async function open(status: Status = 'DRAFT') {
  mockFinal(status);
  renderWithRouter(routeTree, {
    initialEntries: ['/results/final/fr-1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  await screen.findByText('Which exams count');
}

const share = (name: string) => screen.getByLabelText<HTMLInputElement>(`${name} · Share (%)`);
const save = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });

describe('Setup tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists the published exams, with the counted ones ticked and MONTHLY not', async () => {
    await open();
    const boxes = screen.getAllByRole('checkbox');
    const state = Object.fromEntries(
      boxes.map((b) => [b.closest('label')?.textContent, b.getAttribute('aria-checked')]),
    );
    expect(state['Half Yearly']).toBe('true');
    expect(state['Annual']).toBe('true');
    expect(state['March Test']).toBe('false');
  });

  it('flags a total that is not 100 and blocks Save', async () => {
    await open();
    expect(save().disabled).toBe(false);
    const annual = share('Annual');
    await userEvent.clear(annual);
    await userEvent.type(annual, '50');
    await screen.findByText(/Must total 100 \(now (90|৯০)\)/);
    expect(save().disabled).toBe(true);
    await userEvent.clear(annual);
    await userEvent.type(annual, '60');
    await waitFor(() => expect(save().disabled).toBe(false));
  });

  it('keeps More rules closed by default', async () => {
    await open();
    const fold = screen.getByText('More rules').closest('details') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    await userEvent.click(screen.getByText('More rules'));
    expect(fold.open).toBe(true);
  });

  it('hides the shares when counting the best exams', async () => {
    await open();
    await userEvent.click(screen.getByText('More rules'));
    await userEvent.click(screen.getByRole('switch', { name: /Count best N exams/ }));
    expect(screen.queryByLabelText('Annual · Share (%)')).toBeNull();
    expect(screen.queryByText(/Must total 100/)).toBeNull();
    expect(screen.getByLabelText('How many best exams')).toBeTruthy();
  });

  it('asks for the best-of count to fit the ticked exams', async () => {
    await open();
    await userEvent.click(screen.getByText('More rules'));
    await userEvent.click(screen.getByRole('switch', { name: /Count best N exams/ }));
    const count = screen.getByLabelText('How many best exams');
    await userEvent.clear(count);
    await userEvent.type(count, '5');
    await screen.findByText('Cannot be more than the number of exams.');
    expect(save().disabled).toBe(true);
  });

  it('saves the whole set once and does not retry a failure', async () => {
    let body: Partial<FinalResultSummary> | undefined;
    let calls = 0;
    await open();
    server.use(
      http.patch('/api/v1/final-results/fr-1', async ({ request }) => {
        calls += 1;
        body = (await request.json()) as Partial<FinalResultSummary>;
        return HttpResponse.json({ message: 'no' }, { status: 500 });
      }),
    );
    await userEvent.click(save());
    await waitFor(() => expect(calls).toBe(1));
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(1);
    expect(body).toMatchObject({
      mode: 'WEIGHTED',
      rounding: 'WHOLE',
      fail_if_any_exam_fails: false,
      weights: summary('DRAFT').weights,
    });
  });

  it('is read-only once published, and says why', async () => {
    await open('PUBLISHED');
    expect(save().disabled).toBe(true);
    expect(screen.getByText(/The result is published, so it cannot be changed now/)).toBeTruthy();
    expect(share('Annual').disabled).toBe(true);
  });

  it('shows per-subject shares as a table when the switch is on', async () => {
    await open();
    await userEvent.click(screen.getByText('More rules'));
    await userEvent.click(screen.getByRole('switch', { name: /Different share per subject/ }));
    const maths = await screen.findByLabelText<HTMLInputElement>('Maths · Half Yearly');
    expect(maths.value).toBe('40');
    await userEvent.clear(maths);
    await userEvent.type(maths, '30');
    await screen.findByText("Each subject's shares must total 100.");
    expect(save().disabled).toBe(true);
  });
});
