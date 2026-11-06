import type { MarksSheetPreviewSummary, PreviewResult } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SheetReview } from './-sheet-review';

const result: PreviewResult<MarksSheetPreviewSummary> = {
  staging_id: 'stage-1',
  expires_at: '2099-01-01T00:00:00Z',
  errors: [],
  hard_error_count: 0,
  summary: {
    summary: { rows: 1, new: 0, changed: 1, unchanged: 0, absent: 0, exempt: 0, errors: 0 },
    changes: [
      {
        row: 3,
        student_id: 'st-2',
        roll: 2,
        student_name: 'Nila Khan',
        component_id: 'c1',
        component_name: 'Written',
        old: '78',
        old_status: 'PRESENT',
        new: '85',
        new_status: 'PRESENT',
      },
    ],
  },
};

describe('SheetReview', () => {
  afterEach(cleanupTestState);

  // No RegionConfigProvider: the context default is Bangladesh / Bangla numerals.
  it('draws the roll and old → new marks in the region numeral system', async () => {
    renderWithProviders(<SheetReview result={result} />);
    expect(await screen.findByText('২ · Nila Khan')).toBeTruthy();
    expect(screen.getByText(/৭৮/)).toBeTruthy();
    expect(screen.getByText(/৮৫/)).toBeTruthy();
    expect(screen.queryByText(/78/)).toBeNull();
  });
});
