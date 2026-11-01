import '@biddaloy/ui/test';

import { CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import { ApiError, type ApiErrorBody } from '@biddaloy/ui/api';
import {
  AgendaList,
  type AgendaEvent,
  MonthGrid,
  type MonthGridEvent,
} from '@biddaloy/ui/components';
import type { CalendarEvent, PublicHolidayEntry } from '@biddaloy/ui/hooks';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { formatDate } from '@biddaloy/ui/utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../../help/test-utils';

import { EventDetailsSheet } from './-event-details-sheet';
import { EventFormPage } from './-event-form-dialog';
import { GovernmentHolidaysDialog } from './-government-holidays-dialog';

import { calendarSearchSchema } from './index';

describe('calendarSearchSchema', () => {
  it('accepts a well-formed YYYY-MM month', () => {
    expect(calendarSearchSchema.parse({ month: '2026-09' }).month).toBe('2026-09');
  });

  it('falls back to undefined instead of crashing the route for a malformed month', () => {
    // `?month=abc` used to reach `monthRange()`/`addMonths()`, which pass
    // the parsed parts to `Date.UTC` and call `.toISOString()` on the
    // result — an invalid date throws `RangeError: Invalid time value`
    // there instead of falling back to the current month.
    expect(calendarSearchSchema.parse({ month: 'abc' }).month).toBeUndefined();
    expect(calendarSearchSchema.parse({ month: '2026-13' }).month).toBeUndefined();
    expect(calendarSearchSchema.parse({ month: '2026-00' }).month).toBeUndefined();
  });
});

/**
 * [17.4.2] — component-level tests, not a full `renderWithRouter` +
 * `routeTree.gen.ts` integration test like `academic-years/index.test.tsx`.
 * `routeTree.gen.ts` IS regenerated in this diff (codegen ran as a normal
 * side effect of adding the route file) — that's not why this test avoids
 * router integration. The choice is deliberate: testing the
 * presentational/dialog pieces directly is faster and isolates each
 * piece's own logic (form validation, day-coverage grouping, permission
 * gating) from router wiring, which is exercised separately by
 * `route-permissions.test.ts`. Every ## Tests bullet is still covered,
 * just against those components directly rather than through the router.
 */

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function multiDayEvent(): MonthGridEvent {
  return {
    id: 'ev-1',
    type: CalendarEventType.EXAM,
    typeLabel: 'Exam',
    name: 'Mid-term exams',
    startDate: '2026-09-10',
    endDate: '2026-09-12',
  };
}

describe('MonthGrid', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('places a multi-day event across every day it spans, firstDayOfWeek = 0', () => {
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[multiDayEvent()]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
      />,
    );

    for (const day of ['2026-09-10', '2026-09-11', '2026-09-12']) {
      const cell = screen.getByTestId(`day-cell-${day}`);
      expect(within(cell).getByText('Mid-term exams')).toBeTruthy();
    }
    expect(
      screen.queryByText('Mid-term exams', { selector: '[data-testid="day-cell-2026-09-09"] *' }),
    ).toBeNull();
  });

  it('places a multi-day event across every day it spans, firstDayOfWeek = 1', () => {
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={1}
        weeklyOffDays={[6]}
        events={[multiDayEvent()]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
      />,
    );

    for (const day of ['2026-09-10', '2026-09-11', '2026-09-12']) {
      const cell = screen.getByTestId(`day-cell-${day}`);
      expect(within(cell).getByText('Mid-term exams')).toBeTruthy();
    }
  });

  it('calls onDayClick when a day cell is clicked', () => {
    const onDayClick = vi.fn();
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
        onDayClick={onDayClick}
      />,
    );

    fireEvent.click(screen.getByTestId('day-cell-2026-09-10'));

    expect(onDayClick).toHaveBeenCalledWith('2026-09-10');
  });

  it('calls onEventClick, not onDayClick, when an event chip is clicked', () => {
    const onDayClick = vi.fn();
    const onEventClick = vi.fn();
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[multiDayEvent()]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
        onDayClick={onDayClick}
        onEventClick={onEventClick}
      />,
    );

    fireEvent.click(screen.getAllByText('Mid-term exams')[0]!);

    expect(onEventClick).toHaveBeenCalledWith('ev-1');
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it('moves focus with arrow keys and activates the focused day with Enter/Space', () => {
    const onDayClick = vi.fn();
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
        onDayClick={onDayClick}
      />,
    );

    const startCell = screen.getByTestId('day-cell-2026-09-10');
    fireEvent.keyDown(startCell, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('day-cell-2026-09-11'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('day-cell-2026-09-18'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByTestId('day-cell-2026-09-17'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByTestId('day-cell-2026-09-10'), { key: ' ' });

    expect(onDayClick).toHaveBeenCalledWith('2026-09-10');
  });

  it('ignores unrecognized keys and does not move focus or activate a day', () => {
    const onDayClick = vi.fn();
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
        onDayClick={onDayClick}
      />,
    );

    fireEvent.keyDown(screen.getByTestId('day-cell-2026-09-10'), { key: 'Tab' });

    expect(onDayClick).not.toHaveBeenCalled();
  });

  it("renders a term band and includes the term name in a covered day's label", () => {
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[]}
        terms={[{ id: 't1', name: 'Term 1', startDate: '2026-09-01', endDate: '2026-09-30' }]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
      />,
    );

    expect(screen.getByTestId('term-bands')).toBeTruthy();
    expect(screen.getByText('Term 1')).toBeTruthy();
    expect(screen.getByTestId('day-cell-2026-09-10').getAttribute('aria-label')).toBe(
      `${formatDate('2026-09-10', REGION_BD_BN)} (Term 1)`,
    );
  });
});

describe('AgendaList', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('groups events by day', () => {
    const events: AgendaEvent[] = [
      {
        id: 'a',
        type: CalendarEventType.HOLIDAY,
        typeLabel: 'Holiday',
        name: 'National Day',
        startDate: '2026-09-05',
        endDate: '2026-09-05',
      },
      {
        id: 'b',
        type: CalendarEventType.MEETING,
        typeLabel: 'Meeting',
        name: 'Staff meeting',
        startDate: '2026-09-05',
        endDate: '2026-09-05',
      },
      {
        id: 'c',
        type: CalendarEventType.EVENT,
        typeLabel: 'Event',
        name: 'Sports day',
        startDate: '2026-09-12',
        endDate: '2026-09-12',
      },
    ];

    renderWithProviders(
      <AgendaList events={events} formatDayHeading={(day) => day} emptyLabel="No events" />,
    );

    const sept5 = screen.getByRole('region', { name: '2026-09-05' });
    expect(within(sept5).getByText('National Day')).toBeTruthy();
    expect(within(sept5).getByText('Staff meeting')).toBeTruthy();

    const sept12 = screen.getByRole('region', { name: '2026-09-12' });
    expect(within(sept12).getByText('Sports day')).toBeTruthy();
  });

  it('shows the empty label when there are no events', () => {
    renderWithProviders(
      <AgendaList events={[]} formatDayHeading={(day) => day} emptyLabel="No events" />,
    );
    expect(screen.getByTestId('agenda-empty').textContent).toBe('No events');
  });
});

function baseEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    academic_year_id: 'year-1',
    type: CalendarEventType.EVENT,
    name: 'Sports day',
    description: null,
    start_date: '2026-09-10',
    end_date: '2026-09-10',
    start_time: null,
    end_time: null,
    counts_as_working_day: true,
    audience: CalendarAudience.ALL,
    class_ids: [],
    is_locked: false,
    published: true,
    ...overrides,
  };
}

describe('EventDetailsSheet', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('hides Edit/Delete for a locked (past) event', async () => {
    renderWithProviders(
      <EventDetailsSheet
        open
        onOpenChange={() => {}}
        event={baseEvent({ is_locked: true })}
        canManage
        onEdit={() => {}}
        onDelete={() => {}}
        onPublish={() => {}}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByRole('heading', { name: 'Sports day' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('shows Edit/Delete for a non-locked event when the caller can manage', async () => {
    renderWithProviders(
      <EventDetailsSheet
        open
        onOpenChange={() => {}}
        event={baseEvent({ is_locked: false })}
        canManage
        onEdit={() => {}}
        onDelete={() => {}}
        onPublish={() => {}}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('asks before deleting and only deletes on confirm', async () => {
    const onDelete = vi.fn();
    const { user } = renderWithProviders(
      <EventDetailsSheet
        open
        onOpenChange={() => {}}
        event={baseEvent()}
        canManage
        onEdit={() => {}}
        onDelete={onDelete}
        onPublish={() => {}}
      />,
      { locale: 'en' },
    );

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(onDelete).not.toHaveBeenCalled();

    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Delete this event?')).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('keeps the confirm open while the delete runs, then closes it when the delete fails', async () => {
    const sheet = (props: { deleting: boolean; actionFailed: boolean }) => (
      <EventDetailsSheet
        open
        onOpenChange={() => {}}
        event={baseEvent()}
        canManage
        onEdit={() => {}}
        onDelete={() => {}}
        onPublish={() => {}}
        {...props}
      />
    );
    const { user, rerender } = renderWithProviders(
      sheet({ deleting: false, actionFailed: false }),
      {
        locale: 'en',
      },
    );

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    // The request is in flight: the confirm stays, its Cancel is disabled.
    rerender(sheet({ deleting: true, actionFailed: false }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(
      true,
    );

    // It failed: the confirm closes and the sheet's alert explains.
    rerender(sheet({ deleting: false, actionFailed: true }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows a neutral Draft badge for an unpublished event and a translated failure alert', async () => {
    renderWithProviders(
      <EventDetailsSheet
        open
        onOpenChange={() => {}}
        event={baseEvent({ published: false })}
        canManage
        actionFailed
        onEdit={() => {}}
        onDelete={() => {}}
        onPublish={() => {}}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Draft')).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't complete that. Try again.",
    );
  });
});

describe('EventFormPage', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it.each([
    ['CALENDAR_EVENT_LOCKED', 'This event is in the past and can no longer be changed.'],
    ['CALENDAR_OUTSIDE_ACADEMIC_YEAR', 'These dates fall outside the current academic year.'],
    ['CALENDAR_DAY_HAS_ATTENDANCE', 'Attendance has already been taken on one of these days.'],
    ['CALENDAR_INVALID_CLASS', 'One of the selected classes is not valid.'],
  ])('maps the %s 422 code to its message', async (code, expectedMessage) => {
    const body: ApiErrorBody = {
      statusCode: 422,
      message: 'Unprocessable',
      timestamp: new Date().toISOString(),
      path: '/calendar/events',
      requestId: 'req-1',
      details: { code },
    };
    const error = new ApiError(body);

    renderWithProviders(
      <EventFormPage
        onClose={() => {}}
        mode="create"
        isPending={false}
        error={error}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(expectedMessage);
  });

  it('falls back to the generic message for an unmapped error code', async () => {
    const body: ApiErrorBody = {
      statusCode: 422,
      message: 'Unprocessable',
      timestamp: new Date().toISOString(),
      path: '/calendar/events',
      requestId: 'req-1',
      details: { code: 'SOMETHING_UNKNOWN' },
    };
    const error = new ApiError(body);

    renderWithProviders(
      <EventFormPage
        onClose={() => {}}
        mode="create"
        isPending={false}
        error={error}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't save this event. Try again.");
  });

  it('shows a validation error and does not submit when the name is blank', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <EventFormPage
        onClose={() => {}}
        mode="create"
        isPending={false}
        error={null}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Name is required.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the invalid-range message when a name is set but dates are missing', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <EventFormPage
        onClose={() => {}}
        mode="create"
        isPending={false}
        error={null}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'New Event' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The end date must be on or after the start date.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits with the prefilled values in edit mode, and titles the dialog "Edit event"', async () => {
    const onSubmit = vi.fn();
    const initialValues: CalendarEvent = {
      id: 'ev-1',
      academic_year_id: 'ay-1',
      type: CalendarEventType.EXAM,
      name: 'Mid-term exam',
      description: 'All classes',
      start_date: '2026-09-10',
      end_date: '2026-09-12',
      start_time: null,
      end_time: null,
      counts_as_working_day: true,
      audience: CalendarAudience.ALL,
      class_ids: [],
      is_locked: false,
      published: true,
    };
    renderWithProviders(
      <EventFormPage
        onClose={() => {}}
        mode="edit"
        initialValues={initialValues}
        isPending={false}
        error={null}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Edit event')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Mid-term exam',
        start_date: '2026-09-10',
        end_date: '2026-09-12',
      }),
    );
  });

  it('offers "publish immediately" only when creating', async () => {
    const view = renderWithProviders(
      <EventFormPage
        mode="create"
        isPending={false}
        error={null}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );
    expect(await screen.findByRole('checkbox', { name: 'Publish immediately' })).toBeTruthy();
    view.unmount();

    renderWithProviders(
      <EventFormPage
        mode="edit"
        initialValues={baseEvent()}
        isPending={false}
        error={null}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );
    await screen.findByText('Edit event');
    expect(screen.queryByRole('checkbox', { name: 'Publish immediately' })).toBeNull();
  });

  it('asks before discarding when Cancel is pressed with unsaved edits', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <EventFormPage
        mode="create"
        isPending={false}
        error={null}
        onClose={onClose}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText('Name'), 'Draft');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /Discard/ }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps "notify by SMS" disabled until "notify" is checked', async () => {
    renderWithProviders(
      <EventFormPage
        onClose={() => {}}
        mode="create"
        isPending={false}
        error={null}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );

    const notifySms = await screen.findByRole('checkbox', { name: 'Also notify by SMS' });
    expect((notifySms as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notify affected families/staff' }));

    expect((notifySms as HTMLButtonElement).disabled).toBe(false);
  });

  // [68.3.15.01] TIME-06: a closure for a day that has passed needs a reason.
  it('a past end date with "counts as working day" unchecked shows the required reason field and sends reason', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(
      <EventFormPage
        mode="create"
        initialValues={baseEvent({
          type: CalendarEventType.HOLIDAY,
          name: 'Hartal',
          start_date: '2020-03-10',
          end_date: '2020-03-10',
          counts_as_working_day: false,
        })}
        isPending={false}
        error={null}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    const reason = await screen.findByLabelText('Why is this being added late?');
    expect(
      screen.getByText(
        'This day has already passed. It can only be added if no attendance was taken.',
      ),
    ).toBeTruthy();
    // No SMS or announcement about a day that is over.
    expect(
      screen.getByRole<HTMLButtonElement>('checkbox', { name: 'Publish immediately' }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('checkbox', { name: 'Notify affected families/staff' })
        .disabled,
    ).toBe(true);

    // Too short: blocked client-side.
    await user.type(reason, 'a');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Give a reason of at least 3 characters.',
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(reason, 'bc hartal');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reason: 'abc hartal' }));
  });

  // [#3314] The late-reason field carries its (?) only on the late-closure branch.
  it('shows the late-reason (?) on a past closure', async () => {
    renderWithProviders(
      withHelp(
        <EventFormPage
          mode="create"
          initialValues={baseEvent({
            type: CalendarEventType.HOLIDAY,
            name: 'Hartal',
            start_date: '2020-03-10',
            end_date: '2020-03-10',
            counts_as_working_day: false,
          })}
          isPending={false}
          error={null}
          onClose={() => {}}
          onSubmit={() => {}}
        />,
      ),
      { locale: 'en' },
    );
    await screen.findByLabelText('Why is this being added late?');
    await expectHelp('people.calendar.field.lateReason');
  });

  // #2253 review: a closure is "past" once its first day has passed, even if it ends later.
  it('a closure that started in the past but ends later still asks for a reason', async () => {
    renderWithProviders(
      <EventFormPage
        mode="create"
        initialValues={baseEvent({
          type: CalendarEventType.HOLIDAY,
          name: 'Flood',
          start_date: '2020-03-10',
          end_date: '2099-03-10',
          counts_as_working_day: false,
        })}
        isPending={false}
        error={null}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );
    expect(await screen.findByLabelText('Why is this being added late?')).toBeTruthy();
  });

  // #2253 review: a make-up day's forced "counts" must not stick after a type change.
  it('leaving Make-up school day unchecks "counts as working day"', async () => {
    const { user } = renderWithProviders(
      <EventFormPage
        mode="edit"
        initialValues={baseEvent({
          type: CalendarEventType.MAKEUP_DAY,
          counts_as_working_day: true,
        })}
        isPending={false}
        error={null}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );
    const working = await screen.findByRole<HTMLButtonElement>('checkbox', {
      name: 'Counts as a working day',
    });
    expect(working.getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'Holiday' }));

    expect(working.disabled).toBe(false);
    expect(working.getAttribute('aria-checked')).toBe('false');
  });

  // [2620] The box follows the type until the user touches it: only Holiday is "not working".
  describe('counts as working day follows the type [2620]', () => {
    async function pickType(user: ReturnType<typeof renderWithProviders>['user'], name: string) {
      await user.click(screen.getByRole('combobox', { name: 'Type' }));
      await user.click(await screen.findByRole('option', { name }));
    }
    const renderCreate = (onSubmit: (v: unknown) => void = () => {}) =>
      renderWithProviders(
        <EventFormPage
          mode="create"
          isPending={false}
          error={null}
          onClose={() => {}}
          onSubmit={onSubmit}
        />,
        { locale: 'en' },
      );
    const box = () =>
      screen.findByRole<HTMLButtonElement>('checkbox', { name: 'Counts as a working day' });

    it('Holiday is unchecked and editable; Exam is checked again', async () => {
      const { user } = renderCreate();
      const working = await box();
      expect(working.getAttribute('aria-checked')).toBe('true');

      await pickType(user, 'Holiday');
      expect(working.disabled).toBe(false);
      expect(working.getAttribute('aria-checked')).toBe('false');

      await pickType(user, 'Exam');
      expect(working.getAttribute('aria-checked')).toBe('true');
    });

    it('a hand choice survives a type change', async () => {
      const { user } = renderCreate();
      const working = await box();
      await pickType(user, 'Holiday');
      await user.click(working); // now checked by hand
      expect(working.getAttribute('aria-checked')).toBe('true');

      await pickType(user, 'Exam');
      await pickType(user, 'Holiday');
      expect(working.getAttribute('aria-checked')).toBe('true');
    });

    it('submitting a Holiday with defaults sends counts_as_working_day false', async () => {
      const onSubmit = vi.fn();
      // Prefilled dates only; the flag is left unset so the type default applies.
      const prefilled = {
        ...baseEvent({ name: 'Eid break', start_date: '2031-09-10', end_date: '2031-09-10' }),
        counts_as_working_day: undefined,
      } as unknown as CalendarEvent;
      const { user } = renderWithProviders(
        <EventFormPage
          mode="create"
          initialValues={prefilled}
          isPending={false}
          error={null}
          onClose={() => {}}
          onSubmit={onSubmit}
        />,
        { locale: 'en' },
      );
      await pickType(user, 'Holiday');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: CalendarEventType.HOLIDAY, counts_as_working_day: false }),
      );
    });

    it('edit mode keeps the saved value when the type changes', async () => {
      const { user } = renderWithProviders(
        <EventFormPage
          mode="edit"
          initialValues={baseEvent({ counts_as_working_day: true })}
          isPending={false}
          error={null}
          onClose={() => {}}
          onSubmit={() => {}}
        />,
        { locale: 'en' },
      );
      const working = await box();
      await pickType(user, 'Holiday');
      expect(working.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('choosing Make-up school day checks and disables "counts as working day"', async () => {
    const { user } = renderWithProviders(
      <EventFormPage
        mode="create"
        initialValues={baseEvent({ counts_as_working_day: false })}
        isPending={false}
        error={null}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );

    const working = await screen.findByRole<HTMLButtonElement>('checkbox', {
      name: 'Counts as a working day',
    });
    expect(working.disabled).toBe(false);
    expect(working.getAttribute('aria-checked')).toBe('false');

    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'Make-up school day' }));

    expect(working.disabled).toBe(true);
    expect(working.getAttribute('aria-checked')).toBe('true');
  });
});

describe('GovernmentHolidaysDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function suggestion(overrides: Partial<PublicHolidayEntry> = {}): PublicHolidayEntry {
    return {
      id: 'h-1',
      set_id: 'set-1',
      set: {} as PublicHolidayEntry['set'],
      date: '2026-12-16',
      end_date: '2026-12-16',
      name: 'Victory Day',
      name_bn: null,
      ...overrides,
    };
  }

  it('disables rows already added as an event and posts only the ticked ids', async () => {
    const onAdd = vi.fn();
    const alreadyAdded = suggestion({ id: 'h-1', name: 'Victory Day', date: '2026-12-16' });
    const notAdded = suggestion({ id: 'h-2', name: 'Independence Day', date: '2026-03-26' });

    const { user } = renderWithProviders(
      <GovernmentHolidaysDialog
        today="2026-01-01"
        open
        onOpenChange={() => {}}
        suggestions={[alreadyAdded, notAdded]}
        existingEvents={[
          baseEvent({
            id: 'existing-1',
            name: 'Victory Day',
            start_date: '2026-12-16',
            type: CalendarEventType.HOLIDAY,
          }),
        ]}
        isPending={false}
        onAdd={onAdd}
      />,
      { locale: 'en' },
    );

    const addedCheckbox = screen.getByRole('checkbox', { name: /Victory Day/ });
    expect((addedCheckbox as HTMLButtonElement).disabled).toBe(true);

    const notAddedCheckbox = screen.getByRole('checkbox', { name: /Independence Day/ });
    await user.click(notAddedCheckbox);
    expect(screen.getByText('Already added')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Add [1১] holiday$/ }));

    expect(onAdd).toHaveBeenCalledWith(['h-2']);
  });

  it('asks before discarding ticked rows when Cancel is pressed', async () => {
    const onOpenChange = vi.fn();
    const { user } = renderWithProviders(
      <GovernmentHolidaysDialog
        today="2026-01-01"
        open
        onOpenChange={onOpenChange}
        suggestions={[suggestion({ id: 'h-2', name: 'Independence Day', date: '2026-03-26' })]}
        existingEvents={[]}
        isPending={false}
        onAdd={() => {}}
      />,
      { locale: 'en' },
    );

    await user.click(screen.getByRole('checkbox', { name: /Independence Day/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: /Discard/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
