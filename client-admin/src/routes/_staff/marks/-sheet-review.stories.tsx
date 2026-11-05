import type { MarksSheetChange, MarksSheetPreviewSummary, PreviewResult } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SheetReview } from './-sheet-review';

const change = (
  row: number,
  name: string,
  old: string | null,
  next: string | null,
  newStatus: MarksSheetChange['new_status'] = 'PRESENT',
): MarksSheetChange => ({
  row,
  student_id: `st-${row}`,
  roll: row - 1,
  student_name: name,
  component_id: 'c1',
  component_name: 'Written',
  old,
  old_status: old === null ? null : 'PRESENT',
  new: next,
  new_status: newStatus,
});

const result = (
  summary: MarksSheetPreviewSummary['summary'],
  changes: MarksSheetChange[],
): PreviewResult<MarksSheetPreviewSummary> => ({
  staging_id: 'stage-1',
  expires_at: '2099-01-01T00:00:00Z',
  errors: [],
  hard_error_count: 0,
  summary: { summary, changes },
});

const meta: Meta<typeof SheetReview> = { component: SheetReview };
export default meta;
type Story = StoryObj<typeof SheetReview>;

/** The usual case: a few new marks, a few corrections. */
export const Clean: Story = {
  args: {
    result: result(
      { rows: 38, new: 30, changed: 4, unchanged: 4, absent: 1, exempt: 0, errors: 0 },
      [
        change(2, 'Rafi Ahmed', null, '90'),
        change(3, 'Nila Khan', '78', '85'),
        change(4, 'Tanvir Hasan', '60', null, 'ABSENT'),
      ],
    ),
  },
};

/** Some rows failed: the count shows here, the error table is drawn by the upload card. */
export const WithErrors: Story = {
  args: {
    result: result(
      { rows: 38, new: 0, changed: 2, unchanged: 34, absent: 0, exempt: 0, errors: 2 },
      [change(3, 'Nila Khan', '78', '85')],
    ),
  },
};

/** Nothing in the sheet differs from what is saved. */
export const ZeroValid: Story = {
  args: {
    result: result(
      { rows: 38, new: 0, changed: 0, unchanged: 38, absent: 0, exempt: 0, errors: 0 },
      [],
    ),
  },
};
