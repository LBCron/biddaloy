import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { BriefingChip, BriefingLine } from './briefing-line';

const base = {
  headline: 'Good morning! 4 things need you today',
  mostUrgent: 'Most urgent: attendance not taken in 3 sections.',
  action: <button type="button">Take attendance</button>,
  items: (
    <>
      <BriefingChip>2 fees overdue</BriefingChip>
      <BriefingChip>1 leave request</BriefingChip>
    </>
  ),
  itemsLabel: 'Also:',
  moreLabel: '2 more things',
};

describe('BriefingLine', () => {
  it('names the section by its headline and renders mostUrgent and caption', () => {
    render(<BriefingLine {...base} caption="Updated 9:00" />);
    expect(screen.getByRole('region', { name: base.headline })).toBeTruthy();
    expect(screen.getByText(base.mostUrgent)).toBeTruthy();
    expect(screen.getByText('Updated 9:00')).toBeTruthy();
  });

  it('renders the action once and the chips inside one list', () => {
    render(<BriefingLine {...base} />);
    expect(screen.getAllByRole('button', { name: 'Take attendance' })).toHaveLength(1);
    const list = screen.getByRole('list', { hidden: true });
    expect(list.querySelectorAll('li')).toHaveLength(2);
  });

  it('phone disclosure toggles aria-expanded and controls the chip list', async () => {
    render(<BriefingLine {...base} />);
    const toggle = screen.getByRole('button', { name: '2 more things' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const list = screen.getByRole('list', { hidden: true });
    expect(toggle.getAttribute('aria-controls')).toBe(list.id);
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('has no disclosure without items', () => {
    render(<BriefingLine headline="All calm" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('loading is busy and hides the headline', () => {
    const { container } = render(
      <BriefingLine headline="Hidden" loading loadingLabel="Loading briefing" />,
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('Hidden')).toBeNull();
    expect(screen.getByText('Loading briefing')).toBeTruthy();
  });

  it('BriefingChip asChild renders a link with chip classes', () => {
    render(
      <BriefingChip asChild>
        <a href="/fees">Fees</a>
      </BriefingChip>,
    );
    const link = screen.getByRole('link', { name: 'Fees' });
    expect(link.className).toContain('rounded-full');
  });

  it('is axe clean collapsed and expanded', async () => {
    const { container } = render(<BriefingLine {...base} />);
    await expect(container).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: '2 more things' }));
    await expect(container).toHaveNoViolations();
  });
});

describe('BriefingLine signal (#3594)', () => {
  it('shows the level icon with an sr label', () => {
    render(<BriefingLine headline="H" signal="critical" signalLabel="Needs action" />);
    expect(screen.getByText('Needs action').parentElement!.className).toContain(
      'text-signal-critical-fg',
    );
  });

  it('reads the headline first: the marker follows the h2 in the DOM, shown first with order-first', () => {
    render(<BriefingLine headline="H" signal="warn" signalLabel="Watch" />);
    const heading = screen.getByRole('heading', { name: 'H' });
    const marker = document.querySelector('[data-signal="warn"]')!;
    expect(heading.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(marker.className).toContain('order-first');
  });
});
