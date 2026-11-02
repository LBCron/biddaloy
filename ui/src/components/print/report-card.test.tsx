import { render as rtlRender, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN } from '../../i18n/region-config';
import { RegionConfigProvider } from '../../i18n/region-config-provider';

import type { IssuerSnapshot } from './issuer-header';
import { ReportCard, type ReportCardData } from './report-card';

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
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
  fourthSubject: '4th',
  absent: 'Absent',
  legendTitle: 'Grade legend',
  programs: 'Programs',
  progress: 'Progress',
  latestMilestone: 'Latest milestone',
  scoreGrade: 'Score/Grade',
};

const BASE: ReportCardData = {
  exam_name: 'Half Yearly 2026',
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
      components: [{ name: 'Written', full_marks: 100, obtained: 85 }],
    },
  ],
  legend: [
    { grade: 'A+', gpa: 5, comment: 'Excellent' },
    { grade: 'F', gpa: 0, comment: 'Fail' },
  ],
};

// The default region is Bangla digits; pin Latin unless a test overrides it.
const render = (ui: React.ReactElement) =>
  rtlRender(<RegionConfigProvider value={REGION_BD_EN}>{ui}</RegionConfigProvider>);

const MATH_SUBJECT = BASE.subjects[0]!;

describe('ReportCard', () => {
  it('renders a pass result with student identity and subject total', () => {
    render(<ReportCard data={BASE} issuer={ISSUER} labels={LABELS} />);
    expect(screen.getByText('Rahim Ahmed')).toBeTruthy();
    expect(screen.getByText('Mathematics')).toBeTruthy();
    expect(screen.getAllByText('85 / 100').length).toBe(2);
    expect(screen.queryByText('Fail')).toBeNull();
  });

  it('renders a fail result with the fail badge and subject in destructive styling', () => {
    render(
      <ReportCard
        data={{
          ...BASE,
          result: { ...BASE.result, grade: 'F', gpa: 0, is_fail: true },
          subjects: [{ ...MATH_SUBJECT, grade: 'F', gpa: 0, is_fail: true }],
        }}
        issuer={ISSUER}
        labels={LABELS}
      />,
    );
    expect(screen.getByText('Fail')).toBeTruthy();
  });

  it('renders an absent subject component as "Absent", not a zero', () => {
    render(
      <ReportCard
        data={{
          ...BASE,
          subjects: [
            {
              ...MATH_SUBJECT,
              components: [{ name: 'Written', full_marks: 100, obtained: null }],
            },
          ],
        }}
        issuer={ISSUER}
        labels={LABELS}
      />,
    );
    expect(screen.getByText(/Absent/)).toBeTruthy();
  });

  it('marks a fourth subject with the 4th-subject badge', () => {
    render(
      <ReportCard
        data={{
          ...BASE,
          subjects: [{ ...MATH_SUBJECT, is_fourth_subject: true }],
        }}
        issuer={ISSUER}
        labels={LABELS}
      />,
    );
    expect(screen.getByText('(4th)')).toBeTruthy();
  });

  it('renders the grading scale legend', () => {
    render(<ReportCard data={BASE} issuer={ISSUER} labels={LABELS} />);
    expect(screen.getByText(/Excellent/)).toBeTruthy();
  });

  it('hides the programs block when programs is empty or undefined', () => {
    render(<ReportCard data={BASE} issuer={ISSUER} labels={LABELS} />);
    expect(screen.queryByText('Programs')).toBeNull();

    render(<ReportCard data={{ ...BASE, programs: [] }} issuer={ISSUER} labels={LABELS} />);
    expect(screen.queryByText('Programs')).toBeNull();
  });

  it('renders a program row with name, progress, latest milestone and score', () => {
    render(
      <ReportCard
        data={{
          ...BASE,
          programs: [
            {
              program_name: 'Hifz Circle',
              achieved_count: 7,
              milestone_total: 30,
              latest: {
                milestone_name: 'Juz 5',
                achieved_on: '2026-03-01',
                score: 92.5,
                grade: 'A',
              },
            },
          ],
        }}
        issuer={ISSUER}
        labels={LABELS}
      />,
    );
    expect(screen.getByText('Hifz Circle')).toBeTruthy();
    expect(screen.getByText('7 / 30')).toBeTruthy();
    expect(screen.getByText(/Juz 5/)).toBeTruthy();
    expect(screen.getByText(/92\.5/)).toBeTruthy();
  });

  it('renders a program score in tenant numerals, keeping its decimals', () => {
    rtlRender(
      <RegionConfigProvider value={REGION_BD_BN}>
        <ReportCard
          data={{
            ...BASE,
            programs: [
              {
                program_name: 'Hifz Circle',
                achieved_count: 7,
                milestone_total: 30,
                latest: {
                  milestone_name: 'Juz 5',
                  achieved_on: '2026-03-01',
                  score: 92.5,
                  grade: 'A',
                },
              },
            ],
          }}
          issuer={ISSUER}
          labels={LABELS}
        />
      </RegionConfigProvider>,
    );
    expect(screen.getByText('৯২.৫ / A')).toBeTruthy();
  });

  it('renders GPA with two decimals in tenant numerals', () => {
    const { unmount } = rtlRender(
      <RegionConfigProvider value={REGION_BD_BN}>
        <ReportCard data={BASE} issuer={ISSUER} labels={LABELS} />
      </RegionConfigProvider>,
    );
    expect(screen.getByText('৪.৫০')).toBeTruthy();
    expect(screen.getAllByText('৮৫ / ১০০').length).toBe(2);
    unmount();
    render(<ReportCard data={BASE} issuer={ISSUER} labels={LABELS} />);
    expect(screen.getByText('4.50')).toBeTruthy();
  });

  describe('attendance, remark, conduct and final blocks', () => {
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
    const NEVER_SAY =
      /composition|weight|process|override|best-of|snapshot|annual result|\bnull\b|missing|summary|\bnote\b|evaluation/i;
    const WITH_BLOCKS: ReportCardData = {
      ...BASE,
      attendance: { working_days: 200, present_days: 180 },
      remark: 'Keep it up',
      conduct: [
        { label: 'Discipline', grade: 'A' },
        { label: 'Sports', grade: null },
      ],
    };

    it('renders nothing extra without the new props (no signatures either)', () => {
      const { container } = render(
        <ReportCard data={BASE} issuer={ISSUER} labels={LABELS} blockLabels={BLOCK_LABELS} />,
      );
      expect(container.querySelector('[data-slot="report-card-attendance"]')).toBeNull();
      expect(container.querySelector('[data-slot="report-card-remark"]')).toBeNull();
      expect(container.querySelector('[data-slot="report-card-conduct"]')).toBeNull();
      expect(screen.queryByText('Guardian')).toBeNull();
    });

    it('renders attendance with percent, remark, conduct and three signatures', () => {
      const { container } = render(
        <ReportCard
          data={WITH_BLOCKS}
          issuer={ISSUER}
          labels={LABELS}
          blockLabels={BLOCK_LABELS}
        />,
      );
      expect(container.querySelector('[data-slot="report-card-attendance"]')!.textContent).toBe(
        'Attendance: Working days 200 · Days present 180 (90%)',
      );
      expect(screen.getByText('Keep it up')).toBeTruthy();
      expect(screen.getByText('Discipline')).toBeTruthy();
      // An ungraded conduct item prints a dash, not "null".
      expect(container.querySelector('[data-slot="report-card-conduct"]')!.textContent).toContain(
        'Sports—',
      );
      for (const t of ['Class teacher', 'Guardian', 'Head teacher']) {
        expect(screen.getAllByText(t)).toHaveLength(1);
      }
      expect(container.textContent).not.toMatch(NEVER_SAY);
    });

    it('prints a dash for missing attendance numbers and an empty remark', () => {
      const { container } = render(
        <ReportCard
          data={{ ...BASE, attendance: { working_days: null, present_days: null }, remark: null }}
          issuer={ISSUER}
          labels={LABELS}
          blockLabels={BLOCK_LABELS}
        />,
      );
      expect(container.querySelector('[data-slot="report-card-attendance"]')!.textContent).toBe(
        'Attendance: Working days — · Days present —',
      );
      expect(container.querySelector('[data-slot="report-card-remark"]')!.textContent).toContain(
        '—',
      );
    });

    it('final card: one column per counted exam, Absent cell, final column, section position', () => {
      const { container } = render(
        <ReportCard
          data={{
            ...WITH_BLOCKS,
            exam_name: 'Final result 2026',
            subjects: [{ ...MATH_SUBJECT, components: [], exam_cells: [70, null] }],
            final: { label: 'Final result', section_position: 3 },
            exam_columns: [
              { label: 'Half Yearly', share_label: '40%' },
              { label: 'Annual', share_label: '60%' },
            ],
          }}
          issuer={ISSUER}
          labels={LABELS}
          blockLabels={BLOCK_LABELS}
        />,
      );
      expect([...container.querySelectorAll('thead th')].map((t) => t.textContent)).toEqual([
        'Subject',
        'Half Yearly40%',
        'Annual60%',
        'Final',
        'Grade',
        'GPA',
      ]);
      const row = container.querySelector('tbody tr')!;
      expect([...row.querySelectorAll('td')].map((t) => t.textContent)).toEqual([
        'Mathematics',
        '70',
        'Absent',
        '85',
        'A+',
        '5.00',
      ]);
      expect(screen.getByText('Section position')).toBeTruthy();
      expect(container.textContent).not.toMatch(NEVER_SAY);
    });
  });
});
