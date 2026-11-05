import type { PublicHolidaySet } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HolidaySetEditor, type HolidaySetEditorProps } from './-holiday-set-editor';

afterEach(cleanupTestState);

const BASE_SET = {
  id: 'set-1',
  country: 'BD',
  year: 2026,
  source: 'NAGER_DATE',
  published_at: null,
  fetched_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  entries: [
    {
      id: 'entry-1',
      set_id: 'set-1',
      date: '2026-02-21',
      end_date: '2026-02-21',
      name: 'International Mother Language Day',
      name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
    },
  ],
} as unknown as PublicHolidaySet;

function baseProps(overrides: Partial<HolidaySetEditorProps> = {}): HolidaySetEditorProps {
  return {
    set: BASE_SET,
    onSave: vi.fn(),
    isSaving: false,
    saveError: null,
    saveSucceeded: false,
    ...overrides,
  };
}

function renderEditor(overrides: Partial<HolidaySetEditorProps> = {}) {
  const props = baseProps(overrides);
  const view = renderWithProviders(<HolidaySetEditor {...props} />, { locale: 'en' });
  return { ...view, props };
}

describe('HolidaySetEditor', () => {
  it('adds a blank row when "Add holiday" is clicked', async () => {
    const { user } = renderEditor();

    await screen.findByDisplayValue('International Mother Language Day');
    expect(screen.getAllByLabelText('Name (English)')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Add holiday' }));

    expect(screen.getAllByLabelText('Name (English)')).toHaveLength(2);
  });

  it('removes a row when its named remove button is clicked', async () => {
    const { user } = renderEditor();

    await screen.findByDisplayValue('International Mother Language Day');
    await user.click(
      screen.getByRole('button', { name: 'Remove International Mother Language Day' }),
    );

    expect(screen.queryByDisplayValue('International Mother Language Day')).toBeNull();
  });

  it('shows the empty state once every row is removed', async () => {
    const { user } = renderEditor();

    await screen.findByDisplayValue('International Mother Language Day');
    await user.click(
      screen.getByRole('button', { name: 'Remove International Mother Language Day' }),
    );

    expect(await screen.findByText('This list has no holidays')).toBeTruthy();
  });

  it('shows a translated save error, never the raw message', async () => {
    renderEditor({ saveError: new Error('boom') });
    expect(await screen.findByText('Could not save these entries.')).toBeTruthy();
    expect(screen.queryByText('boom')).toBeNull();
  });

  it('Save is disabled when clean and the unsaved notice appears only when dirty', async () => {
    const { user } = renderEditor();

    await screen.findByDisplayValue('International Mother Language Day');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('You have unsaved changes')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add holiday' }));

    expect(screen.getByText('You have unsaved changes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('picking a date through DatePicker saves an ISO string', async () => {
    const { user, props } = renderEditor();

    await screen.findByDisplayValue('International Mother Language Day');
    await user.click(screen.getByRole('button', { name: /^Start date, / }));
    await screen.findByRole('grid', { name: 'Calendar' });
    await user.click(document.querySelector<HTMLElement>('[data-date="2026-02-23"]')!);
    await waitFor(() => expect(screen.queryByRole('grid', { name: 'Calendar' })).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(props.onSave).toHaveBeenCalledWith([
      expect.objectContaining({ date: '2026-02-23', end_date: '2026-02-21' }),
    ]);
  });
});
