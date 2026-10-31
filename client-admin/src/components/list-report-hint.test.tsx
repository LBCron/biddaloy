import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import enReports from '../../../ui/src/i18n/locales/en/reports.json';

import { ListReportHint, type ListHintKey } from './list-report-hint';

/** What each button does to the filters, like the real list's filter bar. */
const STEPS: Record<string, Record<string, string>> = {
  'pick class 1': { class_id: 'c1' },
  'pick class 2': { class_id: 'c2' },
  'pick girls': { class_id: 'c2', gender: 'F' },
  clear: {},
  'type a name': { search: 'rahim' },
  'type more': { search: 'rahim k' },
};

/** A list whose filters change when a button is pressed. */
function Harness({ onKeep, list = 'students' }: { onKeep: () => void; list?: ListHintKey }) {
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  return (
    <>
      {Object.entries(STEPS).map(([label, next]) => (
        <button key={label} onClick={() => setFilters(next)}>
          {label}
        </button>
      ))}
      <ListReportHint list={list} filters={filters} onKeep={onKeep} />
    </>
  );
}

async function render(props: Parameters<typeof Harness>[0], role = 'ADMIN') {
  const view = renderWithProviders(<Harness {...props} />, {
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
  await view.localeReady;
  await screen.findByText('clear');
  return view;
}

const hint = () => screen.queryByRole('note');

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  await cleanupTestState();
});

describe('ListReportHint [8.15.55]', () => {
  it('appears on the third filter, not before', async () => {
    const { user } = await render({ onKeep: vi.fn() });
    await user.click(screen.getByText('pick class 1'));
    expect(hint()).toBeNull();
    await user.click(screen.getByText('pick class 2'));
    expect(hint()).toBeNull();
    await user.click(screen.getByText('pick girls'));

    const note = screen.getByRole('note');
    expect(note.textContent).toContain('Need this often?');
    expect(screen.getByRole('button', { name: 'Keep this as a report' })).toBeTruthy();
    // A line, never a modal.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not count typing in the search box, or clearing the filters', async () => {
    const { user } = await render({ onKeep: vi.fn() });
    await user.click(screen.getByText('type a name'));
    await user.click(screen.getByText('type more'));
    await user.click(screen.getByText('pick class 1'));
    await user.click(screen.getByText('clear'));
    await user.click(screen.getByText('pick class 2'));
    // Two filters applied; search and clear did not count.
    expect(hint()).toBeNull();
  });

  it('shows once for that person on that list, even after a reload', async () => {
    const first = await render({ onKeep: vi.fn() });
    for (const label of ['pick class 1', 'pick class 2', 'pick girls']) {
      await first.user.click(screen.getByText(label));
    }
    expect(hint()).not.toBeNull();
    first.unmount();

    // A later visit (the count would reach three again) never shows it again.
    sessionStorage.clear();
    const second = await render({ onKeep: vi.fn() });
    for (const label of ['pick class 1', 'pick class 2', 'pick girls']) {
      await second.user.click(screen.getByText(label));
    }
    expect(hint()).toBeNull();
  });

  it('keeps a separate memory for each list', async () => {
    const first = await render({ onKeep: vi.fn(), list: 'students' });
    for (const label of ['pick class 1', 'pick class 2', 'pick girls']) {
      await first.user.click(screen.getByText(label));
    }
    expect(hint()).not.toBeNull();
    first.unmount();

    sessionStorage.clear();
    const dues = await render({ onKeep: vi.fn(), list: 'dues' });
    for (const label of ['pick class 1', 'pick class 2', 'pick girls']) {
      await dues.user.click(screen.getByText(label));
    }
    expect(hint()).not.toBeNull();
  });

  it('opens the keep-as-report dialog through the link and goes away', async () => {
    const onKeep = vi.fn();
    const { user } = await render({ onKeep });
    for (const label of ['pick class 1', 'pick class 2', 'pick girls']) {
      await user.click(screen.getByText(label));
    }
    await user.click(screen.getByRole('button', { name: 'Keep this as a report' }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(hint()).toBeNull();
  });

  it('can be dismissed', async () => {
    const onKeep = vi.fn();
    const { user } = await render({ onKeep });
    for (const label of ['pick class 1', 'pick class 2', 'pick girls']) {
      await user.click(screen.getByText(label));
    }
    await user.click(screen.getByRole('button', { name: 'Hide this tip' }));
    expect(hint()).toBeNull();
    expect(onKeep).not.toHaveBeenCalled();
  });

  it('is for someone who may design reports, nobody else', async () => {
    const { user } = await render({ onKeep: vi.fn() }, 'TEACHER');
    for (const label of ['pick class 1', 'pick class 2', 'pick girls']) {
      await user.click(screen.getByText(label));
    }
    expect(hint()).toBeNull();
  });

  it('still works when the browser store is blocked', async () => {
    const realGet = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem')!.value as (
      this: Storage,
      key: string,
    ) => string | null;
    const realSet = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')!.value as (
      this: Storage,
      key: string,
      value: string,
    ) => void;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key.startsWith('reports.')) throw new Error('blocked');
      return realGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.startsWith('reports.')) throw new Error('blocked');
      realSet.call(this, key, value);
    });
    const { user } = await render({ onKeep: vi.fn() });
    await user.click(screen.getByText('pick class 1'));
    await user.click(screen.getByText('pick class 2'));
    await user.click(screen.getByText('pick girls'));
    // Nothing is remembered, so the count never reaches three: no tip, and no error.
    expect(hint()).toBeNull();
  });

  it('has no jargon word in its text', () => {
    expect(JSON.stringify(enReports.listHint)).not.toMatch(/schedul|snapshot|cron|widget/i);
  });
});
