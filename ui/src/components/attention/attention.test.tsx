/**
 * [67.2.02] The six presentational attention components: props in, callbacks
 * out. Strings come from the `attention` namespace, rendered in English.
 */
import { AlertSeverity } from '@biddaloy/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  alertItemFactory,
  attentionSummaryFactory,
  studentAlertFactory,
} from '../../test/factories/attention.factory';
import { renderWithProviders } from '../../test/render-with-providers';
import { APP_SHELL_MAIN_ID } from '../app-shell';
import { RowActionsLayoutContext } from '../row-actions';

import { AlertItemCard } from './alert-item-card';
import { AlertSnoozeMenu } from './alert-snooze-menu';
import { AttentionBar } from './attention-bar';
import { AttentionModal } from './attention-modal';
import { StudentAlertStrip } from './student-alert-strip';

async function setup(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
  });
  return view;
}

afterEach(() => vi.useRealTimers());

const critical = (n: string) =>
  alertItemFactory({
    recipientId: `c${n}`,
    severity: AlertSeverity.CRITICAL,
    title: `Critical ${n}`,
    closable: false,
  });
const warning = (n: string) =>
  alertItemFactory({
    recipientId: `w${n}`,
    severity: AlertSeverity.WARNING,
    title: `Warning ${n}`,
  });
const reminder = (n: string) =>
  alertItemFactory({
    recipientId: `r${n}`,
    severity: AlertSeverity.REMINDER,
    title: `Reminder ${n}`,
  });

describe('AttentionBar', () => {
  it('renders nothing for undefined and all-zero summaries, one button otherwise', async () => {
    const onOpen = vi.fn();
    const ref = React.createRef<HTMLButtonElement>();
    const { container } = await setup(
      <>
        <AttentionBar summary={undefined} onOpen={onOpen} />
        <AttentionBar summary={attentionSummaryFactory()} onOpen={onOpen} />
        <AttentionBar
          buttonRef={ref}
          onOpen={onOpen}
          summary={attentionSummaryFactory({
            critical: 2,
            warning: 1,
            reminder: 2,
            top: critical('1'),
          })}
        />
      </>,
    );
    const button = await screen.findByRole('button');
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(ref.current).toBe(button);
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.textContent).toContain(
      '2 urgent · 1 warning · 2 reminders · most urgent: Critical 1',
    );
    expect(container.querySelector('[data-tone="danger"]')).toBeTruthy();
    expect(container.querySelector('svg.lucide-octagon-alert')).toBeTruthy();
    await userEvent.setup().click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('uses the warning tone when nothing is urgent', async () => {
    const { container } = await setup(
      <AttentionBar
        onOpen={vi.fn()}
        summary={attentionSummaryFactory({ warning: 1, top: warning('1') })}
      />,
    );
    await screen.findByRole('button');
    expect(container.querySelector('[data-tone="warning"]')).toBeTruthy();
  });
});

describe('AlertItemCard', () => {
  const noop = () => {};
  const renderCard = (
    item = warning('1'),
    props: Partial<React.ComponentProps<typeof AlertItemCard>> = {},
  ) =>
    setup(
      <ul>
        <AlertItemCard item={item} onPrimary={noop} {...props} />
      </ul>,
    );

  it('critical shows the lock line and no Close', async () => {
    await renderCard(critical('1'), { onHide: noop });
    await screen.findByText('Stays until the work is done');
    expect(screen.queryByRole('button', { name: /Close/ })).toBeNull();
  });

  it('warning shows Close and Remind me later; reminder shows Close only', async () => {
    const onHide = vi.fn();
    const view = await renderCard(warning('1'), { onHide, onSnooze: noop });
    await screen.findByRole('button', { name: 'Remind me later' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close: Warning 1' }));
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'w1' }));
    view.unmount();

    await renderCard(reminder('1'), { onHide: noop, onSnooze: noop });
    await screen.findByRole('button', { name: 'Close: Reminder 1' });
    expect(screen.queryByRole('button', { name: 'Remind me later' })).toBeNull();
  });

  it('primary action calls onPrimary; no actionUrl means no primary button', async () => {
    const onPrimary = vi.fn();
    const view = await renderCard(warning('1'), { onPrimary });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'উপস্থিতি নিন' }));
    expect(onPrimary).toHaveBeenCalledOnce();
    view.unmount();

    const bare = alertItemFactory({ recipientId: 'x' });
    delete (bare as { actionUrl?: string }).actionUrl;
    await renderCard(bare);
    await screen.findByRole('heading', { level: 4 });
    expect(screen.queryByRole('button', { name: 'উপস্থিতি নিন' })).toBeNull();
  });

  it('shows at most three steps and the error in role="alert"', async () => {
    const item = alertItemFactory({ steps: ['a', 'b', 'c', 'd'] });
    const { container } = await renderCard(item, { error: 'That did not work. Try again.' });
    expect((await screen.findByRole('alert')).textContent).toBe('That did not work. Try again.');
    expect(container.querySelectorAll('ol > li')).toHaveLength(3);
  });
});

describe('AlertSnoozeMenu', () => {
  it.each([
    ['In 2 hours', 'TWO_HOURS'],
    ['Tomorrow morning', 'TOMORROW_MORNING'],
    ['Next school day', 'NEXT_SCHOOL_DAY'],
  ])('%s selects %s', async (text, choice) => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    await setup(<AlertSnoozeMenu onSelect={onSelect} />);
    await user.click(await screen.findByRole('button', { name: 'Remind me later' }));
    await user.click(await screen.findByRole('menuitem', { name: text }));
    expect(onSelect).toHaveBeenCalledWith(choice);
  });

  it('labelled layout shows the short text and keeps the full label as the name', async () => {
    await setup(
      <RowActionsLayoutContext.Provider value="labelled">
        <AlertSnoozeMenu
          triggerVariant="icon"
          label="Remind me later: Monthly test"
          onSelect={vi.fn()}
        />
      </RowActionsLayoutContext.Provider>,
    );
    const button = await screen.findByRole('button', { name: 'Remind me later: Monthly test' });
    expect(button.textContent).toBe('Remind me later');
  });

  it('icon layout renders no visible text', async () => {
    await setup(
      <AlertSnoozeMenu
        triggerVariant="icon"
        label="Remind me later: Monthly test"
        onSelect={vi.fn()}
      />,
    );
    const button = await screen.findByRole('button', { name: 'Remind me later: Monthly test' });
    expect(button.textContent).toBe('');
  });

  it('DATE opens a date dialog and saving returns YYYY-MM-DD', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-10T06:00:00Z') });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    await setup(<AlertSnoozeMenu onSelect={onSelect} />);
    await user.click(await screen.findByRole('button', { name: 'Remind me later' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pick a date…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remind me on' });
    expect(within(dialog).getByRole('button', { name: 'Remind me' }).hasAttribute('disabled')).toBe(
      true,
    );
    await user.click(within(dialog).getByRole('button', { name: /^Date, / }));
    await user.click(
      await waitFor(() => {
        const cell = document.querySelector<HTMLElement>('[data-date="2026-10-12"]');
        if (!cell) throw new Error('no cell');
        return cell;
      }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Remind me' }));
    expect(onSelect).toHaveBeenCalledWith('DATE', '2026-10-12');
  });
});

function Harness(props: Partial<React.ComponentProps<typeof AttentionModal>>) {
  const [open, setOpen] = React.useState(true);
  const returnRef = React.useRef<HTMLButtonElement>(null);
  const items = [critical('1'), critical('2'), warning('1'), reminder('1'), reminder('2')];
  return (
    <>
      <button ref={returnRef} type="button" onClick={() => setOpen(true)}>
        Bar
      </button>
      <AttentionModal
        open={open}
        onOpenChange={setOpen}
        items={items}
        summary={attentionSummaryFactory({ critical: 2, warning: 1, reminder: 2, staleMinutes: 0 })}
        onRetry={vi.fn()}
        onPrimary={vi.fn()}
        onHide={vi.fn()}
        onSnooze={vi.fn()}
        todoHref="/notifications"
        todoCount={5}
        returnFocusRef={returnRef}
        {...props}
      />
    </>
  );
}

describe('AttentionModal', () => {
  it('groups Urgent, Warning, Reminder with counts; only the first action is filled', async () => {
    const { baseElement } = await setup(<Harness />);
    const dialog = await screen.findByRole('dialog', { name: 'Your to-do' });
    const headings = within(dialog)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['Urgent · 2', 'Warning · 1', 'Reminder · 2']);
    const actions = within(dialog).getAllByRole('button', { name: 'উপস্থিতি নিন' });
    expect(actions).toHaveLength(5);
    const filled = actions.filter((b) => b.className.includes('bg-primary'));
    expect(filled).toHaveLength(1);
    expect(actions[0]).toBe(filled[0]);
    const link = within(dialog).getByRole('link', { name: 'See all to-do (5)' });
    expect(link.getAttribute('href')).toBe('/notifications');
    await expect(baseElement).toHaveNoViolations();
  });

  it('arrow keys move between cards, Enter does the main action, X closes closable cards', async () => {
    const onPrimary = vi.fn();
    const onHide = vi.fn();
    const user = userEvent.setup();
    await setup(<Harness onPrimary={onPrimary} onHide={onHide} />);
    const dialog = await screen.findByRole('dialog');
    const card = (id: string) => dialog.querySelector<HTMLElement>(`[data-alert-item="${id}"]`)!;
    await waitFor(() => expect(document.activeElement).toBe(card('c1')));

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(card('c2'));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(card('c1'));

    await user.keyboard('x');
    expect(onHide).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onPrimary).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'c1' }));

    card('w1').focus();
    await user.keyboard('x');
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'w1' }));
  });

  it('Esc closes and focus returns to the bar button', async () => {
    const user = userEvent.setup();
    await setup(<Harness />);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bar' })),
    );
  });

  it('focus is not forced back after the main action', async () => {
    const user = userEvent.setup();
    await setup(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getAllByRole('button', { name: 'উপস্থিতি নিন' })[0]!);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Bar' }));
  });

  it('shows the stale line past 15 minutes, and loading, error and empty states', async () => {
    const view = await setup(<Harness summary={attentionSummaryFactory({ staleMinutes: 20 })} />);
    expect((await screen.findByRole('dialog')).textContent).toContain(
      'Not updated for 20 minutes. The list may be out of date.',
    );
    view.unmount();

    const onRetry = vi.fn();
    const err = await setup(<Harness error onRetry={onRetry} items={[]} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    err.unmount();

    await setup(<Harness items={[]} />);
    await screen.findByText('Nothing needs you right now.');
  });

  it('with no card to focus (empty, error), focus still moves into the dialog', async () => {
    const empty = await setup(<Harness items={[]} />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    empty.unmount();

    await setup(<Harness error items={[]} />);
    const errDialog = await screen.findByRole('dialog');
    await waitFor(() => expect(errDialog.contains(document.activeElement)).toBe(true));
  });

  it('focus returns to whatever opened the dialog, not always the bar', async () => {
    function Openers() {
      const [open, setOpen] = React.useState(false);
      const barRef = React.useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={barRef} type="button">
            Bar
          </button>
          <button type="button" onClick={() => setOpen(true)}>
            Bell
          </button>
          <AttentionModal
            open={open}
            onOpenChange={setOpen}
            items={[warning('1')]}
            summary={undefined}
            onRetry={vi.fn()}
            onPrimary={vi.fn()}
            onHide={vi.fn()}
            onSnooze={vi.fn()}
            todoHref="/notifications"
            todoCount={1}
            returnFocusRef={barRef}
          />
        </>
      );
    }
    const user = userEvent.setup();
    await setup(<Openers />);
    await user.click(await screen.findByRole('button', { name: 'Bell' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bell' })),
    );
  });

  it('falls back to <main> when the opener and the bar are both gone', async () => {
    // Hiding the last alert unmounts the bar while the dialog stays open.
    function LastAlert() {
      const [open, setOpen] = React.useState(false);
      const [bar, setBar] = React.useState(true);
      const barRef = React.useRef<HTMLButtonElement>(null);
      return (
        <main id={APP_SHELL_MAIN_ID} tabIndex={-1}>
          {bar && (
            <button ref={barRef} type="button" onClick={() => setOpen(true)}>
              Bar
            </button>
          )}
          <AttentionModal
            open={open}
            onOpenChange={setOpen}
            items={[warning('1')]}
            summary={undefined}
            onRetry={vi.fn()}
            onPrimary={vi.fn()}
            onHide={() => setBar(false)}
            onSnooze={vi.fn()}
            todoHref="/notifications"
            todoCount={1}
            returnFocusRef={barRef}
          />
        </main>
      );
    }
    const user = userEvent.setup();
    await setup(<LastAlert />);
    await user.click(await screen.findByRole('button', { name: 'Bar' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(document.activeElement).toBe(dialog.querySelector('[data-alert-item="w1"]')),
    );
    await user.keyboard('x');
    expect(screen.queryByRole('button', { name: 'Bar' })).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById(APP_SHELL_MAIN_ID)),
    );
  });

  it('a successful Retry focuses the first card', async () => {
    function Retry() {
      const [ok, setOk] = React.useState(false);
      return <Harness error={!ok} items={ok ? [warning('1')] : []} onRetry={() => setOk(true)} />;
    }
    const user = userEvent.setup();
    await setup(<Retry />);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(document.activeElement).toBe(dialog.querySelector('[data-alert-item="w1"]')),
    );
  });

  it('X on a card whose hide is in flight does not hide it again', async () => {
    const onHide = vi.fn();
    const user = userEvent.setup();
    await setup(<Harness onHide={onHide} itemState={{ w1: { busy: true } }} />);
    const dialog = await screen.findByRole('dialog');
    dialog.querySelector<HTMLElement>('[data-alert-item="w1"]')!.focus();
    await user.keyboard('x');
    expect(onHide).not.toHaveBeenCalled();
  });
});

describe('StudentAlertStrip', () => {
  it('renders nothing without alerts', async () => {
    const { container } = await setup(<StudentAlertStrip studentName="Rafi" alerts={[]} />);
    expect(container.querySelector('section')).toBeNull();
  });

  it('shows the top alert, the seen line, and every alert in Details', async () => {
    const alerts = [
      studentAlertFactory({ title: 'Absent 3 days', seenCount: 3, recipientCount: 4 }),
      studentAlertFactory({ title: 'Fee overdue', severity: 'REMINDER' }),
    ];
    const user = userEvent.setup();
    const { container } = await setup(<StudentAlertStrip studentName="Rafi" alerts={alerts} />);
    const strip = await screen.findByRole('region', { name: 'Alerts about this student' });
    expect(strip.textContent).toContain('Warning: Absent 3 days');
    expect(strip.textContent).toContain('+1 more');
    expect(strip.textContent).toContain('Seen by 3 of 4');
    await expect(container).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Alerts about Rafi' });
    expect(within(dialog).getByText('Absent 3 days')).toBeTruthy();
    expect(within(dialog).getByText('Fee overdue')).toBeTruthy();
  });

  it('shows busy and the error line on the targeted card only', async () => {
    await setup(
      <Harness
        itemState={{ w1: { error: 'That did not work. Try again.' }, r1: { busy: true } }}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const cards = dialog.querySelectorAll<HTMLElement>('[data-alert-item]');
    const byId = (id: string) => dialog.querySelector<HTMLElement>(`[data-alert-item="${id}"]`)!;
    expect(cards.length).toBe(5);
    expect(within(byId('w1')).getByRole('alert').textContent).toBe('That did not work. Try again.');
    expect(within(dialog).getAllByRole('alert').length).toBe(1);
    expect(
      within(byId('r1'))
        .getAllByRole('button')
        .every((b) => b.hasAttribute('disabled')),
    ).toBe(true);
    expect(
      within(byId('r2'))
        .getAllByRole('button')
        .some((b) => b.hasAttribute('disabled')),
    ).toBe(false);
  });

  it('is axe clean when open', async () => {
    const { baseElement } = await setup(<Harness />);
    await screen.findByRole('dialog');
    await expect(baseElement).toHaveNoViolations();
  });
});
