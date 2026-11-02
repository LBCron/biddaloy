import type { Meta, StoryObj } from '@storybook/react-vite';

import type { IssuerSnapshot } from '../issuer-header';

import {
  TabulationSheet,
  YearlyTranscript,
  type TabulationRow,
  type TabulationSubject,
  type TranscriptExam,
} from './result-sheets';

const meta: Meta = { title: 'Print/ExamDocuments/ResultSheets', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: 'অনন্ত উচ্চ বিদ্যালয়',
  address: '123 Green Road, Dhaka-1205',
  phone: '01700000000',
  email: null,
  registration_id: '123456',
  logo_key: null,
};

const subjects: TabulationSubject[] = [
  'Bangla',
  'English',
  'Maths',
  'Science',
  'Social',
  'Religion',
  'ICT',
].map((name, i) => ({ id: `s${i}`, name, fullMarks: 100 }));

const rows: TabulationRow[] = Array.from({ length: 44 }, (_, i) => {
  const isFail = i % 11 === 10;
  const cells: TabulationRow['cells'] = {};
  subjects.forEach((s, j) => {
    if (i % 17 === 16 && j === 6) return; // did not take ICT
    const failed = isFail && j === 2;
    cells[s.id] = {
      obtained: failed ? 21 : 55 + ((i * 7 + j * 3) % 40),
      grade: failed ? 'F' : 'A',
      isFail: failed,
    };
  });
  return {
    roll: i + 1,
    name: `Student number ${i + 1}`,
    cells,
    total: 480 - i * 3,
    gpa: isFail ? 0 : 4.5,
    grade: isFail ? 'F' : 'A',
    merit: isFail ? null : i + 1,
    isFail,
  };
});

export const Section44x7: Story = {
  render: () => (
    <TabulationSheet
      issuer={ISSUER}
      examName="Half Yearly 2026"
      className="Class 6"
      section="A"
      subjects={subjects}
      rows={rows}
      legend="A+ 80-100 (5.00) · A 70-79 (4.00) · A- 60-69 (3.50) · F 0-32 (0.00)"
      printedOn="Printed: 8 Oct 2026"
      labels={{
        title: 'Tabulation sheet',
        roll: 'Roll',
        name: 'Name',
        fullMarks: 'Full marks',
        obtained: 'Obt.',
        grade: 'Gr.',
        total: 'Total',
        gpa: 'GPA',
        merit: 'Merit',
        summary: 'This section: 44 sat · 40 passed · 4 failed',
        classTeacher: 'Class teacher',
        examController: 'Exam controller',
        headTeacher: 'Head teacher',
      }}
    />
  ),
};

const exam = (name: string, fail = false): TranscriptExam => ({
  name,
  subjects: ['Bangla', 'English', 'Maths', 'Science'].map((s, i) => ({
    name: s,
    obtained: fail && i === 2 ? 22 : 70 + i * 4,
    grade: fail && i === 2 ? 'F' : 'A',
    gpa: fail && i === 2 ? 0 : 4,
    isFail: fail && i === 2,
  })),
  total: 300,
  gpa: fail ? 0 : 4,
  grade: fail ? 'F' : 'A',
  position: fail ? null : 5,
});

export const Transcript3Exams: Story = {
  render: () => (
    <YearlyTranscript
      issuer={ISSUER}
      student={{ name: 'Ayesha Rahman', roll: 7, className: 'Class 6', section: 'A' }}
      yearName="2026"
      exams={[exam('First Term'), exam('Half Yearly', true), exam('Annual')]}
      printedOn="Printed: 8 Oct 2026"
      labels={{
        title: 'Yearly transcript',
        roll: 'Roll',
        subject: 'Subject',
        obtained: 'Obtained',
        grade: 'Grade',
        gpa: 'GPA',
        total: 'Total',
        exam: 'Exam',
        position: 'Position',
        classTeacher: 'Class teacher',
        headTeacher: 'Head teacher',
      }}
    />
  ),
};

export const FinalTabulation: Story = {
  render: () => (
    <TabulationSheet
      issuer={ISSUER}
      examName="Final result 2026"
      className="Class 6"
      section="A"
      variant="final"
      examColumns={[
        { id: 'e1', label: 'Half Yearly' },
        { id: 'e2', label: 'Annual' },
      ]}
      subjects={subjects}
      rows={rows.map((r, i) => ({
        ...r,
        examTotals: { e1: 300 - i, e2: i % 9 === 8 ? null : 310 - i },
      }))}
      legend="A+ 80-100 (5.00) · A 70-79 (4.00) · F 0-32 (0.00)"
      printedOn="Printed: 8 Oct 2026"
      labels={{
        title: 'Final tabulation sheet',
        roll: 'Roll',
        name: 'Name',
        fullMarks: 'Full marks',
        obtained: 'Obt.',
        grade: 'Gr.',
        total: 'Final',
        gpa: 'GPA',
        merit: 'Merit',
        summary: 'This section: 44 sat · 40 passed · 4 failed',
        classTeacher: 'Class teacher',
        examController: 'Exam controller',
        headTeacher: 'Head teacher',
        absent: 'Absent',
      }}
    />
  ),
};

export const FinalTranscript: Story = {
  render: () => (
    <YearlyTranscript
      issuer={ISSUER}
      student={{ name: 'Ayesha Rahman', roll: 7, className: 'Class 6', section: 'A' }}
      yearName="2026"
      exams={[
        { ...exam('Half Yearly'), shareLabel: '40%' },
        { ...exam('Annual'), shareLabel: '60%' },
      ]}
      final={{ total: 300, gpa: 4, grade: 'A', position: 4 }}
      printedOn="Printed: 8 Oct 2026"
      labels={{
        title: 'Final transcript',
        roll: 'Roll',
        subject: 'Subject',
        obtained: 'Obtained',
        grade: 'Grade',
        gpa: 'GPA',
        total: 'Total',
        exam: 'Exam',
        position: 'Position',
        classTeacher: 'Class teacher',
        headTeacher: 'Head teacher',
        final: 'Final',
        share: 'Share',
      }}
    />
  ),
};
