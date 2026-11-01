import type { Meta, StoryObj } from '@storybook/react-vite';

import { ClassCard } from './-cards';

/** [83.4.1] The My coordination card: all taken, some not taken, subject-level. */
const teachers = [
  {
    user_id: 'u1',
    teacher_id: 't1',
    full_name: 'Rahima Begum',
    section_names: ['A'],
    subject_names: ['Mathematics'],
  },
  {
    user_id: 'u2',
    teacher_id: 't2',
    full_name: 'Karim Uddin',
    section_names: ['B'],
    subject_names: ['Bangla'],
  },
];
const section = (id: string, name: string, taken: boolean) => ({
  section_id: id,
  section_name: name,
  attendance_taken: taken,
  taken_by_name: taken ? 'Rahima Begum' : null,
  class_teacher_name: 'Rahima Begum',
});
const base = {
  class_id: 'k7',
  class_name: 'Class 7',
  subject_id: null,
  subject_name: null,
  sections: [section('a', 'A', true), section('b', 'B', true)],
  pending_grids: [],
  teachers,
};

const meta: Meta<typeof ClassCard> = {
  title: 'MyCoordination/ClassCard',
  component: ClassCard,
  args: { cls: base, date: '2026-10-20', onNotify: () => undefined },
  decorators: [
    (Story) => (
      <div className="w-[390px] md:w-[560px]">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof ClassCard>;

export const AllTaken: Story = {};

export const SomeNotTaken: Story = {
  args: {
    cls: {
      ...base,
      sections: [section('a', 'A', true), section('b', 'B', false)],
      pending_grids: [
        {
          exam_id: 'e1',
          exam_name: 'Term 1',
          section_id: 'b',
          section_name: 'B',
          subject_id: 'm1',
          subject_name: 'Mathematics',
          teacher_name: 'Rahima Begum',
          state: 'DRAFT',
        },
      ],
    },
  },
};

export const SubjectLevel: Story = {
  args: {
    cls: {
      ...base,
      class_name: 'Class 9',
      subject_id: 'm1',
      subject_name: 'Mathematics',
      teachers: teachers.slice(0, 1),
    },
  },
};
