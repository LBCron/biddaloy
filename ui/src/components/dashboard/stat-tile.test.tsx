import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatTile } from './stat-tile';

describe('StatTile', () => {
  it('renders label, value, trend text with a hidden icon', () => {
    render(<StatTile label="Dues" value="12k" trend={{ direction: 'up', text: '+4%' }} />);
    expect(screen.getByText('Dues')).toBeTruthy();
    expect(screen.getByText('12k')).toBeTruthy();
    const trend = screen.getByText('+4%');
    expect(trend.parentElement!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('merges tile classes onto an asChild link', () => {
    render(
      <StatTile asChild label="Dues" value="1">
        <a href="/dues">link</a>
      </StatTile>,
    );
    const a = screen.getByRole('link');
    expect(a.getAttribute('href')).toBe('/dues');
    expect(a.className).toContain('border-border-subtle');
  });

  it('tone bad uses the overdue colour, default is neutral', () => {
    const { rerender } = render(
      <StatTile label="L" value="1" trend={{ direction: 'down', text: 'down', tone: 'bad' }} />,
    );
    expect(screen.getByText('down').parentElement!.className).toContain('text-status-overdue-fg');
    rerender(<StatTile label="L" value="1" trend={{ direction: 'flat', text: 'flat' }} />);
    expect(screen.getByText('flat').parentElement!.className).toContain('text-text-secondary');
  });

  it('is axe clean', async () => {
    const { container } = render(
      <StatTile label="L" value="1" note="n" trend={{ direction: 'up', text: '+1' }} />,
    );
    await expect(container).toHaveNoViolations();
  });
});

describe('StatTile signal (#3594)', () => {
  it('colours the value and adds icon + sr label; neutral adds none', () => {
    const { rerender } = render(<StatTile label="L" value="9" signal="warn" signalLabel="Watch" />);
    expect(screen.getByText('Watch').parentElement!.className).toContain('text-signal-warn-fg');
    rerender(<StatTile label="L" value="9" signal="neutral" signalLabel="Watch" />);
    expect(screen.queryByText('Watch')).toBeNull();
  });
});
