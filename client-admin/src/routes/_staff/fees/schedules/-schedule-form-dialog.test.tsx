/**
 * [16.7.5] Create/Edit schedule dialog — rendered directly, not through
 * a routed page, matching `record-payment-modal.test.tsx`'s precedent
 * for a modal with no route of its own to mount through.
 *
 * Covers issue #679's own Tests list: the rule editor round-trips
 * (set monthly, save, reopen in edit mode, same rule shown) and ends-on
 * gets capped to the selected academic year's end date.
 *
 * The submitted-body assertions are deliberately exact (`toEqual`, not
 * `toMatchObject`). An earlier version of this file asserted the dialog's
 * own hand-typed interim shape (`rule.mode`, `audience.active_only`),
 * which meant the test passed while every real request was rejected by
 * the server for a missing `rule.kind` / `audience.enrollment_status`.
 * Assert the shape `CreateRecurringScheduleDto` actually validates.
 */
import type { RecurringSchedule } from '@biddaloy/ui/hooks';
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import {
  academicYearFactory,
  cleanupTestState,
  feeStructureFactory,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../../../help/test-utils';

import { ScheduleFormDialog } from './-schedule-form-dialog';

const YEAR = academicYearFactory({
  id: 'year-1',
  name: '2026-2027',
  start_date: '2026-01-01T00:00:00.000Z',
  end_date: '2026-12-31T00:00:00.000Z',
});
const FEE = feeStructureFactory({ id: 'fee-1', name: 'Monthly Tuition', academic_year: YEAR });

function paginated<T>(rows: T[]) {
  return { data: rows, total: rows.length, page: 1, limit: 50, totalPages: 1 };
}

function referenceHandlers() {
  return [
    http.get('/api/v1/academic-years', () => HttpResponse.json(paginated([YEAR]))),
    http.get('/api/v1/fee-structures', () => HttpResponse.json(paginated([FEE]))),
    http.get('/api/v1/classes', () => HttpResponse.json(paginated([]))),
    http.get('/api/v1/programs', () => HttpResponse.json([])),
  ];
}

function schedule(overrides: Partial<RecurringSchedule> = {}): RecurringSchedule {
  return {
    id: 'schedule-1',
    name: 'Monthly tuition',
    academic_year_id: 'year-1',
    fee_structure_ids: ['fee-1'],
    audience: { enrollment_status: 'ACTIVE' },
    rule: { kind: 'MONTHLY', day_of_month: 1 },
    period_type: 'MONTH',
    due_days_after_period_start: 7,
    starts_on: '2026-01-01',
    ends_on: '',
    notify_families: false,
    is_active: true,
    last_run_period: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// The default test RegionConfig is Bangla; pin English digits. ADMIN holds PROGRAM_READ.
async function renderDialog(
  props: Partial<React.ComponentProps<typeof ScheduleFormDialog>> = {},
  role = 'ADMIN',
) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <ScheduleFormDialog
        open
        onOpenChange={onOpenChange}
        mode="create"
        onSaved={onSaved}
        {...props}
      />
    </RegionConfigProvider>,
    { tenantId: 'tenant-1', role, locale: 'en' },
  );
  await view.localeReady;
  return { ...view, onOpenChange, onSaved };
}

describe('ScheduleFormDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('creates a monthly-rule schedule and submits the chosen day of month', async () => {
    server.use(...referenceHandlers());
    let submittedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/schedules', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(schedule({ ...(submittedBody as object) }));
      }),
    );

    const { onSaved } = await renderDialog();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Rule name * (required)'), 'Monthly tuition');
    await user.click(await screen.findByRole('combobox', { name: /^Academic year/ }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Monthly Tuition/ })).toBeTruthy(),
    );
    await user.click(screen.getByRole('checkbox', { name: /Monthly Tuition/ }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // `kind`, not `mode` — `RecurringScheduleRuleDto.kind` is `@IsIn`
    // and required, so a body carrying `mode` is a 400.
    expect(submittedBody?.rule).toEqual({ kind: 'MONTHLY', day_of_month: 1 });
    // `enrollment_status` is required and `'ACTIVE'` is its only accepted
    // value; there is no `active_only` field on the server's audience DTO,
    // and `forbidNonWhitelisted` would reject one.
    expect(submittedBody?.audience).toEqual({ enrollment_status: 'ACTIVE' });
    expect(submittedBody?.audience).not.toHaveProperty('active_only');
    expect(submittedBody?.rule).not.toHaveProperty('mode');
  });

  it('submits ISO weekday numbers, not weekday name strings, for a weekly rule', async () => {
    server.use(...referenceHandlers());
    let submittedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/schedules', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(schedule({ ...(submittedBody as object) }));
      }),
    );

    const { onSaved } = await renderDialog();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Rule name * (required)'), 'Weekly transport');
    await user.click(await screen.findByRole('combobox', { name: /^Academic year/ }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Monthly Tuition/ })).toBeTruthy(),
    );
    await user.click(screen.getByRole('checkbox', { name: /Monthly Tuition/ }));

    await user.click(await screen.findByRole('combobox', { name: 'How often' }));
    await user.click(await screen.findByRole('option', { name: 'Every week' }));
    // Chips are labelled from `common:weekdays.<iso>` — Mon = 1, Thu = 4.
    await user.click(await screen.findByRole('button', { name: 'Mon', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'Thu', pressed: false }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // `recurrence.util.ts` reads ISO weekday numbers (1 = Monday .. 7 =
    // Sunday). The interim client sent `['MON', 'THU']`, which never
    // matched any day.
    expect(submittedBody?.rule).toEqual({ kind: 'WEEKLY', weekdays: [1, 4] });
  });

  it('round-trips a saved monthly rule when reopened in edit mode', async () => {
    server.use(...referenceHandlers());
    const existing = schedule({ rule: { kind: 'MONTHLY', day_of_month: 15 } });

    await renderDialog({ mode: 'edit', schedule: existing });

    const daySelect = await screen.findByLabelText('Day of the month');
    expect(daySelect.textContent).toBe('Day 15');
  });

  it('caps ends-on to the selected academic year end date', async () => {
    server.use(...referenceHandlers());
    const existing = schedule({ ends_on: '2027-06-30' });

    await renderDialog({ mode: 'edit', schedule: existing });

    // The year's `end_date` (2026-12-31) is earlier than the saved
    // `ends_on` (2027-06-30) — the clamp effect should pull it back.
    expect(await screen.findByText('31st December, 2026')).toBeTruthy();
  });

  it('shows every unmet requirement at once, under its field', async () => {
    server.use(...referenceHandlers());
    const { onSaved } = await renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Name, year and fees are all reported together, each under its own control.
    expect(await screen.findByText('Name is required')).toBeTruthy();
    expect(screen.getByText('Choose an academic year')).toBeTruthy();
    expect(screen.getByText('Select at least one fee')).toBeTruthy();
    const name = screen.getByLabelText('Rule name * (required)');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe('schedule-form-name-error');
    expect(document.activeElement).toBe(name);

    // Weekly with no day chosen is reported the same way.
    await user.click(await screen.findByRole('combobox', { name: 'How often' }));
    await user.click(await screen.findByRole('option', { name: 'Every week' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Select at least one day')).toBeTruthy();

    expect(onSaved).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', async () => {
    server.use(...referenceHandlers());
    await renderDialog({ open: false });
    expect(screen.queryByRole('heading', { name: 'New automatic billing rule' })).toBeNull();
  });

  it('asks before discarding once the name is edited', async () => {
    server.use(...referenceHandlers());
    const { onOpenChange } = await renderDialog();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Rule name * (required)'), 'Monthly');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    const confirm = within(await screen.findByRole('alertdialog'));
    expect(confirm.getByText('Discard your changes?')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('has no program field and requests no programs without PROGRAM_READ', async () => {
    let programsRequested = false;
    server.use(
      ...referenceHandlers(),
      http.get('/api/v1/programs', () => {
        programsRequested = true;
        return HttpResponse.json([]);
      }),
    );

    await renderDialog({}, 'ACCOUNTANT');
    await screen.findByLabelText('Rule name * (required)');

    expect(screen.queryByRole('combobox', { name: 'Program' })).toBeNull();
    expect(programsRequested).toBe(false);
  });

  it('saves an edited schedule via PATCH, not POST', async () => {
    server.use(...referenceHandlers());
    const existing = schedule({ id: 'schedule-9' });
    let patched = false;
    server.use(
      http.patch('/api/v1/fees/schedules/:id', ({ params }) => {
        patched = params.id === 'schedule-9';
        return HttpResponse.json(existing);
      }),
    );

    const { onSaved } = await renderDialog({ mode: 'edit', schedule: existing });
    const user = userEvent.setup();
    await screen.findByLabelText('Day of the month');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patched).toBe(true);
  });

  it('preselects the saved program when a schedule opens in edit mode', async () => {
    server.use(
      http.get('/api/v1/programs', () =>
        HttpResponse.json([{ id: 'program-hifz', name: 'Hifz', is_active: true }]),
      ),
      ...referenceHandlers(),
    );
    const existing = schedule({
      audience: { enrollment_status: 'ACTIVE', program_id: 'program-hifz' },
    });

    await renderDialog({ mode: 'edit', schedule: existing });

    const programSelect = await screen.findByLabelText('Program');
    await within(programSelect).findByText('Hifz');
  });

  it('only requests archived programs when editing a schedule that already has one', async () => {
    server.use(...referenceHandlers());
    let createModeIncludeArchived: string | null = null;
    server.use(
      http.get('/api/v1/programs', ({ request }) => {
        createModeIncludeArchived = new URL(request.url).searchParams.get('include_archived');
        return HttpResponse.json([]);
      }),
    );
    await renderDialog({ mode: 'create' });
    await waitFor(() => expect(createModeIncludeArchived).not.toBeNull());
    expect(createModeIncludeArchived).toBe('false');
    await cleanupTestState();

    server.use(...referenceHandlers());
    let editModeIncludeArchived: string | null = null;
    server.use(
      http.get('/api/v1/programs', ({ request }) => {
        editModeIncludeArchived = new URL(request.url).searchParams.get('include_archived');
        return HttpResponse.json([{ id: 'program-hifz', name: 'Hifz', is_active: false }]);
      }),
    );
    const existing = schedule({
      audience: { enrollment_status: 'ACTIVE', program_id: 'program-hifz' },
    });
    await renderDialog({ mode: 'edit', schedule: existing });
    await waitFor(() => expect(editModeIncludeArchived).not.toBeNull());
    expect(editModeIncludeArchived).toBe('true');
  });

  it('includes program_id in the saved audience when a program is chosen', async () => {
    server.use(
      http.get('/api/v1/programs', () =>
        HttpResponse.json([{ id: 'program-hifz', name: 'Hifz', is_active: true }]),
      ),
      ...referenceHandlers(),
    );
    let submittedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/schedules', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(schedule({ ...(submittedBody as object) }));
      }),
    );

    const { onSaved } = await renderDialog();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Rule name * (required)'), 'Hifz monthly fee');
    await user.click(await screen.findByRole('combobox', { name: /^Academic year/ }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Monthly Tuition/ })).toBeTruthy(),
    );
    await user.click(screen.getByRole('checkbox', { name: /Monthly Tuition/ }));

    await user.click(await screen.findByRole('combobox', { name: 'Program' }));
    await user.click(await screen.findByRole('option', { name: 'Hifz' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(submittedBody?.audience).toEqual({
      enrollment_status: 'ACTIVE',
      program_id: 'program-hifz',
    });
  });

  async function fillValid(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText('Rule name * (required)'), 'Monthly tuition');
    await user.click(await screen.findByRole('combobox', { name: /^Academic year/ }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Monthly Tuition/ })).toBeTruthy(),
    );
    await user.click(screen.getByRole('checkbox', { name: /Monthly Tuition/ }));
  }

  it('sends Bangla-typed due days as the number they mean', async () => {
    server.use(...referenceHandlers());
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/schedules', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(schedule());
      }),
    );
    const { onSaved } = await renderDialog();
    const user = userEvent.setup();
    await fillValid(user);
    const due = screen.getByLabelText('Days to pay');
    await user.clear(due);
    await user.type(due, '১০');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body?.due_days_after_period_start).toBe(10);
  });

  it('shows a field error and sends nothing for a blank or out-of-range due days', async () => {
    server.use(...referenceHandlers());
    let posted = false;
    server.use(
      http.post('/api/v1/fees/schedules', () => {
        posted = true;
        return HttpResponse.json(schedule());
      }),
    );
    await renderDialog();
    const user = userEvent.setup();
    await fillValid(user);
    const due = screen.getByLabelText('Days to pay');

    await user.clear(due);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter the days to pay')).toBeTruthy();

    await user.type(due, '61');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Days to pay must be between 0 and 60')).toBeTruthy();
    expect(posted).toBe(false);
  });

  it('footer Cancel asks before discarding a changed form and closes at once when untouched', async () => {
    server.use(...referenceHandlers());
    const { onOpenChange } = await renderDialog();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();
  });

  it('footer Cancel after an edit shows the discard dialog', async () => {
    server.use(...referenceHandlers());
    const { onOpenChange } = await renderDialog();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Rule name * (required)'), 'Monthly');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const confirm = within(await screen.findByRole('alertdialog'));
    expect(confirm.getByText('Discard your changes?')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(confirm.getByRole('button', { name: 'Discard changes' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ScheduleFormDialog (?) hints [#3293]', () => {
  it('shows the audience, rule and due days (?)', async () => {
    server.use(...referenceHandlers());
    const view = renderWithProviders(
      withHelp(
        <RegionConfigProvider value={REGION_BD_EN}>
          <ScheduleFormDialog open onOpenChange={vi.fn()} mode="create" onSaved={vi.fn()} />
        </RegionConfigProvider>,
      ),
      { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
    );
    await view.localeReady;
    await expectHelp('finance.recurringSchedules.field.audience');
    await expectHelp('finance.recurringSchedules.field.rule');
    await expectHelp('finance.recurringSchedules.field.dueDays');
    await cleanupTestState();
  });
});
