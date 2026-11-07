import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ImportPreviewTable, sortPreviewRows, type PreviewRow } from './import-preview-table';

const base = {
  date: '2026-11-02',
  section_id: 's',
  class_name: 'Class 5',
  section_name: 'A',
  roll: 1,
  before: null,
  after: 'PRESENT',
} as const;

const rows: PreviewRow[] = [
  { ...base, row: 2, outcome: 'NEW' },
  { ...base, row: 3, outcome: 'UNCHANGED', before: 'PRESENT' },
  { ...base, row: 4, outcome: 'CHANGED', before: 'ABSENT', after: 'LATE' },
  { ...base, row: 5, outcome: 'ERROR', after: null, code: 'BAD_STATUS' },
];

afterEach(cleanupTestState);

describe('ImportPreviewTable', () => {
  it('orders errors, changed, new, unchanged', () => {
    expect(sortPreviewRows(rows).map((r) => r.outcome)).toEqual([
      'ERROR',
      'CHANGED',
      'NEW',
      'UNCHANGED',
    ]);
  });

  it('renders before → after and the translated problem', async () => {
    renderWithProviders(<ImportPreviewTable rows={rows} />, { locale: 'en' });

    expect(await screen.findByText('Absent → Late')).toBeTruthy();
    expect(screen.getByText('Not marked → Present')).toBeTruthy();
    expect(screen.getByText(/This status is not understood/)).toBeTruthy();
  });
});
