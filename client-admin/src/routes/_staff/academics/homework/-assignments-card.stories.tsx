import { HomeworkAssignmentStatus } from '@biddaloy/shared';
import type { RowAction } from '@biddaloy/ui/components';
import type { HomeworkAssignmentListItem } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarClock } from 'lucide-react';

import { AssignmentsCard, HOMEWORK_ASSIGNMENTS_LIST_CAP } from './-assignments-card';

/** #1013's "Who has this homework" card: a section row, a student row, a superseded row, a deactivated row. */
const row = (over: Partial<HomeworkAssignmentListItem>): HomeworkAssignmentListItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  homework_id: '00000000-0000-4000-8000-0000000000aa',
  section_id: '00000000-0000-4000-8000-0000000000b1',
  student_id: null,
  assigned_date: '2026-10-20',
  due_date: '2026-10-30',
  status: HomeworkAssignmentStatus.ACTIVE,
  target_section_id: '00000000-0000-4000-8000-0000000000b1',
  section_name: 'A',
  student_name: null,
  ...over,
});

const meta: Meta<typeof AssignmentsCard> = {
  component: AssignmentsCard,
  args: {
    loading: false,
    error: false,
    onRetry: () => undefined,
    onAssign: () => undefined,
    // #2900 D3: ACTIVE = Due date, Change, Deactivate; DEACTIVATED = Reactivate only.
    actionsFor: (r) => {
      // #2899: Check work leads every row, SUPERSEDED included.
      const check: RowAction = {
        intent: 'view',
        display: 'text',
        label: `Check work for ${r.section_name}`,
        shortLabel: 'Check work',
      };
      if (r.status === HomeworkAssignmentStatus.SUPERSEDED) return [check];
      if (r.status === HomeworkAssignmentStatus.DEACTIVATED) {
        return [
          check,
          {
            intent: 'restore',
            label: `Reactivate ${r.section_name}`,
            shortLabel: 'Reactivate',
          },
        ];
      }
      return [
        check,
        {
          intent: 'edit',
          icon: <CalendarClock />,
          label: `Change due date for ${r.section_name}`,
          shortLabel: 'Due date',
        },
        { intent: 'edit', label: `Change ${r.section_name}`, shortLabel: 'Change' },
        { intent: 'archive', label: `Deactivate ${r.section_name}`, shortLabel: 'Deactivate' },
      ];
    },
  },
};
export default meta;

type Story = StoryObj<typeof AssignmentsCard>;

export const Mixed: Story = {
  args: {
    assignments: [
      row({}),
      row({
        id: '00000000-0000-4000-8000-000000000002',
        section_id: null,
        student_id: '00000000-0000-4000-8000-0000000000c1',
        section_name: 'B',
        student_name: 'Rahim Uddin',
        due_date: '2026-10-28',
      }),
      row({
        id: '00000000-0000-4000-8000-000000000003',
        status: HomeworkAssignmentStatus.SUPERSEDED,
        due_date: '2026-10-27',
      }),
      row({
        id: '00000000-0000-4000-8000-000000000004',
        section_name: 'C',
        status: HomeworkAssignmentStatus.DEACTIVATED,
      }),
    ],
  },
};

/** #3173: the server lists at most 100 rows; a full page says older rows are not shown. */
export const Capped: Story = {
  args: {
    assignments: Array.from({ length: HOMEWORK_ASSIGNMENTS_LIST_CAP }, (_, i) =>
      row({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        section_name: `S${i}`,
      }),
    ),
  },
};

export const Empty: Story = { args: { assignments: [] } };

export const Loading: Story = { args: { loading: true } };

export const Error: Story = { args: { error: true } };
