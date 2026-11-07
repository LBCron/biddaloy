/** [40.2.05] The website question sits under the guided door only. */
import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SetupDoors, type SetupDoor } from './setup-doors';

afterEach(cleanupTestState);

function renderDoors(value: SetupDoor, wantsWebsite = false) {
  const onWantsWebsiteChange = vi.fn();
  renderWithProviders(
    <SetupDoors
      value={value}
      onChange={vi.fn()}
      onEnter={vi.fn()}
      wantsWebsite={wantsWebsite}
      onWantsWebsiteChange={onWantsWebsiteChange}
      supportUrl={null}
    />,
    { locale: 'en' },
  );
  return onWantsWebsiteChange;
}

describe('SetupDoors website question', () => {
  it('is shown under the guided door, defaulting to no', async () => {
    renderDoors('guided');
    expect(await screen.findByText('Do you want a school website too?')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Not now' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('is hidden under the other doors', async () => {
    renderDoors('excel');
    await screen.findByText('From an Excel file');
    expect(screen.queryByText('Do you want a school website too?')).toBeNull();
  });

  it('reports a yes', async () => {
    const onChange = renderDoors('guided');
    await userEvent.click(await screen.findByRole('radio', { name: 'Yes, set it up' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('keeps the three doors in order', async () => {
    renderDoors('guided');
    const titles = (await screen.findAllByRole('radio')).map((r) => r.textContent ?? '');
    expect(titles.slice(0, 3).join('|')).toMatch(/Step by step.*Excel.*later/);
  });
});
