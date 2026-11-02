import type { Meta, StoryObj } from '@storybook/react-vite';

import type { IssuerSnapshot } from './issuer-header';
import { ReportCard, type ReportCardData } from './report-card';

const meta: Meta<typeof ReportCard> = {
  title: 'Print/ReportCard',
  component: ReportCard,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ReportCard>;

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: 'অনন্ত উচ্চ বিদ্যালয়',
  address: '123 Green Road, Dhaka-1205',
  phone: '01700000000',
  email: null,
  registration_id: '123456',
  logo_key: null,
};

const LABELS = {
  examLabel: 'Exam',
  rollLabel: 'Roll',
  subject: 'Subject',
  obtained: 'Obtained',
  grade: 'Grade',
  gpa: 'GPA',
  totalMarks: 'Total marks',
  totalGpa: 'Total GPA',
  overallGrade: 'Overall grade',
  position: 'Position',
  positionValue: '{{position}}',
  fail: 'Fail',
  fourthSubject: '4th subject',
  absent: 'Absent',
  legendTitle: 'Grade legend',
  programs: 'Programs',
  progress: 'Progress',
  latestMilestone: 'Latest milestone',
  scoreGrade: 'Score/Grade',
};

const LEGEND = [
  { grade: 'A+', gpa: 5, comment: 'Excellent' },
  { grade: 'A', gpa: 4, comment: 'Very good' },
  { grade: 'B', gpa: 3, comment: 'Good' },
  { grade: 'F', gpa: 0, comment: 'Fail' },
];

const DATA: ReportCardData = {
  exam_name: 'Half Yearly Exam 2026',
  student: { full_name: 'Rahim Ahmed', roll_number: 5 },
  result: { total_marks: 450, gpa: 4.5, grade: 'A', position: 2, is_fail: false },
  subjects: [
    {
      subject_name: 'Mathematics',
      obtained: 85,
      grade: 'A+',
      gpa: 5,
      is_fail: false,
      is_fourth_subject: false,
      components: [
        { name: 'Written', full_marks: 70, obtained: 60 },
        { name: 'MCQ', full_marks: 30, obtained: 25 },
      ],
    },
    {
      subject_name: 'English',
      obtained: 70,
      grade: 'A',
      gpa: 4,
      is_fail: false,
      is_fourth_subject: false,
      components: [{ name: 'Written', full_marks: 100, obtained: 70 }],
    },
  ],
  legend: LEGEND,
};

const MATH_SUBJECT = DATA.subjects[0]!;
const ENGLISH_SUBJECT = DATA.subjects[1]!;

export const Pass: Story = {
  args: { data: DATA, issuer: ISSUER, labels: LABELS, activeLanguage: 'en' },
};

export const Fail: Story = {
  args: {
    data: {
      ...DATA,
      result: { ...DATA.result, grade: 'F', gpa: 1.5, is_fail: true },
      subjects: [{ ...MATH_SUBJECT, grade: 'F', gpa: 0, is_fail: true }, ENGLISH_SUBJECT],
    },
    issuer: ISSUER,
    labels: LABELS,
  },
};

export const AbsentSubject: Story = {
  args: {
    data: {
      ...DATA,
      subjects: [
        {
          ...MATH_SUBJECT,
          obtained: 0,
          grade: 'F',
          gpa: 0,
          is_fail: true,
          components: [
            { name: 'Written', full_marks: 70, obtained: null },
            { name: 'MCQ', full_marks: 30, obtained: null },
          ],
        },
        ENGLISH_SUBJECT,
      ],
    },
    issuer: ISSUER,
    labels: LABELS,
  },
};

export const FourthSubject: Story = {
  args: {
    data: {
      ...DATA,
      subjects: [
        ...DATA.subjects,
        {
          subject_name: 'Higher Mathematics',
          obtained: 90,
          grade: 'A+',
          gpa: 5,
          is_fail: false,
          is_fourth_subject: true,
          components: [{ name: 'Written', full_marks: 100, obtained: 90 }],
        },
      ],
    },
    issuer: ISSUER,
    labels: LABELS,
  },
};

export const Bengali: Story = {
  args: { data: DATA, issuer: ISSUER, labels: LABELS, activeLanguage: 'bn' },
};

// Default `DATA` has no `programs` — confirms the block stays absent when
// the field is undefined, same as an opted-in-programless student.
export const WithPrograms: Story = {
  args: {
    data: {
      ...DATA,
      programs: [
        {
          program_name: 'Hifz Circle',
          achieved_count: 7,
          milestone_total: 30,
          latest: { milestone_name: 'Juz 5', achieved_on: '2026-03-01', score: 92.5, grade: 'A' },
        },
        {
          program_name: 'Scouting',
          achieved_count: 10,
          milestone_total: 10,
          latest: {
            milestone_name: 'Camp Badge',
            achieved_on: '2026-06-01',
            score: null,
            grade: null,
          },
        },
      ],
    },
    issuer: ISSUER,
    labels: LABELS,
  },
};

const BLOCK_LABELS = {
  workingDays: 'Working days',
  daysPresent: 'Days present',
  attendance: 'Attendance',
  remark: "Class teacher's remark",
  conduct: 'Conduct',
  final: 'Final',
  sectionPosition: 'Section position',
  classTeacher: 'Class teacher',
  guardian: 'Guardian',
  headTeacher: 'Head teacher',
};
const BLOCK_LABELS_BN = {
  workingDays: 'কর্মদিবস',
  daysPresent: 'উপস্থিত দিন',
  attendance: 'উপস্থিতি',
  remark: 'শ্রেণিশিক্ষকের মন্তব্য',
  conduct: 'আচরণ ও সহশিক্ষা',
  final: 'চূড়ান্ত',
  sectionPosition: 'সেকশনে স্থান',
  classTeacher: 'শ্রেণিশিক্ষক',
  guardian: 'অভিভাবক',
  headTeacher: 'প্রধান শিক্ষক',
};
const CONDUCT8 = [
  'Discipline',
  'Sports',
  'Punctuality',
  'Cleanliness',
  'Cultural',
  'Scouting',
  'Neatness',
  'Teamwork',
].map((label, i) => ({ label, grade: i === 5 ? null : 'A' }));
const WITH_BLOCKS: ReportCardData = {
  ...DATA,
  attendance: { working_days: 200, present_days: 180 },
  remark: 'Rahim works steadily and helps classmates. Keep it up.',
  conduct: CONDUCT8.slice(0, 4),
};

export const PerExamWithBlocks: Story = {
  args: { data: WITH_BLOCKS, issuer: ISSUER, labels: LABELS, blockLabels: BLOCK_LABELS },
};

export const PerExamWithBlocksBangla: Story = {
  args: { data: WITH_BLOCKS, issuer: ISSUER, labels: LABELS, blockLabels: BLOCK_LABELS_BN },
};

export const LongRemarkAndEightConduct: Story = {
  args: {
    data: {
      ...WITH_BLOCKS,
      remark: 'Rahim works steadily and helps classmates. '.repeat(12).trim(),
      conduct: CONDUCT8,
    },
    issuer: ISSUER,
    labels: LABELS,
    blockLabels: BLOCK_LABELS,
  },
};

export const FinalCard: Story = {
  args: {
    data: {
      ...WITH_BLOCKS,
      exam_name: 'Final result 2026',
      subjects: DATA.subjects.map((s, i) => ({
        ...s,
        components: [],
        exam_cells: i === 0 ? [70, null] : [80, 75],
      })),
      final: { label: 'Final result', section_position: 3 },
      exam_columns: [
        { label: 'Half Yearly', share_label: '40%' },
        { label: 'Annual', share_label: '60%' },
      ],
    },
    issuer: ISSUER,
    labels: LABELS,
    blockLabels: BLOCK_LABELS,
  },
};

export const FinalCardBangla: Story = {
  args: { ...FinalCard.args!, blockLabels: BLOCK_LABELS_BN },
};
