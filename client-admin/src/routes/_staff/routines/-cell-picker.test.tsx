import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../../help/test-utils';

import { CellPicker } from './-cell-picker';

afterEach(async () => {
  await cleanupTestState();
});

function mockLookups() {
  server.use(
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({
        data: [
          { id: 'subject-math', name_en: 'Math', name_bn: null, code: 'MATH', is_active: true },
          { id: 'subject-eng', name_en: 'English', name_bn: null, code: 'ENG', is_active: true },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/routines/rooms', () =>
      HttpResponse.json({
        data: [
          { id: 'room-1', room_no: '101', building: 'Main', capacity: 30 },
          { id: 'room-2', room_no: '102', building: null, capacity: 30 },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({
        data: [
          { id: 'teacher-1', user: { full_name: 'Ms Nahar' } },
          { id: 'teacher-2', user: { full_name: 'Mr Karim' } },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

describe('CellPicker', () => {
  it('disables Save until a subject and at least one teacher are picked, then saves both', async () => {
    mockLookups();
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CellPicker open onOpenChange={vi.fn()} onSave={onSave} />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true);

    await user.click(screen.getByText('Math'));
    await user.click(screen.getByLabelText('Ms Nahar'));
    await user.click(screen.getByLabelText('Mr Karim'));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      subjectId: 'subject-math',
      teacherIds: ['teacher-1', 'teacher-2'],
      recurrence: 'WEEKLY',
      recurrenceOffset: 0,
      roomId: null,
    });
  });

  it('saves the picked room, and null when "No room" is left', async () => {
    mockLookups();
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CellPicker open onOpenChange={vi.fn()} onSave={onSave} />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });
    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    await user.click(screen.getByText('Math'));
    await user.click(screen.getByLabelText('Ms Nahar'));
    await user.click(screen.getByRole('combobox', { name: 'Room (optional)' }));
    await user.click(await screen.findByRole('option', { name: 'Room 101 · Main' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'room-1' }));
  });

  it('pre-filters the subject list from a type-ahead character', async () => {
    mockLookups();
    renderWithProviders(
      <CellPicker open onOpenChange={vi.fn()} onSave={vi.fn()} initialFilter="e" />,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    await waitFor(() => expect(screen.getByText('English')).toBeTruthy());
    expect(screen.queryByText('Math')).toBeNull();
  });

  it('[1047] renders conflict violations inside the still-open dialog', async () => {
    mockLookups();
    renderWithProviders(
      <CellPicker
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        violations={[{ code: 'TEACHER_DOUBLE_BOOKED', message: 'Ms Nahar is already booked.' }]}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      'A teacher on this period is already teaching another section at this time.',
    );
    expect(alert.textContent).not.toContain('Ms Nahar is already booked.');
    // Still inside the dialog, not the page behind it.
    expect(screen.getByRole('dialog').contains(alert)).toBe(true);
  });

  it('shows the Bangla subject name on a Bangla screen when it is set', async () => {
    server.use(
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({
          data: [{ id: 'subject-math', name_en: 'Math', name_bn: 'গণিত', code: 'MATH' }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );
    renderWithProviders(<CellPicker open onOpenChange={vi.fn()} onSave={vi.fn()} />, {
      tenantId: 'tenant-1',
      locale: 'bn',
    });

    await waitFor(() => expect(screen.getByText('গণিত')).toBeTruthy());
    expect(screen.queryByText('Math')).toBeNull();
  });

  it('names the cell, uses an outline Cancel, and shows a labelled Select for a biweekly offset', async () => {
    mockLookups();
    const user = userEvent.setup();
    renderWithProviders(
      <CellPicker
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        dayLabel="Mon"
        periodLabel="Period 3"
        timeLabel="9:20 AM"
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    expect(screen.getByText('Mon · Period 3 · 9:20 AM')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBe(
      'outline',
    );
    expect(screen.queryByRole('combobox', { name: 'Which week' })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Biweekly' }));
    expect(screen.getByRole('combobox', { name: 'Which week' })).toBeTruthy();
    expect(document.querySelector('select')).toBeNull();
    expect(document.querySelector('input[type="radio"]')).toBeNull();
  });

  describe('repeat offsets [2996]', () => {
    async function open(onSave = vi.fn()) {
      mockLookups();
      const user = userEvent.setup();
      renderWithProviders(<CellPicker open onOpenChange={vi.fn()} onSave={onSave} />, {
        tenantId: 'tenant-1',
        locale: 'en',
      });
      await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
      await user.click(screen.getByText('Math'));
      await user.click(screen.getByLabelText('Ms Nahar'));
      return user;
    }

    it('MONTHLY defaults to the 1st occurrence and sends 1, never 0', async () => {
      const onSave = vi.fn();
      const user = await open(onSave);
      await user.click(screen.getByLabelText('Monthly'));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ recurrence: 'MONTHLY', recurrenceOffset: 1 }),
      );
    });

    it('MONTHLY "Last" sends -1', async () => {
      const onSave = vi.fn();
      const user = await open(onSave);
      await user.click(screen.getByLabelText('Monthly'));
      await user.click(screen.getByRole('combobox', { name: /which/i }));
      await user.click(await screen.findByRole('option', { name: 'Last' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recurrenceOffset: -1 }));
    });

    it('MONTHLY offers 1-5 and Last', async () => {
      const user = await open();
      await user.click(screen.getByLabelText('Monthly'));
      await user.click(screen.getByRole('combobox', { name: /which/i }));
      expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
        ...[1, 2, 3, 4, 5].map((n) => `Occurrence ${formatNumber(n, REGION_BD_BN)}`),
        'Last',
      ]);
    });

    it('BIWEEKLY still offers Week 1 / Week 2 and sends 0 / 1', async () => {
      const onSave = vi.fn();
      const user = await open(onSave);
      await user.click(screen.getByLabelText('Biweekly'));
      await user.click(screen.getByRole('combobox', { name: /which/i }));
      expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
        'Week 1',
        'Week 2',
      ]);
      await user.click(screen.getByRole('option', { name: 'Week 2' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ recurrence: 'BIWEEKLY', recurrenceOffset: 1 }),
      );
    });
  });
});

describe('CellPicker (?) hints [#3293]', () => {
  it('shows the teachers and recurrence (?)', async () => {
    mockLookups();
    renderWithProviders(withHelp(<CellPicker open onOpenChange={vi.fn()} onSave={vi.fn()} />), {
      tenantId: 'tenant-1',
      locale: 'en',
    });
    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    await expectHelp('academics.routineBuilder.field.teachers');
    await expectHelp('academics.routineBuilder.field.recurrence');
  });
});
