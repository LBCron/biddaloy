import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SectionOrderList, type SectionOrderItem } from './section-order-list';

const sections: SectionOrderItem[] = [
  { key: 'hero', name: 'Hero', enabled: true, pinned: true },
  { key: 'about', name: 'About', enabled: true },
  { key: 'blog', name: 'Blog', enabled: false },
  { key: 'footer', name: 'Footer', enabled: true, pinned: true },
];

const labels = {
  toggle: (n: string) => `Show ${n}`,
  up: (n: string) => `${n} up`,
  down: (n: string) => `${n} down`,
  edit: (n: string) => `Edit ${n}`,
  pinned: 'Fixed place',
};

function setup() {
  const onToggle = vi.fn();
  const onMove = vi.fn();
  const onEdit = vi.fn();
  render(
    <SectionOrderList
      sections={sections}
      onToggle={onToggle}
      onMove={onMove}
      onEdit={onEdit}
      labels={labels}
    />,
  );
  return { onToggle, onMove, onEdit };
}

describe('SectionOrderList', () => {
  it('moves a row with the buttons, by index in the full list', async () => {
    const { onMove } = setup();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Blog up' }));
    expect(onMove).toHaveBeenCalledWith(2, 1);
  });

  it('is keyboard operable', async () => {
    const { onMove } = setup();
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'About down' }).focus();
    await user.keyboard('{Enter}');
    expect(onMove).toHaveBeenCalledWith(1, 2);
  });

  it('pinned rows have no move buttons and the ends do not move out of the middle', async () => {
    const { onMove } = setup();
    expect(screen.queryByRole('button', { name: 'Hero up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Footer down' })).toBeNull();
    expect(screen.getAllByText('Fixed place')).toHaveLength(2);
    await userEvent.setup().click(screen.getByRole('button', { name: 'About up' }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('switch toggles and Edit opens', async () => {
    const { onToggle, onEdit } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Show Blog' }));
    expect(onToggle).toHaveBeenCalledWith('blog', true);
    await user.click(screen.getByRole('button', { name: 'Edit About' }));
    expect(onEdit).toHaveBeenCalledWith('about');
  });
});
