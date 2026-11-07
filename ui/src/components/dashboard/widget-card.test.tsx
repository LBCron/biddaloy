import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, i18n, whenReady } from '../../i18n';
import { HelpProvider, type HelpIndex } from '../help-hint';
import { MenuItem } from '../menu';

import { WidgetCard, WidgetHelpContext } from './widget-card';

const base = { title: 'Student attendance' };

describe('WidgetCard full', () => {
  it('labels the section by its heading at the given level', () => {
    render(<WidgetCard {...base} headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Student attendance' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Student attendance' })).toBeTruthy();
  });

  it('renders value, unit, summary, caption, children and footer', () => {
    render(
      <WidgetCard
        {...base}
        value="91.4%"
        unit="present"
        summary="Up on last week"
        updatedLabel="Updated 2 min ago"
        footer={<a href="/x">Open</a>}
      >
        <p>chart body</p>
      </WidgetCard>,
    );
    for (const t of [
      '91.4%',
      'present',
      'Up on last week',
      'Updated 2 min ago',
      'chart body',
      'Open',
    ])
      expect(screen.getByText(t)).toBeTruthy();
  });

  it('shows a labelled menu button only when `menu` is set', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<WidgetCard {...base} />);
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<WidgetCard {...base} menuLabel="More" menu={<MenuItem>Export</MenuItem>} />);
    const btn = screen.getByRole('button', { name: 'More' });
    expect(btn.getAttribute('aria-label')).toBe('More');
    await user.click(btn);
    expect(screen.getByRole('menuitem', { name: 'Export' })).toBeTruthy();
  });

  it('loading is busy, hides children, keeps the title', () => {
    render(
      <WidgetCard {...base} loading loadingLabel="Loading attendance">
        <p>chart body</p>
      </WidgetCard>,
    );
    expect(screen.getByText('Loading attendance')).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('chart body')).toBeNull();
    expect(screen.getByText('Student attendance')).toBeTruthy();
  });

  it('error shows an alert and retries once', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<WidgetCard {...base} error={{ message: 'Failed', retryLabel: 'Retry', onRetry }} />);
    expect(screen.getByRole('alert').textContent).toBe('Failed');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('empty shows reason and action, not children', () => {
    render(
      <WidgetCard {...base} empty={{ reason: 'No data', action: <a href="/a">Add</a> }}>
        <p>chart body</p>
      </WidgetCard>,
    );
    expect(screen.getByText('No data')).toBeTruthy();
    expect(screen.getByText('Add')).toBeTruthy();
    expect(screen.queryByText('chart body')).toBeNull();
  });

  it('loading wins over error', () => {
    render(
      <WidgetCard
        {...base}
        loading
        error={{ message: 'Failed', retryLabel: 'Retry', onRetry: () => {} }}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('WidgetCard compact', () => {
  it('is one button that expands in place', async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    render(
      <WidgetCard
        {...base}
        variant="compact"
        value="91%"
        summary="Fine"
        footer={<a href="/x">Open</a>}
        onExpandedChange={onExpandedChange}
      >
        <p>chart body</p>
      </WidgetCard>,
    );
    const btn = screen.getByRole('button', { name: /Student attendance/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('chart body')).toBeNull();
    await user.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('chart body')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('respects controlled `expanded`', async () => {
    const user = userEvent.setup();
    render(
      <WidgetCard {...base} variant="compact" expanded={false}>
        <p>chart body</p>
      </WidgetCard>,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.queryByText('chart body')).toBeNull();
  });
});

describe('WidgetCard a11y', () => {
  it('is axe clean', async () => {
    const { container, rerender } = render(
      <WidgetCard {...base} value="1" summary="s">
        <p>x</p>
      </WidgetCard>,
    );
    await expect(container).toHaveNoViolations();
    rerender(<WidgetCard {...base} variant="compact" value="1" summary="s" defaultExpanded />);
    await expect(container).toHaveNoViolations();
    rerender(
      <WidgetCard {...base} error={{ message: 'F', retryLabel: 'Retry', onRetry: () => {} }} />,
    );
    await expect(container).toHaveNoViolations();
  });
});

describe('WidgetCard help (E23)', () => {
  const entry = (en: string) => ({
    title: { bn: en, en },
    summary: { bn: 's', en: 's' },
    path: 'dashboard/widgets',
    anchor: 'widget.x',
    knownIssues: 0,
  });
  const index: HelpIndex = { 'widget.x': entry('Attendance'), 'widget.y': entry('Other') };
  const wrap = (ui: React.ReactElement, idx: HelpIndex = index) =>
    render(
      <HelpProvider index={idx} lang="en" baseUrl="https://guide.test">
        {ui}
      </HelpProvider>,
      { wrapper: I18nProvider },
    );

  beforeEach(async () => {
    await whenReady(i18n);
    await i18n.changeLanguage('en');
  });

  it.each(['full', 'compact'] as const)('shows (?) from the context in %s', async (variant) => {
    wrap(
      <WidgetHelpContext.Provider value="widget.x">
        <WidgetCard {...base} variant={variant} />
      </WidgetHelpContext.Provider>,
    );
    // Named by the card title, not the shared guide page title (F10, WCAG 2.4.6).
    const btn = await screen.findByRole('button', { name: 'Help: Student attendance' });
    expect(btn.getAttribute('data-help-id')).toBe('widget.x');
  });

  it('shows nothing when the index lacks the id or no id is set', () => {
    wrap(
      <WidgetHelpContext.Provider value="widget.missing">
        <WidgetCard {...base} />
      </WidgetHelpContext.Provider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('helpId prop overrides the context', async () => {
    wrap(
      <WidgetHelpContext.Provider value="widget.x">
        <WidgetCard {...base} helpId="widget.y" />
      </WidgetHelpContext.Provider>,
    );
    const btn = await screen.findByRole('button', { name: 'Help: Student attendance' });
    expect(btn.getAttribute('data-help-id')).toBe('widget.y');
  });

  it('is axe clean with the (?)', async () => {
    const { container } = wrap(
      <WidgetCard
        {...base}
        helpId="widget.x"
        menuLabel="More"
        menu={<MenuItem>Export</MenuItem>}
      />,
    );
    await screen.findByRole('button', { name: 'Help: Student attendance' });
    await expect(container).toHaveNoViolations();
  });
});

describe('WidgetCard signal (#3594)', () => {
  it('critical shows an aria-hidden icon plus screen-reader label', () => {
    render(<WidgetCard {...base} signal="critical" signalLabel="Needs action" />);
    const label = screen.getByText('Needs action');
    expect(label.className).toContain('sr-only');
    expect(label.parentElement!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('region').className).toContain('border-s-signal-critical-fg');
  });

  it('compact critical tints its header band too; warn does not', () => {
    const { rerender } = render(
      <WidgetCard {...base} variant="compact" signal="critical" signalLabel="Needs action" />,
    );
    expect(screen.getByRole('heading').parentElement!.className).toContain('bg-signal-critical-bg');
    rerender(<WidgetCard {...base} variant="compact" signal="warn" signalLabel="Watch" />);
    expect(screen.getByRole('heading').parentElement!.className).not.toContain('bg-signal');
  });

  it('critical header band cancels its own padding, so the header does not shift', () => {
    render(<WidgetCard {...base} signal="critical" signalLabel="Needs action" />);
    const band = screen.getByRole('heading').parentElement!.className;
    expect(band).toContain('bg-signal-critical-bg');
    expect(band).toContain('py-1');
    expect(band).toContain('-my-1');
  });

  it('neutral and unset render no icon, bar or band', () => {
    const { rerender } = render(<WidgetCard {...base} signal="neutral" signalLabel="None" />);
    expect(screen.queryByText('None')).toBeNull();
    expect(screen.getByRole('region').className).not.toContain('border-s-');
    rerender(<WidgetCard {...base} />);
    expect(screen.getByRole('region').className).not.toContain('signal');
  });

  it('fail-open (D9): an errored or loading card shows no bar, icon or label', () => {
    const sig = { signal: 'critical' as const, signalLabel: 'Needs action' };
    const error = { message: 'Could not load', retryLabel: 'Try again', onRetry: () => {} };
    for (const variant of ['full', 'compact'] as const) {
      const { container, unmount } = render(
        <WidgetCard {...base} {...sig} variant={variant} error={error} />,
      );
      expect(screen.getByRole('region').className).not.toContain('border-s-');
      expect(container.querySelector('[data-signal]')).toBeNull();
      expect(container.querySelector('.text-signal-critical-fg')).toBeNull();
      expect(screen.queryByText('Needs action')).toBeNull();
      unmount();
      const loading = render(
        <WidgetCard {...base} {...sig} variant={variant} loading loadingLabel="Loading" />,
      );
      expect(screen.getByRole('region').className).not.toContain('border-s-');
      expect(loading.container.querySelector('.text-signal-critical-fg')).toBeNull();
      expect(screen.queryByText('Needs action')).toBeNull();
      loading.unmount();
    }
  });

  it('full: the marker follows the heading in reading order; the name stays the title', () => {
    render(<WidgetCard {...base} signal="warn" signalLabel="Keep an eye on this" />);
    const heading = screen.getByRole('heading', { name: 'Student attendance' });
    const marker = document.querySelector('[data-signal="warn"]')!;
    expect(heading.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(marker.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(marker.querySelector('.sr-only')!.textContent).toBe('Keep an eye on this');
    expect(screen.getByRole('region', { name: 'Student attendance' })).toBeTruthy();
  });

  it('compact: the level is the button description, not part of its name', () => {
    render(<WidgetCard {...base} variant="compact" signal="critical" signalLabel="Needs action" />);
    const btn = screen.getByRole('button', { name: 'Student attendance' });
    expect(btn.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(btn.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Needs action',
    );
    expect(btn.querySelector('svg.text-signal-critical-fg')!.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(screen.getByRole('region', { name: 'Student attendance' })).toBeTruthy();
  });
});
