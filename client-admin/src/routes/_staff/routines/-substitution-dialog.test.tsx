import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { formatTime } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../../help/test-utils';

import { SubstitutionDialog } from './-substitution-dialog';

// The dialog defaults its date to "today" and only lists periods on that
// weekday — pin the clock to a Monday (weekday 1). Only `Date` is faked.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 1, 2, 10));
});
afterAll(() => {
  vi.useRealTimers();
});

afterEach(async () => {
  await cleanupTestState();
});

function mockPickerData(weekday = 1) {
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [{ id: 'year-1', name: '2026', is_current: true }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [{ id: 'class-1', name: 'Class 6' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    // section-2 has no period in the routine, so it must never be offered.
    http.get('/api/v1/classes/class-1/sections', () =>
      HttpResponse.json([
        { id: 'section-1', section_name: 'A' },
        { id: 'section-2', section_name: 'B' },
      ]),
    ),
    http.get('/api/v1/routines', () =>
      HttpResponse.json([
        {
          id: 'routine-1',
          academic_year_id: 'year-1',
          state: 'PUBLISHED',
          created_at: '2026-01-01T00:00:00Z',
        },
      ]),
    ),
    http.get('/api/v1/routines/routine-1/slots', () =>
      HttpResponse.json([
        {
          slot: {
            id: 'slot-1',
            section_id: 'section-1',
            weekday,
            period_slot_id: 'p1',
            subject_id: 'subject-math',
            recurrence: 'WEEKLY',
            recurrence_offset: 0,
            valid_from: '2026-01-01',
            valid_to: null,
          },
          teacher_ids: ['teacher-1'],
          warnings: [],
        },
      ]),
    ),
    http.get('/api/v1/routines/shifts', () =>
      HttpResponse.json({
        data: [{ id: 'shift-1' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/routines/shifts/shift-1/period-slots', () =>
      HttpResponse.json([
        {
          id: 'p1',
          sequence: 1,
          kind: 'CLASS',
          name: null,
          starts_at: '08:00:00',
          ends_at: '08:40:00',
        },
      ]),
    ),
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({
        data: [{ id: 'subject-math', name_en: 'Math', name_bn: null, code: 'MATH' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({
        data: [
          { id: 'teacher-1', user: { id: 'user-1', full_name: 'Ms Nahar' } },
          { id: 'teacher-2', user: { id: 'user-2', full_name: 'Mr Karim' } },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

async function renderDialog(onDone = vi.fn()) {
  const { localeReady } = renderWithProviders(
    <SubstitutionDialog open onOpenChange={vi.fn()} onDone={onDone} />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  await localeReady;
}

async function pickSection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('combobox', { name: 'Class and section' }));
  await user.click(await screen.findByRole('option', { name: 'Class 6 – A' }));
}

describe('SubstitutionDialog', () => {
  it('offers only sections with periods and records a cover for the period on the date', async () => {
    mockPickerData();
    let posted: unknown = null;
    server.use(
      http.post('/api/v1/routines/substitutions', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'sub-1' });
      }),
    );
    const onDone = vi.fn();
    const user = userEvent.setup();
    await renderDialog(onDone);

    await user.click(await screen.findByRole('combobox', { name: 'Class and section' }));
    expect(await screen.findByRole('option', { name: 'Class 6 – A' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Class 6 – B' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Class 6 – A' }));

    await user.click(await screen.findByRole('combobox', { name: 'Period' }));
    await user.click(await screen.findByRole('option', { name: /Math · Ms Nahar/ }));

    // The slot's own teacher is never offered as the substitute.
    await user.click(screen.getByRole('combobox', { name: 'Substitute teacher' }));
    expect(screen.queryByRole('option', { name: 'Ms Nahar' })).toBeNull();
    await user.click(await screen.findByRole('option', { name: 'Mr Karim' }));

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      routine_slot_id: 'slot-1',
      date: '2026-02-02',
      substitute_teacher_id: 'teacher-2',
      is_cancelled: false,
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('shows a translated sentence, never the server message, when the date is not an occurrence', async () => {
    mockPickerData();
    server.use(
      http.post('/api/v1/routines/substitutions', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'This routine slot does not occur on 2026-02-02',
            requestId: 'req-1',
            details: { code: 'SLOT_NOT_ON_DATE' },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    await renderDialog();

    await pickSection(user);
    await user.click(await screen.findByRole('combobox', { name: 'Period' }));
    await user.click(await screen.findByRole('option', { name: /Math/ }));
    await user.click(screen.getByRole('combobox', { name: 'Substitute teacher' }));
    await user.click(await screen.findByRole('option', { name: 'Mr Karim' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("This period doesn't happen on the date you picked");
    expect(alert.textContent).not.toContain('does not occur on');
  });

  async function saveWith409(details: Record<string, unknown>, message: string) {
    mockPickerData();
    server.use(
      http.post('/api/v1/routines/substitutions', () =>
        HttpResponse.json(
          { statusCode: 409, message, requestId: 'req-3', details },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    await renderDialog();
    await pickSection(user);
    await user.click(await screen.findByRole('combobox', { name: 'Period' }));
    await user.click(await screen.findByRole('option', { name: /Math/ }));
    await user.click(screen.getByRole('combobox', { name: 'Substitute teacher' }));
    await user.click(await screen.findByRole('option', { name: 'Mr Karim' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    return screen.findByRole('alert');
  }

  it('says why when the substitute is busy, with the clash times', async () => {
    const alert = await saveWith409(
      { code: 'TEACHER_BUSY', from: '09:00', to: '09:40' },
      'Teacher busy server text',
    );
    expect(alert.textContent).toContain('This teacher has another class from');
    expect(alert.textContent).toContain(formatTime('09:00', REGION_BD_BN));
    expect(alert.textContent).toContain(formatTime('09:40', REGION_BD_BN));
    expect(alert.textContent).not.toContain('Could not save');
    expect(alert.textContent).not.toContain('server text');
  });

  it("says so when the substitute is the period's own teacher", async () => {
    const alert = await saveWith409(
      { code: 'SUBSTITUTE_IS_SLOT_TEACHER' },
      'Own teacher server text',
    );
    expect(alert.textContent).toContain('This teacher already teaches this period');
    expect(alert.textContent).not.toContain('Could not save');
    expect(alert.textContent).not.toContain('server text');
  });

  it('says an earlier-date substitution cannot be changed on SUBSTITUTION_IN_PAST (#3179)', async () => {
    const alert = await saveWith409({ code: 'SUBSTITUTION_IN_PAST' }, 'Past server text');
    expect(alert.textContent).toContain('part of the record and cannot be changed');
    expect(alert.textContent).not.toContain('Could not save');
    expect(alert.textContent).not.toContain('server text');
  });

  it('shows the generic error, not the not-on-date sentence, for any other 422', async () => {
    mockPickerData();
    server.use(
      http.post('/api/v1/routines/substitutions', () =>
        HttpResponse.json(
          { statusCode: 422, message: 'Something else went wrong', requestId: 'req-2' },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    await renderDialog();

    await pickSection(user);
    await user.click(await screen.findByRole('combobox', { name: 'Period' }));
    await user.click(await screen.findByRole('option', { name: /Math/ }));
    await user.click(screen.getByRole('combobox', { name: 'Substitute teacher' }));
    await user.click(await screen.findByRole('option', { name: 'Mr Karim' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not save');
    expect(alert.textContent).not.toContain("doesn't happen on the date");
  });

  it('does not offer a section whose only period ended before the date', async () => {
    mockPickerData();
    const slot = (id: string, sectionId: string, validTo: string | null) => ({
      slot: {
        id,
        section_id: sectionId,
        weekday: 1,
        period_slot_id: 'p1',
        subject_id: 'subject-math',
        recurrence: 'WEEKLY',
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: validTo,
      },
      teacher_ids: ['teacher-1'],
      warnings: [],
    });
    server.use(
      http.get('/api/v1/routines/routine-1/slots', () =>
        // The date is 2026-02-02: section B's period ended on 2026-01-31.
        HttpResponse.json([
          slot('slot-1', 'section-1', null),
          slot('slot-2', 'section-2', '2026-01-31'),
        ]),
      ),
    );
    const user = userEvent.setup();
    await renderDialog();

    await user.click(await screen.findByRole('combobox', { name: 'Class and section' }));
    expect(await screen.findByRole('option', { name: 'Class 6 – A' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Class 6 – B' })).toBeNull();
  });

  it('says so when the section has no period on the chosen weekday', async () => {
    mockPickerData(3);
    const user = userEvent.setup();
    await renderDialog();

    await pickSection(user);
    expect(await screen.findByText(/This section has no period on/)).toBeTruthy();
  });

  it('hides the substitute field when the period is cancelled, and has no native select', async () => {
    mockPickerData();
    const user = userEvent.setup();
    await renderDialog();

    expect(await screen.findByRole('combobox', { name: 'Substitute teacher' })).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: /nobody teaches it/ }));
    expect(screen.queryByRole('combobox', { name: 'Substitute teacher' })).toBeNull();
    expect(document.querySelector('select')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /^save$/i }).disabled).toBe(true);
  });
});

describe('SubstitutionDialog (?) hints [#3293]', () => {
  it('shows the cancelled and substitute teacher (?)', async () => {
    mockPickerData();
    const { localeReady } = renderWithProviders(
      withHelp(<SubstitutionDialog open onOpenChange={vi.fn()} onDone={vi.fn()} />),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await screen.findByRole('combobox', { name: 'Class and section' });
    await expectHelp('academics.routineSubstitutions.field.cancelled');
    await expectHelp('academics.routineSubstitutions.field.substituteTeacher');
  });
});
