/** [70.5.x] The remark + conduct grid: counter, A-D select, blank dash, row-by-row Tab order. */
import { DEFAULT_CONDUCT_ITEMS } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { NotesGrid, type NoteDraft } from './-notes-grid';

const ROWS = [
  {
    student_id: 's1',
    full_name: 'Rafi',
    full_name_bn: null,
    roll_number: 1,
    remark: null,
    conduct: {},
  },
  {
    student_id: 's2',
    full_name: 'Mina',
    full_name_bn: null,
    roll_number: 2,
    remark: null,
    conduct: {},
  },
];

function Harness({ onDrafts }: { onDrafts: (d: Record<string, NoteDraft>) => void }) {
  const [drafts, setDrafts] = React.useState<Record<string, NoteDraft>>({
    s1: { remark: 'Good', conduct: {} },
    s2: { remark: '', conduct: { discipline: 'B' } },
  });
  return (
    <NotesGrid
      rows={ROWS}
      items={DEFAULT_CONDUCT_ITEMS}
      drafts={drafts}
      onChange={(id, next) => {
        const merged = { ...drafts, [id]: next };
        setDrafts(merged);
        onDrafts(merged);
      }}
    />
  );
}

function renderGrid(onDrafts: (d: Record<string, NoteDraft>) => void = () => undefined) {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Harness onDrafts={onDrafts} />,
  });
  renderWithRouter(root.addChildren([index]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

describe('NotesGrid', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('counts remark characters out of 300 and reports edits', async () => {
    const user = userEvent.setup();
    let latest: Record<string, NoteDraft> = {};
    renderGrid((d) => (latest = d));
    expect(await screen.findByText('4/300')).toBeTruthy();
    expect(screen.getByText('0/300')).toBeTruthy();
    await user.type(screen.getByLabelText("Class teacher's remark — Mina"), 'Kind');
    expect(screen.getAllByText('4/300')).toHaveLength(2);
    expect(latest.s2?.remark).toBe('Kind');
  });

  it('shows a dash for an ungraded item and picks A to D', async () => {
    const user = userEvent.setup();
    let latest: Record<string, NoteDraft> = {};
    renderGrid((d) => (latest = d));
    const neatness = await screen.findByRole('combobox', { name: 'Neatness — Rafi' });
    expect(neatness.textContent).toBe('—');
    expect(screen.getByRole('combobox', { name: 'Discipline — Mina' }).textContent).toBe('B');

    await user.click(neatness);
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['—', 'A', 'B', 'C', 'D']);
    await user.click(within(listbox).getByRole('option', { name: 'C' }));
    expect(latest.s1?.conduct).toEqual({ neatness: 'C' });

    // Choosing the dash clears the grade again.
    await user.click(screen.getByRole('combobox', { name: 'Neatness — Rafi' }));
    await user.click(await screen.findByRole('option', { name: '—' }));
    expect(latest.s1?.conduct).toEqual({});
  });

  it('tabs row by row: remark, then the four grades, then the next student', async () => {
    const user = userEvent.setup();
    renderGrid();
    const first = await screen.findByLabelText("Class teacher's remark — Rafi");
    first.focus();
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      seen.push(document.activeElement?.getAttribute('aria-label') ?? '');
    }
    expect(seen).toEqual([
      'Discipline — Rafi',
      'Neatness — Rafi',
      'Punctuality — Rafi',
      'Sports & co-curricular — Rafi',
      "Class teacher's remark — Mina",
    ]);
  });
});
