/**
 * [19.8.1] The printable, bilingual report card — cloned from
 * `invoice-receipt.tsx`'s shape (D6): pure, hook-free (takes translated
 * `labels` as props, same reasoning as that file's own header comment —
 * usable from Storybook or a chrome-free route without an i18n provider),
 * fixed A4 width, `print:` Tailwind variants rather than a separate CSS
 * file (`invoice-receipt.tsx` has none either).
 *
 * `ResultSubject` never stores a per-component breakdown (only the
 * subject's `obtained` total) — `components` here comes from
 * `ResultsService.getStudentResult` joining `Mark`/`ExamComponent`
 * directly (see that method's own doc comment). A component with
 * `obtained: null` renders "Absent" rather than "0" — same ABSENT-vs-zero
 * distinction `result-rules.ts` enforces server-side.
 */
import * as React from 'react';

import { useRegionConfig } from '../../i18n/region-config-provider';
import { formatNumber } from '../../utils/number';

import { IssuerHeader, type IssuerSnapshot } from './issuer-header';

export interface ReportCardComponent {
  name: string;
  full_marks: number;
  obtained: number | null;
}

export interface ReportCardSubject {
  subject_name: string;
  obtained: number;
  grade: string;
  gpa: number;
  is_fail: boolean;
  is_fourth_subject: boolean;
  components: ReportCardComponent[];
  /** Final card only: obtained per counted exam, keyed by `exam_columns[].id`; null = absent. */
  exam_cells?: { exam_id: string; value: number | null }[];
}

export interface ReportCardLegendRow {
  grade: string;
  gpa: number | null;
  comment: string | null;
}

export interface ReportCardProgramRow {
  program_name: string;
  achieved_count: number;
  milestone_total: number;
  latest: {
    milestone_name: string;
    achieved_on: string;
    score: number | null;
    grade: string | null;
  } | null;
}

export interface ReportCardData {
  exam_name: string;
  student: { full_name: string; roll_number: number };
  result: {
    total_marks: number;
    gpa: number;
    grade: string;
    position: number | null;
    is_fail: boolean;
  };
  subjects: ReportCardSubject[];
  legend: ReportCardLegendRow[];
  programs?: ReportCardProgramRow[];
  /** [70.W4] All optional: absent = the card renders exactly as before. */
  attendance?: { working_days: number | null; present_days: number | null };
  remark?: string | null;
  conduct?: { label: string; grade: string | null }[];
  /** Final card: one subject-table column per counted exam, then the final columns. */
  final?: { label: string; section_position: number | null };
  exam_columns?: { id: string; label: string; share_label: string }[];
}

/** Needed only when attendance / remark / conduct / final is passed. */
export interface ReportCardBlockLabels {
  workingDays: string;
  daysPresent: string;
  attendance: string;
  remark: string;
  conduct: string;
  final: string;
  sectionPosition: string;
  classTeacher: string;
  guardian: string;
  headTeacher: string;
}

export interface ReportCardProps {
  data: ReportCardData;
  issuer: IssuerSnapshot;
  logoUrl?: string | null;
  activeLanguage?: string;
  blockLabels?: ReportCardBlockLabels;
  labels: {
    examLabel: string;
    rollLabel: string;
    subject: string;
    obtained: string;
    grade: string;
    gpa: string;
    totalMarks: string;
    totalGpa: string;
    overallGrade: string;
    position: string;
    positionValue: string; // "{{position}}"
    fail: string;
    fourthSubject: string;
    absent: string;
    legendTitle: string;
    programs: string;
    progress: string;
    latestMilestone: string;
    scoreGrade: string;
  };
}

function subjectFullMarks(components: ReportCardComponent[]): number {
  return components.reduce((sum, c) => sum + c.full_marks, 0);
}

export function ReportCard({
  data,
  issuer,
  logoUrl,
  activeLanguage,
  labels,
  blockLabels,
}: ReportCardProps) {
  const config = useRegionConfig();
  const num = (v: number | null) => formatNumber(v, config);
  const gpa = (v: number) => formatNumber(v, config, { decimals: 2 });
  // A milestone score keeps its own decimals (92.5 stays 92.5), in tenant numerals.
  const score = (v: number) =>
    formatNumber(v, config, { decimals: String(v).split('.')[1]?.length ?? 0 });
  const columns = data.final ? (data.exam_columns ?? []) : [];
  const cellText = (subject: ReportCardSubject, examId: string) => {
    const cell = subject.exam_cells?.find((c) => c.exam_id === examId);
    return cell === undefined ? '—' : cell.value === null ? labels.absent : num(cell.value);
  };
  const att = data.attendance;
  const pct =
    att && att.working_days && att.present_days !== null
      ? Math.min(100, Math.round((att.present_days / att.working_days) * 100))
      : null;
  return (
    <div
      data-slot="report-card"
      className="mx-auto flex w-full max-w-[210mm] flex-col gap-4 text-sm print:gap-4"
    >
      <IssuerHeader
        issuer={issuer}
        logoUrl={logoUrl ?? null}
        {...(activeLanguage !== undefined ? { activeLanguage } : {})}
      />

      <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
        <span className="font-semibold">{data.exam_name}</span>
        {data.result.is_fail && (
          <span className="rounded-full border border-destructive px-2 py-0.5 text-xs text-destructive">
            {labels.fail}
          </span>
        )}
      </div>

      <div className="flex justify-between gap-2">
        <span className="font-medium">{data.student.full_name}</span>
        <span className="text-text-secondary">
          {labels.rollLabel}: {num(data.student.roll_number)}
        </span>
      </div>

      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{labels.subject}</caption>
        <thead>
          <tr className="border-b text-start text-text-secondary">
            <th className="py-1">{labels.subject}</th>
            {columns.map((col) => (
              <th key={`ex-${col.id}`} className="py-1 text-end">
                {col.label}
                <span className="block text-xs font-normal">{col.share_label}</span>
              </th>
            ))}
            <th className="py-1 text-end">
              {data.final && blockLabels ? blockLabels.final : labels.obtained}
            </th>
            <th className="py-1">{labels.grade}</th>
            <th className="py-1">{labels.gpa}</th>
          </tr>
        </thead>
        <tbody>
          {data.subjects.map((subject) => (
            <React.Fragment key={subject.subject_name}>
              <tr className={subject.is_fail ? 'text-destructive' : undefined}>
                <td className="py-1 font-medium">
                  {subject.subject_name}
                  {subject.is_fourth_subject && (
                    <span className="ms-1 text-xs text-text-secondary">
                      ({labels.fourthSubject})
                    </span>
                  )}
                </td>
                {columns.map((col) => (
                  <td key={`ex-${col.id}`} className="py-1 text-end">
                    {cellText(subject, col.id)}
                  </td>
                ))}
                <td className="py-1 text-end">
                  {data.final
                    ? num(subject.obtained)
                    : `${num(subject.obtained)} / ${num(subjectFullMarks(subject.components))}`}
                </td>
                <td className="py-1">{subject.grade}</td>
                <td className="py-1">{gpa(subject.gpa)}</td>
              </tr>
              {subject.components.map((component) => (
                <tr key={component.name} className="text-xs text-text-secondary">
                  <td className="py-0.5 ps-4">{component.name}</td>
                  <td className="py-0.5 text-end">
                    {component.obtained === null ? labels.absent : num(component.obtained)} /{' '}
                    {num(component.full_marks)}
                  </td>
                  {columns.map((col) => (
                    <td key={`ex-${col.id}`} />
                  ))}
                  <td />
                  <td />
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-1 border-t border-border-subtle pt-2 font-semibold">
        <div className="flex justify-between gap-2">
          <span>{labels.totalMarks}</span>
          <span>{num(data.result.total_marks)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{labels.totalGpa}</span>
          <span>{gpa(data.result.gpa)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{labels.overallGrade}</span>
          <span>{data.result.grade}</span>
        </div>
        {data.result.position !== null && (
          <div className="flex justify-between gap-2">
            <span>{labels.position}</span>
            <span>{num(data.result.position)}</span>
          </div>
        )}
        {data.final?.section_position != null && blockLabels && (
          <div className="flex justify-between gap-2">
            <span>{blockLabels.sectionPosition}</span>
            <span>{num(data.final.section_position)}</span>
          </div>
        )}
      </div>

      {data.programs && data.programs.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{labels.programs}</caption>
          <thead>
            <tr className="border-b text-start text-text-secondary">
              <th className="py-1">{labels.programs}</th>
              <th className="py-1">{labels.progress}</th>
              <th className="py-1">{labels.latestMilestone}</th>
              <th className="py-1">{labels.scoreGrade}</th>
            </tr>
          </thead>
          <tbody>
            {data.programs.map((program, index) => (
              <tr key={`${program.program_name}-${index}`}>
                <td className="py-1 font-medium">{program.program_name}</td>
                <td className="py-1">
                  {num(program.achieved_count)} / {num(program.milestone_total)}
                </td>
                <td className="py-1">
                  {program.latest
                    ? `${program.latest.milestone_name} (${program.latest.achieved_on})`
                    : '—'}
                </td>
                <td className="py-1">
                  {program.latest
                    ? [
                        program.latest.score === null ? null : score(program.latest.score),
                        program.latest.grade,
                      ]
                        .filter((v) => v !== null && v !== undefined)
                        .join(' / ')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {blockLabels && att && (
        <div data-slot="report-card-attendance" className="text-sm">
          {blockLabels.attendance}: {blockLabels.workingDays}{' '}
          {att.working_days === null ? '—' : num(att.working_days)}
          {' · '}
          {blockLabels.daysPresent} {att.present_days === null ? '—' : num(att.present_days)}
          {pct !== null && ` (${formatNumber(pct, config, { percent: true })})`}
        </div>
      )}

      {blockLabels && data.remark !== undefined && (
        <div
          data-slot="report-card-remark"
          className="flex min-h-12 flex-col gap-1 rounded-md border border-border-subtle p-2 print:break-inside-avoid"
        >
          <span className="text-xs font-medium text-text-secondary">{blockLabels.remark}</span>
          <span className="break-words">{data.remark || '—'}</span>
        </div>
      )}

      {blockLabels && data.conduct && data.conduct.length > 0 && (
        <div
          data-slot="report-card-conduct"
          className="flex flex-col gap-1 print:break-inside-avoid"
        >
          <span className="text-xs font-medium text-text-secondary">{blockLabels.conduct}</span>
          <div className="grid grid-cols-4 gap-x-4 gap-y-1">
            {data.conduct.map((item, i) => (
              <span key={`${item.label}-${i}`} className="flex justify-between gap-2">
                <span>{item.label}</span>
                <span className="font-semibold">{item.grade ?? '—'}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-border-subtle pt-2 text-xs text-text-secondary">
        <div className="font-medium">{labels.legendTitle}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {data.legend.map((band) => (
            <span key={band.grade}>
              {band.grade}
              {band.gpa !== null ? ` (${gpa(band.gpa)})` : ''}
              {band.comment ? ` — ${band.comment}` : ''}
            </span>
          ))}
        </div>
      </div>

      {blockLabels && (att || data.remark !== undefined || data.conduct?.length || data.final) && (
        <div className="mt-8 grid grid-cols-3 gap-8 text-center text-xs print:break-inside-avoid">
          {[blockLabels.classTeacher, blockLabels.guardian, blockLabels.headTeacher].map((who) => (
            <span key={who} className="border-t border-foreground pt-1">
              {who}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
