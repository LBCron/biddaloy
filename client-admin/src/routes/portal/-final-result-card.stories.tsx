import type { Meta, StoryObj } from '@storybook/react-vite';

import { FinalResultCardView } from './-final-result-card';

const meta: Meta<typeof FinalResultCardView> = {
  title: 'Portal/FinalResultCard',
  component: FinalResultCardView,
  decorators: [
    (Story) => (
      <div className="w-[390px]">
        <Story />
      </div>
    ),
  ],
  args: {
    childName: 'Fatima',
    className: 'Class 8',
    card: {
      final_result_id: 'fr-1',
      academic_year_name: '2026',
      student: { full_name: 'Fatima', roll_number: 14 },
      final: { total_marks: 880, gpa: 4.67, grade: 'A', position: 2, is_fail: false },
      exams: [{ exam_id: 'e1', exam_name: 'Half-yearly', total_marks: 400, gpa: 4.5 }],
      exam_shares: [{ exam_id: 'e1', share_percent: 100 }],
      subjects: [],
      legend: [],
      attendance: { working_days: 200, present_days: 190 },
      remark: 'Keep it up',
      conduct: [{ key: 'discipline', name_bn: 'শৃঙ্খলা', name_en: 'Discipline', grade: 'A' }],
      issuer: {},
      logo_url: null,
    },
  },
};
export default meta;
type Story = StoryObj<typeof FinalResultCardView>;

export const Default: Story = { globals: { locale: 'bn' } };
export const NoRemarkOrAttendance: Story = {
  args: {
    card: {
      ...meta.args!.card!,
      remark: null,
      attendance: { working_days: null, present_days: null },
      conduct: [],
    },
  },
};
