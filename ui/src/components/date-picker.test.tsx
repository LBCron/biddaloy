import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REGION_BD_EN, type RegionConfig } from '../i18n/region-config';
import { renderWithProviders } from '../test';
import { formatDate, formatMonth } from '../utils/date';

import { DatePicker } from './date-picker';

function Controlled({
  initial,
  config = REGION_BD_EN,
  min,
  max,
}: {
  initial?: Date;
  config?: RegionConfig;
  min?: Date;
  max?: Date;
}) {
  const [value, setValue] = useState<Date | undefined>(initial);
  return (
    <DatePicker
      aria-label="Enrollment date"
      value={value}
      onValueChange={setValue}
      config={config}
      min={min}
      max={max}
    />
  );
}

async function setup(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await view.localeReady;
  return view;
}

const trigger = () => screen.getByRole('button', { name: /^Enrollment date, / });
const openGrid = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(trigger());
  return screen.findByRole('grid', { name: 'Calendar' });
};
const cell = (iso: string) => document.querySelector<HTMLElement>(`[data-date="${iso}"]`)!;

afterEach(() => vi.useRealTimers());

describe('DatePicker', () => {
  it('empty trigger shows the placeholder and has no text input', async () => {
    await setup(<Controlled />);
    expect(trigger().textContent).toContain('Pick a date');
    expect(document.querySelector('input')).toBeNull();
  });

  it('trigger shows the formatted value', async () => {
    const date = new Date(2024, 0, 5);
    await setup(<Controlled initial={date} />);
    expect(trigger().textContent).toContain(formatDate(date, REGION_BD_EN));
  });

  it('the accessible name is the label followed by exactly the visible text (WCAG 2.5.3)', async () => {
    const date = new Date(2024, 0, 5);
    await setup(<Controlled initial={date} />);
    expect(
      screen.getByRole('button', { name: `Enrollment date, ${formatDate(date, REGION_BD_EN)}` }),
    ).toBeTruthy();
    expect(trigger().getAttribute('aria-label')).toContain(trigger().textContent ?? '');
  });

  it('with no value the name ends with the placeholder that is on screen', async () => {
    await setup(<Controlled />);
    expect(screen.getByRole('button', { name: 'Enrollment date, Pick a date' })).toBeTruthy();
  });

  it('Clear empties a picked value and closes', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial={new Date(2024, 0, 5)} />);
    await openGrid(user);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
    expect(trigger().textContent).toContain('Pick a date');
  });

  it('opens, arrow-navigates, Enter selects and closes', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial={new Date(2024, 0, 5)} />);
    await openGrid(user);

    const day5 = cell('2024-01-05');
    expect(day5.getAttribute('tabindex')).toBe('0');
    day5.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(document.activeElement).toBe(cell('2024-01-06')));

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('grid', { name: 'Calendar' })).toBeNull());
    expect(trigger().textContent).toContain(formatDate(new Date(2024, 0, 6), REGION_BD_EN));
  });

  it('crosses a month boundary with focus kept on a day cell', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial={new Date(2024, 0, 31)} />);
    await openGrid(user);
    cell('2024-01-31').focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(screen.getByText(formatMonth(new Date(2024, 1, 1), REGION_BD_EN))).toBeTruthy(),
    );
    await waitFor(() => expect(document.activeElement).toBe(cell('2024-02-01')));
  });

  it('keeps focus crossing a year boundary backward (Jan -> Dec)', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial={new Date(2024, 0, 1)} />);
    await openGrid(user);
    cell('2024-01-01').focus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(document.activeElement).toBe(cell('2023-12-31')));
  });

  it('ArrowDown/ArrowUp move a week; clicking selects', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial={new Date(2024, 0, 5)} />);
    await openGrid(user);
    cell('2024-01-05').focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toBe(cell('2024-01-12')));
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(document.activeElement).toBe(cell('2024-01-05')));
    await user.click(cell('2024-01-12'));
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
    expect(trigger().textContent).toContain(formatDate(new Date(2024, 0, 12), REGION_BD_EN));
  });

  it('Previous/Next month buttons use translated labels and move the view', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial={new Date(2024, 0, 5)} />);
    await openGrid(user);
    expect(screen.getByText(formatMonth(new Date(2024, 0, 1), REGION_BD_EN))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText(formatMonth(new Date(2024, 1, 1), REGION_BD_EN))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText(formatMonth(new Date(2024, 0, 1), REGION_BD_EN))).toBeTruthy();
  });

  it('exposes 7 weekday column headers', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial={new Date(2024, 0, 5)} />);
    const grid = await openGrid(user);
    const headers = within(grid).getAllByRole('columnheader');
    expect(headers).toHaveLength(7);
    expect(headers[0]!.textContent).toContain('Sun');
  });

  it('first column follows firstDayOfWeek: 1', async () => {
    const user = userEvent.setup();
    const config = { ...REGION_BD_EN, date: { ...REGION_BD_EN.date, firstDayOfWeek: 1 } };
    await setup(<Controlled initial={new Date(2024, 0, 5)} config={config} />);
    const grid = await openGrid(user);
    expect(within(grid).getAllByRole('columnheader')[0]!.textContent).toContain('Mon');
  });

  it('handles Feb 29 on a leap year', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial={new Date(2024, 1, 29)} />);
    await openGrid(user);
    expect(cell('2024-02-29').hasAttribute('data-outside')).toBe(false);
    // 2024-03-01 is in the grid as an outside day, not a 30th.
    expect(cell('2024-02-30')).toBeNull();
  });

  it('marks today, and gives it the selected look when there is no value', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 0, 10));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await setup(<Controlled />);
    await openGrid(user);
    const today = cell('2024-01-10');
    expect(today.hasAttribute('data-today')).toBe(true);
    expect(today.firstElementChild!.className).toContain('bg-primary');
    expect(today.getAttribute('aria-selected')).toBe('false');
    expect(today.getAttribute('tabindex')).toBe('0');
  });

  it('renders neighbouring-month days as data-outside', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial={new Date(2024, 0, 5)} />);
    await openGrid(user);
    // Jan 1 2024 is a Monday: Sunday Dec 31 leads the grid.
    expect(cell('2023-12-31').hasAttribute('data-outside')).toBe(true);
    expect(cell('2024-01-15').hasAttribute('data-outside')).toBe(false);
  });

  it('min disables earlier days', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial={new Date(2024, 0, 15)} min={new Date(2024, 0, 10)} />);
    await openGrid(user);
    expect(cell('2024-01-09').getAttribute('aria-disabled')).toBe('true');
    expect(cell('2024-01-10').getAttribute('aria-disabled')).toBeNull();
  });

  it('Today in the header jumps back from another month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 0, 10));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await setup(<Controlled initial={new Date(2024, 5, 5)} />);
    await openGrid(user);
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText(formatMonth(new Date(2024, 0, 1), REGION_BD_EN))).toBeTruthy();
    expect(cell('2024-01-10')).toBeTruthy();
  });

  it('keeps one Tab stop when max is before today and there is no value', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 0, 20));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await setup(<Controlled max={new Date(2024, 0, 10)} />);
    await openGrid(user);
    const stops = document.querySelectorAll('[data-date][tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0]!.hasAttribute('disabled')).toBe(false);
  });

  it('disables Today when today is outside min/max', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 0, 20));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await setup(<Controlled max={new Date(2024, 0, 10)} />);
    await openGrid(user);
    expect(screen.getByRole('button', { name: 'Today' }).hasAttribute('disabled')).toBe(true);
  });

  describe('year jump', () => {
    it('the month label opens 12 month buttons with the year as label', async () => {
      const user = userEvent.setup();
      await setup(<Controlled initial={new Date(2024, 0, 5)} />);
      await openGrid(user);
      const label = screen.getByRole('button', { name: /Choose month and year/ });
      await user.click(label);
      expect(label.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('2024')).toBeTruthy();
      expect(screen.getAllByRole('button', { pressed: false }).length).toBe(11);
    });

    it('Previous year twice then March shows March two years back', async () => {
      const user = userEvent.setup();
      await setup(<Controlled initial={new Date(2024, 0, 5)} />);
      await openGrid(user);
      await user.click(screen.getByRole('button', { name: /Choose month and year/ }));
      await user.click(screen.getByRole('button', { name: 'Previous year' }));
      await user.click(screen.getByRole('button', { name: 'Previous year' }));
      await user.click(screen.getByRole('button', { name: 'March' }));
      await screen.findByRole('grid', { name: 'Calendar' });
      expect(cell('2022-03-15')).toBeTruthy();
      expect(screen.getByText(formatMonth(new Date(2022, 2, 1), REGION_BD_EN))).toBeTruthy();
    });

    it('max disables later months in the months view', async () => {
      const user = userEvent.setup();
      await setup(<Controlled initial={new Date(2024, 0, 5)} max={new Date(2024, 4, 20)} />);
      await openGrid(user);
      await user.click(screen.getByRole('button', { name: /Choose month and year/ }));
      expect(screen.getByRole('button', { name: 'May' }).hasAttribute('disabled')).toBe(false);
      expect(screen.getByRole('button', { name: 'June' }).hasAttribute('disabled')).toBe(true);
    });

    it('Escape in the months view returns to days before closing', async () => {
      const user = userEvent.setup();
      await setup(<Controlled initial={new Date(2024, 0, 5)} />);
      await openGrid(user);
      await user.click(screen.getByRole('button', { name: /Choose month and year/ }));
      await user.keyboard('{Escape}');
      expect(await screen.findByRole('grid', { name: 'Calendar' })).toBeTruthy();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
    });
  });
});
