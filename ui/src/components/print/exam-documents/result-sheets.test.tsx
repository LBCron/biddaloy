import { render as rtlRender, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN } from '../../../i18n/region-config';
import { RegionConfigProvider } from '../../../i18n/region-config-provider';
import type { IssuerSnapshot } from '../issuer-header';

import {
  TabulationSheet,
  YearlyTranscript,
  type TabulationRow,
  type TabulationSubject,
  type TranscriptExam,
} from './result-sheets';

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_key: null,
};

const render = (ui: React.ReactElement, region = REGION_BD_EN) =>
  rtlRender(<RegionConfigProvider value={region}>{ui}</RegionConfigProvider>);

const subjects: TabulationSubject[] = [
  { id: 'bn', name: 'Bangla', fullMarks: 100 },
  { id: 'en', name: 'English', fullMarks: 100 },
];
const rows: TabulationRow[] = [
  {
    roll: 1,
    name: 'Ayesha',
    cells: {
      bn: { obtained: 85, grade: 'A+', isFail: false },
      en: { obtained: 80, grade: 'A+', isFail: false },
    },
    total: 165,
    gpa: 5,
    grade: 'A+',
    merit: 1,
    isFail: false,
  },
  {
    roll: 2,
    name: 'Babul',
    cells: {
      bn: { obtained: 20, grade: 'F', isFail: true },
      en: { obtained: 70, grade: 'A', isFail: false },
    },
    total: 90,
    gpa: 0,
    grade: 'F',
    merit: null,
    isFail: true,
  },
  {
    roll: 3,
    name: 'Chitra',
    cells: { bn: { obtained: 60, grade: 'A-', isFail: false } },
    total: 60,
    gpa: 3.5,
    grade: 'A-',
    merit: 2,
    isFail: false,
  },
];
const tLabels = {
  title: 'Tabulation sheet',
  roll: 'Roll',
  name: 'Name',
  fullMarks: 'Full marks',
  obtained: 'Obtained',
  grade: 'Grade',
  total: 'Total',
  gpa: 'GPA',
  merit: 'Merit',
  summary: 'This section: 3 sat · 2 passed · 1 failed',
  classTeacher: 'Class teacher',
  examController: 'Exam controller',
  headTeacher: 'Head teacher',
};
const tabProps = {
  issuer: ISSUER,
  examName: 'Half Yearly',
  className: 'Class 6',
  section: 'A',
  subjects,
  rows,
  legend: 'A+ 80-100 · F 0-32',
  printedOn: 'Printed 8 Oct',
  labels: tLabels,
};

describe('TabulationSheet', () => {
  it('draws a header pair per subject, a row per student, landscape, 3 signatures', async () => {
    const { container } = render(<TabulationSheet {...tabProps} />);
    expect(container.querySelectorAll('th[colspan="2"]')).toHaveLength(2);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(container.querySelector('[data-slot="a4-document"]')!.className).toContain('297mm');
    expect(container.querySelectorAll('[data-slot="a4-signature"]')).toHaveLength(3);
    expect(screen.getByText('A+ 80-100 · F 0-32')).toBeTruthy();
    expect(screen.getByText(tLabels.summary)).toBeTruthy();
    expect(container.querySelector('style')).toBeNull();
    await expect(container).toHaveNoViolations();
  });

  it('boxes a failed grade, shades the failed row and shows merit as a dash', () => {
    const { container } = render(<TabulationSheet {...tabProps} />);
    const trs = container.querySelectorAll('tbody tr');
    const boxed = trs[1]!.querySelectorAll('span.border');
    expect([...boxed].map((b) => b.textContent)).toEqual(['F', 'F']);
    expect(trs[1]!.className).toContain('bg-muted');
    expect(trs[0]!.className).not.toContain('bg-muted');
    const cells = trs[1]!.querySelectorAll('td');
    expect(cells[cells.length - 1]!.textContent).toBe('—');
    expect(trs[0]!.querySelectorAll('span.border')).toHaveLength(0);
  });

  it('prints a dash for a subject the student did not take and GPA with 2 decimals', () => {
    const { container } = render(<TabulationSheet {...tabProps} />);
    const cells = container.querySelectorAll('tbody tr')[2]!.querySelectorAll('td');
    // The name is the row header (th), so the data cells start at the roll.
    expect(container.querySelectorAll('tbody th[scope="row"]')).toHaveLength(3);
    expect(cells[3]!.textContent).toBe('—');
    expect(cells[4]!.textContent).toBe('—');
    expect(cells[6]!.textContent).toBe('3.50');
  });

  it('prints Bangla digits under bn', () => {
    render(<TabulationSheet {...tabProps} />, REGION_BD_BN);
    expect(screen.getAllByText(/১০০/).length).toBeGreaterThan(0);
    expect(screen.getByText('৫.০০')).toBeTruthy();
  });
});

const exam = (name: string, fail = false): TranscriptExam => ({
  name,
  subjects: [
    {
      name: 'Bangla',
      obtained: fail ? 20 : 85,
      grade: fail ? 'F' : 'A+',
      gpa: fail ? 0 : 5,
      isFail: fail,
    },
    { name: 'English', obtained: 70, grade: 'A', gpa: 4, isFail: false },
  ],
  total: 155,
  gpa: 4.5,
  grade: fail ? 'F' : 'A',
  position: fail ? null : 3,
  isFail: fail,
});
const yLabels = {
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
};
const yProps = {
  issuer: ISSUER,
  student: { name: 'Ayesha', roll: 7, className: 'Class 6', section: 'A' },
  yearName: '2026',
  printedOn: 'Printed 8 Oct',
  labels: yLabels,
};

describe('YearlyTranscript', () => {
  it('renders a subject table per exam plus a 2-row summary, portrait, 2 signatures', async () => {
    const { container } = render(
      <YearlyTranscript {...yProps} exams={[exam('Half Yearly'), exam('Annual', true)]} />,
    );
    const tables = container.querySelectorAll('table');
    expect(tables).toHaveLength(3);
    expect(tables[2]!.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(tables[0]!.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(tables[1]!.querySelectorAll('span.border')).toHaveLength(1);
    expect(container.querySelector('[data-slot="a4-document"]')!.className).toContain('210mm');
    expect(container.querySelectorAll('[data-slot="a4-signature"]')).toHaveLength(2);
    expect(tables[2]!.querySelectorAll('tbody tr')[1]!.textContent).toContain('—');
    // The failed exam's overall grade is boxed in the summary too.
    const summary = tables[2]!.querySelectorAll('tbody tr');
    expect(summary[1]!.querySelector('span.border')?.textContent).toBe('F');
    expect(summary[0]!.querySelector('span.border')).toBeNull();
    await expect(container).toHaveNoViolations();
  });

  it('prints Bangla digits under bn', () => {
    render(<YearlyTranscript {...yProps} exams={[exam('Half Yearly')]} />, REGION_BD_BN);
    expect(screen.getAllByText('৪.৫০').length).toBeGreaterThan(0);
  });
});

describe('final variants', () => {
  it('TabulationSheet variant=final adds an exam total column each, Absent for null', () => {
    const { container } = render(
      <TabulationSheet
        {...tabProps}
        variant="final"
        examColumns={[
          { id: 'e1', label: 'Half Yearly' },
          { id: 'e2', label: 'Annual' },
        ]}
        rows={rows.slice(0, 1).map((r) => ({ ...r, examTotals: { e1: 160, e2: null } }))}
        labels={{ ...tLabels, absent: 'Absent' }}
      />,
    );
    const heads = [...container.querySelectorAll('thead tr:first-child th')].map(
      (t) => t.textContent,
    );
    expect(heads.slice(-6)).toEqual(['Half Yearly', 'Annual', 'Total', 'GPA', 'Grade', 'Merit']);
    const cells = [...container.querySelectorAll('tbody tr td')].map((t) => t.textContent);
    expect(cells.slice(5, 7)).toEqual(['160', 'Absent']);
  });

  it('final variant and final transcript need their labels at compile time', () => {
    const noop = () => (
      <>
        {/* @ts-expect-error the final variant needs labels.absent */}
        <TabulationSheet {...tabProps} variant="final" examColumns={[]} />
      </>
    );
    expect(typeof noop).toBe('function');
  });

  it('TabulationSheet default variant is unchanged (no exam columns)', () => {
    const { container } = render(
      <TabulationSheet {...tabProps} examColumns={[{ id: 'e1', label: 'X' }]} />,
    );
    expect(screen.queryByText('X')).toBeNull();
    expect(container.querySelectorAll('thead tr:first-child th')).toHaveLength(8);
  });

  it('YearlyTranscript adds share column and a final row only when asked', () => {
    const { container } = render(
      <YearlyTranscript
        {...yProps}
        labels={{ ...yLabels, final: 'Final', share: 'Share' }}
        exams={[
          { ...exam('Half Yearly'), shareLabel: '40%' },
          { ...exam('Annual'), shareLabel: '60%' },
        ]}
        final={{ total: 310, gpa: 4.5, grade: 'A', position: 2 }}
      />,
    );
    const summary = container.querySelectorAll('table')[2]!;
    expect([...summary.querySelectorAll('thead th')].map((t) => t.textContent)).toEqual([
      'Exam',
      'Share',
      'Total',
      'GPA',
      'Grade',
      'Position',
    ]);
    const last = [...summary.querySelectorAll('tbody tr')].at(-1)!;
    expect(last.textContent).toBe('Final3104.50A2');
    expect(container.textContent).not.toMatch(/composition|weight|override|best-of|snapshot/i);
  });
});
