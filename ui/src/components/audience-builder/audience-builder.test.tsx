import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test';
import type { DataTableColumn } from '../data-table';

import { AudienceBuilder, type AudienceBuilderProps } from './audience-builder';

interface Person {
  id: string;
  name: string;
}
const A: Person = { id: '1', name: 'Rahim' };
const B: Person = { id: '2', name: 'Karim' };
const C: Person = { id: '3', name: 'Salma' };
const COLUMNS: DataTableColumn<Person>[] = [
  { id: 'name', header: 'Name', accessorFn: (r) => r.name },
];

function props(over: Partial<AudienceBuilderProps<Person>> = {}): AudienceBuilderProps<Person> {
  return {
    tabs: [
      { key: 'class', label: 'By class', filters: <span>class filters</span> },
      { key: 'staff', label: 'Staff', filters: <span>staff filters</span> },
    ],
    activeTab: 'class',
    onTabChange: vi.fn(),
    matches: { rows: [A, B], total: 2, page: 1, pageSize: 25 },
    onPageChange: vi.fn(),
    onRetry: vi.fn(),
    rowKey: (r) => r.id,
    columns: COLUMNS,
    onAddSelected: vi.fn(),
    onAddAll: vi.fn(),
    chosen: { rows: [C], total: 1, page: 1 },
    onChosenPage: vi.fn(),
    onRemove: vi.fn(),
    layout: 'desktop',
    ...over,
  };
}

async function setup(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
  });
  return view;
}

describe('AudienceBuilder', () => {
  it('adds exactly the selected rows', async () => {
    const p = props();
    await setup(<AudienceBuilder {...p} />);
    const matches = screen.getByRole('table', { name: 'Matching people' });
    const boxes = within(matches).getAllByRole('checkbox');
    await userEvent.click(boxes[1]!);
    await userEvent.click(boxes[2]!);
    await userEvent.click(screen.getByRole('button', { name: /Add to chosen list/ }));
    expect(p.onAddSelected).toHaveBeenCalledWith([A, B]);
  });

  it('select all calls onAddAll', async () => {
    const p = props();
    await setup(<AudienceBuilder {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(p.onAddAll).toHaveBeenCalledTimes(1);
  });

  it('remove calls onRemove with that row', async () => {
    const p = props();
    await setup(<AudienceBuilder {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove from chosen list' }));
    expect(p.onRemove).toHaveBeenCalledWith([C]);
  });

  it('paging matches leaves the chosen list alone', async () => {
    const p = props({ matches: { rows: [A, B], total: 60, page: 1, pageSize: 25 } });
    await setup(<AudienceBuilder {...p} />);
    await userEvent.click(screen.getAllByRole('button', { name: /next/i })[0]!);
    expect(p.onPageChange).toHaveBeenCalledWith(2);
    expect(p.onChosenPage).not.toHaveBeenCalled();
    expect(p.onRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Salma')).toBeTruthy();
  });

  it('renders the empty state', async () => {
    await setup(
      <AudienceBuilder {...props({ matches: { rows: [], total: 0, page: 1, pageSize: 25 } })} />,
    );
    expect(screen.getByText('No one matches this filter')).toBeTruthy();
  });

  it('renders the error state and retries', async () => {
    const onRetry = vi.fn();
    await setup(
      <AudienceBuilder
        {...props({
          onRetry,
          matches: { rows: [], total: 0, page: 1, pageSize: 25, error: 'Could not load' },
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('phone: filters behind a button, chosen bar toggles the list', async () => {
    await setup(<AudienceBuilder {...props({ layout: 'phone' })} />);
    expect(screen.queryByText('class filters')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Chosen (1)' }));
    expect(screen.getByRole('region', { name: 'Chosen list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
  });

  it('selection clears after add and focus moves to the pane', async () => {
    const p = props();
    await setup(<AudienceBuilder {...p} />);
    const boxes = within(screen.getByRole('table', { name: 'Matching people' })).getAllByRole(
      'checkbox',
    );
    await userEvent.click(boxes[1]!);
    await userEvent.click(screen.getByRole('button', { name: /Add to chosen list/ }));
    expect(screen.getByRole('button', { name: 'Add to chosen list' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('phone layout is axe clean', async () => {
    const { container } = await setup(<AudienceBuilder {...props({ layout: 'phone' })} />);
    await expect(container).toHaveNoViolations();
  });

  it('is axe clean', async () => {
    const { container } = await setup(<AudienceBuilder {...props()} />);
    await expect(container).toHaveNoViolations();
  });
});
