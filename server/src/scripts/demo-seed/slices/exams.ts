import {
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  ExamStatus,
  FinalResultMode,
  MarkGridState,
  MarkStatus,
  SeatOrderMode,
} from '@biddaloy/shared';
import type { DemoSlice } from '../context';
import { Exam } from '../../../modules/exams/entities/exam.entity';
import { ExamComponent } from '../../../modules/exams/entities/exam-component.entity';
import { ExamSchedule } from '../../../modules/exams/entities/exam-schedule.entity';
import { MarkGrid } from '../../../modules/exams/entities/mark-grid.entity';
import { Mark } from '../../../modules/exams/entities/mark.entity';
import { Result } from '../../../modules/exams/entities/result.entity';
import { ResultSubject } from '../../../modules/exams/entities/result-subject.entity';
import { SeatPlan } from '../../../modules/seat-plans/entities/seat-plan.entity';
import { SeatPlanSchedule } from '../../../modules/seat-plans/entities/seat-plan-schedule.entity';
import { SeatAllocation } from '../../../modules/seat-plans/entities/seat-allocation.entity';
import { ResultsService, RULE_VERSION } from '../../../modules/exams/results.service';
import { FinalResultsService } from '../../../modules/final-results/final-results.service';
import { FinalResult } from '../../../modules/final-results/entities/final-result.entity';
import { FinalResultWeight } from '../../../modules/final-results/entities/final-result-weight.entity';
import { FinalResultRow } from '../../../modules/final-results/entities/final-result-row.entity';
import { FinalResultSubject } from '../../../modules/final-results/entities/final-result-subject.entity';
import { SeatPlansService } from '../../../modules/seat-plans/seat-plans.service';
import { sitsSubject } from '../../../modules/exams/exam-cohort';
import {
  combineSubjects,
  computeSubjectTotal,
  gradeSubjectTotal,
  rankByMerit,
  type Band,
  type ComponentInput,
  type SubjectResult,
} from '../../../modules/exams/result-rules';
import { gradeFor, resolveScale } from '../../../modules/grading/scale-lookup';
import { insertChunked } from '../bulk';
import { schoolDays } from '../dates';
import { orgIds, type OrgYear } from './org';
import { studentIds, type DemoStudent } from './students';

/** Three term exams a year, plus a Test exam for classes X and XII (D34). */
const TERM_EXAMS = [
  { name: 'First Term Exam', term: 1 },
  { name: 'Half-Yearly Exam', term: 2 },
  { name: 'Annual Exam', term: 3 },
] as const;
const TEST_EXAM = { name: 'Test Exam', term: 1, grades: [10, 12] } as const;

/** The current year's story, in days from the anchor (D15): published, in progress, next. */
const FIRST_END = -21;
const HALF_END = -3;
const ANNUAL_START = 10;
const TEST_END = -45;
const WINDOW_DAYS = 14;

type State = 'published' | 'progress' | 'next';

interface ClassSubj {
  id: string;
  subject_id: string;
  code: string;
  is_optional: boolean;
  is_graded_only: boolean;
  group_name: string | null;
  choice_group: string | null;
}
interface Comp {
  id: string;
  name: string;
  kind: ExamComponentKind;
  full: number;
  pass: number;
  seq: number;
}
interface Sitter {
  s: DemoStudent;
  sectionId: string;
}

const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, hh: number) =>
  new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+06:00`);
const clamp = (x: number) => Math.min(1, Math.max(0, x));

export const slice: DemoSlice = {
  name: 'exams',
  covers: [
    Exam,
    ExamComponent,
    ExamSchedule,
    MarkGrid,
    Mark,
    Result,
    ResultSubject,
    SeatPlan,
    SeatPlanSchedule,
    SeatAllocation,
    FinalResult,
    FinalResultWeight,
    FinalResultRow,
    FinalResultSubject,
  ],
  run: async (ctx) => {
    const org = orgIds(ctx);
    const { students } = studentIds(ctx);
    const results = ctx.app.get(ResultsService);
    const seatPlans = ctx.app.get(SeatPlansService);
    const finals = ctx.app.get(FinalResultsService);
    const rng = ctx.rng;
    const uuid = () => rng.string.uuid();
    const u = () => rng.number.float();
    const gauss = () => (u() + u() + u() + u() - 2) * Math.sqrt(3); // mean 0, sd 1
    const q = <T>(sql: string, args: unknown[]): Promise<T[]> => ctx.ds.query(sql, args);

    // A hidden ability per student, stable across years (D33); a few struggle. Tuned in the
    // slice spec to ~10% A+ and ~3-5% failing results.
    const ability = new Map<string, number>();
    for (const s of students) ability.set(s.id, 0.72 + 0.1 * gauss() - (u() < 0.09 ? 0.3 : 0));
    const difficulty = new Map<string, number>();
    const difficultyOf = (subjectId: string) => {
      if (!difficulty.has(subjectId)) difficulty.set(subjectId, 0.03 * gauss());
      return difficulty.get(subjectId)!;
    };

    let rows = 0;
    for (const tenant of org.tenants) {
      const mine = students.filter((s) => s.tenantId === tenant.id);
      // Who sat which class in which year (the newest year only counts students still ACTIVE).
      const sitters = new Map<string, Sitter[]>();
      for (const s of mine) {
        for (const stay of s.stays) {
          const current = tenant.years.find((y) => y.id === stay.yearId)!.isCurrent;
          if (current && s.status !== 'ACTIVE') continue;
          const key = `${stay.yearId}:${stay.classId}`;
          (sitters.get(key) ?? sitters.set(key, []).get(key)!).push({
            s,
            sectionId: stay.sectionId,
          });
        }
      }

      const classSubjects = await q<ClassSubj & { class_id: string; academic_year_id: string }>(
        `SELECT cs.id, cs.subject_id, su.code, cs.is_optional, cs.is_graded_only, cs.group_name,
                cs.choice_group, cs.class_id, cs.academic_year_id
           FROM class_subjects cs JOIN subjects su ON su.id = cs.subject_id
          WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL ORDER BY su.code, cs.id`,
        [tenant.id],
      );
      const picks = await q<{ student_id: string; class_subject_id: string; is_fourth: boolean }>(
        `SELECT student_id, class_subject_id, is_fourth FROM student_subject_choices
          WHERE tenant_id = $1`,
        [tenant.id],
      );
      const pickOf = new Map(picks.map((p) => [`${p.student_id}:${p.class_subject_id}`, p]));
      const pickedAny = new Set(picks.map((p) => p.class_subject_id));
      const terms = await q<{ id: string; academic_year_id: string; seq: number }>(
        `SELECT id, academic_year_id, seq FROM academic_terms WHERE tenant_id = $1`,
        [tenant.id],
      );
      const scales = await q<{ id: string; academic_year_id: string; class_id: string | null }>(
        `SELECT id, academic_year_id, class_id FROM grading_scales
          WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenant.id],
      );
      const bandRows = await q<{
        scale_id: string;
        percent_from: number;
        percent_to: number;
        grade: string;
        gpa: string | null;
        is_fail: boolean;
      }>(
        `SELECT scale_id, percent_from, percent_to, grade, gpa, is_fail FROM grading_bands
          WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenant.id],
      );
      const bandsOf = (scaleId: string): Band[] =>
        bandRows
          .filter((b) => b.scale_id === scaleId)
          .map((b) => ({ ...b, gpa: b.gpa === null ? null : Number(b.gpa) }));
      // The preset's exam templates give a subject its component split; others get one Written 100.
      const templateRows = await q<{
        class_grade: number;
        subject_code: string;
        name: string;
        kind: ExamComponentKind;
        full_marks: string;
        pass_marks: string;
        sequence: number;
      }>(
        `SELECT class_grade, subject_code, name, kind, full_marks, pass_marks, sequence
           FROM exam_template_components WHERE tenant_id = $1
          ORDER BY template_id, class_grade, subject_code, sequence`,
        [tenant.id],
      );
      const templateOf = (grade: number, code: string) => {
        // Every template repeats the row; the first one wins.
        const found = templateRows.filter(
          (t) => t.class_grade === grade && t.subject_code === code,
        );
        return found.filter((t, i) => found.findIndex((x) => x.name === t.name) === i);
      };

      const buf = {
        exams: [] as Record<string, unknown>[],
        components: [] as Record<string, unknown>[],
        schedules: [] as Record<string, unknown>[],
        grids: [] as Record<string, unknown>[],
        marks: [] as Record<string, unknown>[],
        results: [] as Record<string, unknown>[],
        resultSubjects: [] as Record<string, unknown>[],
      };
      const flush = async () => {
        rows += await insertChunked(ctx.ds.getRepository(Exam), buf.exams as never);
        rows += await insertChunked(ctx.ds.getRepository(ExamComponent), buf.components as never);
        rows += await insertChunked(ctx.ds.getRepository(ExamSchedule), buf.schedules as never);
        rows += await insertChunked(ctx.ds.getRepository(MarkGrid), buf.grids as never);
        rows += await insertChunked(ctx.ds.getRepository(Mark), buf.marks as never);
        rows += await insertChunked(ctx.ds.getRepository(Result), buf.results as never);
        rows += await insertChunked(
          ctx.ds.getRepository(ResultSubject),
          buf.resultSubjects as never,
        );
        for (const list of Object.values(buf)) list.length = 0;
      };

      const examsToProcess: string[] = [];
      const nextSchedules: string[] = [];

      for (const year of tenant.years) {
        const yearTerms = terms.filter((t) => t.academic_year_id === year.id);
        const termId = (seq: number) => yearTerms.find((t) => t.seq === seq)?.id ?? null;
        const yearEffect = 0.03 * gauss(); // D33: pass rate and GPA vary by year

        for (const cls of year.classes) {
          const cohort = sitters.get(`${year.id}:${cls.id}`) ?? [];
          const groups = new Set(cls.sections.map((s) => s.group).filter(Boolean));
          const offered = classSubjects.filter(
            (cs) =>
              cs.class_id === cls.id &&
              cs.academic_year_id === year.id &&
              !cs.choice_group &&
              (!cs.group_name || groups.has(cs.group_name)) &&
              (!cs.is_optional || pickedAny.has(cs.id)),
          );
          const scale = resolveScale(scales, year.id, cls.id);
          const bands = scale ? bandsOf(scale.id) : [];
          const sectionGroup = new Map(cls.sections.map((s) => [s.id, s.group]));

          const exams = [
            ...TERM_EXAMS,
            ...(TEST_EXAM.grades.includes(cls.numericGrade as 10 | 12) ? [TEST_EXAM] : []),
          ];
          for (const e of exams) {
            const state: State = !year.isCurrent
              ? 'published'
              : e.name === 'Half-Yearly Exam'
                ? 'progress'
                : e.name === 'Annual Exam'
                  ? 'next'
                  : 'published';
            const window = examWindow(year, e, ctx.anchor);
            if (!window) continue; // no room for it in this year yet (or any more)
            const { start, end } = window;
            const examId = uuid();
            const live = year.isCurrent; // current-year results go through the real service
            buf.exams.push({
              id: examId,
              tenant_id: tenant.id,
              academic_year_id: year.id,
              class_id: cls.id,
              academic_term_id: termId(e.term),
              name: e.name,
              kind: e.name === TEST_EXAM.name ? ExamKind.OTHER : ExamKind.TERM,
              status: !live ? ExamStatus.PUBLISHED : ExamStatus.DRAFT,
              published_at: !live ? at(addDays(end, 10), 10) : null,
              mark_entry_deadline: addDays(end, 7),
            });
            if (live && state === 'published') examsToProcess.push(examId);

            const days = schoolDays(start, end);
            const comps = new Map<string, Comp[]>(); // subject_id -> components
            offered.forEach((cs, i) => {
              // More papers than school days: stack the extra ones into later time slots.
              const date = days[i % days.length];
              const slot = Math.floor(i / days.length);
              const startH = 10 + slot * 3;
              const endH = startH + (e.name === TEST_EXAM.name ? 1 : 2);
              buf.schedules.push({
                id: uuid(),
                tenant_id: tenant.id,
                exam_id: examId,
                subject_id: cs.subject_id,
                date,
                starts_at: `${startH}:00:00`,
                ends_at: `${endH}:00:00`,
              });
              if (state === 'next') nextSchedules.push(`${examId}:${cs.subject_id}`);
              const template = templateOf(cls.numericGrade, cs.code);
              const list: Comp[] = (
                template.length
                  ? template.map((t) => ({
                      name: t.name,
                      kind: t.kind,
                      full: Number(t.full_marks),
                      pass: Number(t.pass_marks),
                      seq: t.sequence,
                    }))
                  : [
                      {
                        name: 'Written',
                        kind: ExamComponentKind.WRITTEN,
                        full: 100,
                        pass: 33,
                        seq: 0,
                      },
                    ]
              ).map((c) => ({ ...c, id: uuid() }));
              comps.set(cs.subject_id, list);
              for (const c of list) {
                buf.components.push({
                  id: c.id,
                  tenant_id: tenant.id,
                  exam_id: examId,
                  subject_id: cs.subject_id,
                  name: c.name,
                  kind: c.kind,
                  source: ExamComponentSource.MANUAL,
                  full_marks: c.full.toFixed(2),
                  pass_marks: c.pass.toFixed(2),
                  sequence: c.seq,
                });
              }
            });
            if (state === 'next') continue;

            // Mark grids: every section x subject once the exam is finished; about half of them
            // are filled (and left unsubmitted) while marks entry is in progress.
            const dateOf = new Map(
              buf.schedules
                .filter((s) => s.exam_id === examId)
                .map((s) => [s.subject_id as string, s.date as string]),
            );
            const filled = new Set<string>();
            for (const sec of cls.sections) {
              for (const cs of offered) {
                // Every section x subject, even a group subject in a section outside that group:
                // MarkGridService.progress requires all of them before results can be processed.
                const key = `${sec.id}:${cs.subject_id}`;
                if (state === 'progress' && u() >= 0.5) continue;
                filled.add(key);
                buf.grids.push({
                  id: uuid(),
                  tenant_id: tenant.id,
                  exam_id: examId,
                  section_id: sec.id,
                  subject_id: cs.subject_id,
                  state: state === 'progress' ? MarkGridState.DRAFT : MarkGridState.SUBMITTED,
                  submitted_by: state === 'progress' ? null : org.adminUserId,
                  submitted_at: state === 'progress' ? null : at(addDays(end, 3), 15),
                });
              }
            }

            // Marks, and for older years the results computed from them.
            const computed: {
              s: Sitter;
              total: number;
              gpa: number;
              grade: string;
              fail: boolean;
              subjects: (SubjectResult & { obtained: number })[];
            }[] = [];
            for (const sitter of cohort) {
              const subjects: SubjectResult[] = [];
              for (const cs of offered) {
                const picked = pickOf.get(`${sitter.s.id}:${cs.id}`);
                if (!sitsSubject(cs, sectionGroup.get(sitter.sectionId) ?? null, !!picked))
                  continue;
                const inputs: ComponentInput[] = [];
                const pct =
                  ability.get(sitter.s.id)! +
                  yearEffect +
                  difficultyOf(cs.subject_id) +
                  0.04 * gauss();
                for (const c of comps.get(cs.subject_id)!) {
                  const absent = u() < 0.002;
                  const value = Math.round(clamp(pct + 0.02 * gauss()) * c.full);
                  inputs.push({
                    full_marks: c.full,
                    value: absent ? null : value,
                    status: absent ? MarkStatus.ABSENT : MarkStatus.PRESENT,
                    pass_marks: c.pass,
                  });
                  if (!filled.has(`${sitter.sectionId}:${cs.subject_id}`)) continue;
                  const when = at(dateOf.get(cs.subject_id)!, 14);
                  buf.marks.push({
                    id: uuid(),
                    tenant_id: tenant.id,
                    exam_id: examId,
                    student_id: sitter.s.id,
                    subject_id: cs.subject_id,
                    component_id: c.id,
                    value: absent ? null : value.toFixed(2),
                    status: absent ? MarkStatus.ABSENT : MarkStatus.PRESENT,
                    entered_by: org.adminUserId,
                    created_at: when,
                    updated_at: when,
                  });
                }
                if (live) continue;
                const total = computeSubjectTotal(inputs);
                subjects.push({
                  subject_id: cs.subject_id,
                  obtained: total.obtained,
                  full_marks: total.full_marks,
                  is_countable: !cs.is_graded_only,
                  is_fourth_subject: cs.is_optional && !!picked?.is_fourth,
                  ...gradeSubjectTotal(total, (p) => gradeFor(bands, p)),
                });
              }
              if (live) continue;
              const overall = combineSubjects(subjects, (gpa) => {
                const eligible = bands.filter((b) => b.gpa !== null && b.gpa <= gpa);
                return eligible.length
                  ? eligible.reduce((best, b) =>
                      (b.gpa as number) > (best.gpa as number) ? b : best,
                    )
                  : null;
              });
              computed.push({
                s: sitter,
                total: overall.total_marks,
                gpa: overall.gpa,
                grade: overall.grade,
                fail: overall.is_fail,
                subjects: subjects as never,
              });
            }

            if (live) continue;
            if (!scale) {
              throw new Error(
                `demo-seed exams: no grading scale for class ${cls.id} in year ${year.id}; cannot publish ${e.name}`,
              );
            }
            // Older years: the same columns ResultsService.replaceResults writes (D4: bulk insert).
            const rank = (list: typeof computed) =>
              rankByMerit(
                list.map((c) => ({
                  student_id: c.s.s.id,
                  gpa: c.gpa,
                  total_marks: c.total,
                  is_fail: c.fail,
                })),
              );
            const classRank = rank(computed);
            const sectionRank = new Map<string, number | null>();
            for (const sec of cls.sections) {
              for (const [id, p] of rank(computed.filter((c) => c.s.sectionId === sec.id))) {
                sectionRank.set(id, p);
              }
            }
            for (const c of computed) {
              const resultId = uuid();
              buf.results.push({
                id: resultId,
                tenant_id: tenant.id,
                exam_id: examId,
                student_id: c.s.s.id,
                total_marks: c.total.toFixed(2),
                gpa: c.gpa.toFixed(2),
                grade: c.grade,
                position: classRank.get(c.s.s.id) ?? null,
                section_id: c.s.sectionId,
                section_position: sectionRank.get(c.s.s.id) ?? null,
                is_fail: c.fail,
                grading_scale_id: scale.id,
                grading_scale_revision: 1,
                rule_version: RULE_VERSION,
                computed_at: at(addDays(end, 7), 10),
                published_at: at(addDays(end, 10), 10),
              });
              for (const sub of c.subjects) {
                buf.resultSubjects.push({
                  id: uuid(),
                  tenant_id: tenant.id,
                  result_id: resultId,
                  subject_id: sub.subject_id,
                  obtained: sub.obtained.toFixed(2),
                  grade: sub.grade,
                  gpa: (sub.gpa ?? 0).toFixed(2),
                  is_fail: sub.is_fail,
                  is_fourth_subject: sub.is_fourth_subject,
                });
              }
            }
          }
        }
        await flush();
      }

      // The current year's finished exams: the real computation and publication (D4).
      for (const examId of examsToProcess) {
        await results.process(examId, tenant.id, org.adminUserId);
        await results.publish(examId, tenant.id, org.adminUserId);
      }
      // The service stamps the real clock; move computed / published to just after the sitting so
      // the story matches the dates (and two runs of one anchor give identical rows).
      if (examsToProcess.length) {
        await ctx.ds.query(
          `UPDATE results r
              SET computed_at = ((s.last + 7)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Dhaka',
                  published_at = ((s.last + 10)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Dhaka'
             FROM (SELECT exam_id, max(date) AS last FROM exam_schedules GROUP BY 1) s
            WHERE s.exam_id = r.exam_id AND r.tenant_id = $1 AND r.exam_id = ANY($2)`,
          [tenant.id, examsToProcess],
        );
        await ctx.ds.query(
          `UPDATE result_subjects rs
              SET created_at = r.computed_at, updated_at = r.computed_at
             FROM results r
            WHERE rs.result_id = r.id AND r.tenant_id = $1 AND r.exam_id = ANY($2)`,
          [tenant.id, examsToProcess],
        );
        await ctx.ds.query(
          `UPDATE exams e
              SET published_at = ((s.last + 10)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Dhaka'
             FROM (SELECT exam_id, max(date) AS last FROM exam_schedules GROUP BY 1) s
            WHERE s.exam_id = e.id AND e.tenant_id = $1 AND e.id = ANY($2)`,
          [tenant.id, examsToProcess],
        );
      }

      // Final results (Epic 70, #3407), all through the real service. A past year: every class
      // with published term results gets Half-Yearly 30 / Annual 70 and is published. In each past
      // year one class also counts First Term (20/30/50), and one other uses best-of-2 (D23).
      // The current year gets DRAFT finals only, as its Annual exam is not published yet.
      for (const year of tenant.years) {
        const withResults = await q<{ class_id: string }>(
          `SELECT DISTINCT e.class_id FROM exams e
             JOIN results r ON r.exam_id = e.id AND r.deleted_at IS NULL
            WHERE e.tenant_id = $1 AND e.academic_year_id = $2 AND e.kind = 'TERM'
              AND e.status = 'PUBLISHED' AND e.name = 'Annual Exam'`,
          [tenant.id, year.id],
        );
        const classIds = year.isCurrent
          ? year.classes.map((c) => c.id)
          : year.classes.map((c) => c.id).filter((id) => withResults.some((r) => r.class_id === id));
        const threeWay = classIds.length ? classIds[Math.floor(u() * classIds.length)] : null;
        const bestOf = classIds.length > 1 ? classIds.filter((id) => id !== threeWay)[Math.floor(u() * (classIds.length - 1))] : null;
        for (const classId of classIds) {
          const final = await finals.create(
            { class_id: classId, academic_year_id: year.id },
            tenant.id,
            org.adminUserId,
          );
          rows += 1;
          if (year.isCurrent) continue;
          const examIds = new Map(
            (
              await q<{ id: string; name: string }>(
                `SELECT id, name FROM exams WHERE tenant_id = $1 AND class_id = $2
                    AND academic_year_id = $3 AND kind = 'TERM' AND status = 'PUBLISHED'`,
                [tenant.id, classId, year.id],
              )
            ).map((e) => [e.name, e.id]),
          );
          const share = (name: string, percent: number) => ({
            exam_id: examIds.get(name)!,
            subject_id: null,
            share_percent: percent,
          });
          if (classId === bestOf) {
            await finals.update(
              final.id,
              { mode: FinalResultMode.BEST_OF, best_of_count: 2 },
              tenant.id,
              org.adminUserId,
            );
          } else {
            await finals.update(
              final.id,
              {
                weights:
                  classId === threeWay
                    ? [
                        share('First Term Exam', 20),
                        share('Half-Yearly Exam', 30),
                        share('Annual Exam', 50),
                      ]
                    : [share('Half-Yearly Exam', 30), share('Annual Exam', 70)],
              },
              tenant.id,
              org.adminUserId,
            );
          }
          await finals.build(final.id, tenant.id, org.adminUserId);
          await finals.publish(final.id, tenant.id, org.adminUserId);
        }
      }
      // The service stamps the real clock; date each published final just after its Annual exam
      // so the story matches the exam dates and reruns on one anchor give identical rows.
      await ctx.ds.query(
        `UPDATE final_results fr
            SET published_at = e.published_at + interval '2 days',
                created_at = e.published_at + interval '1 day',
                updated_at = e.published_at + interval '2 days'
           FROM exams e
          WHERE e.tenant_id = fr.tenant_id AND e.class_id = fr.class_id
            AND e.academic_year_id = fr.academic_year_id AND e.name = 'Annual Exam'
            AND fr.tenant_id = $1 AND fr.status = 'PUBLISHED'`,
        [tenant.id],
      );
      await ctx.ds.query(
        `UPDATE final_result_rows r
            SET computed_at = fr.published_at - interval '1 day', published_at = fr.published_at
           FROM final_results fr
          WHERE fr.id = r.final_result_id AND fr.tenant_id = $1 AND fr.status = 'PUBLISHED'`,
        [tenant.id],
      );

      // The next exam's seat plan, across the branch's rooms (D15).
      if (nextSchedules.length) {
        const schedules = await q<{ id: string }>(
          `SELECT es.id FROM exam_schedules es JOIN exams e ON e.id = es.exam_id
            WHERE es.tenant_id = $1 AND e.status = 'DRAFT' AND e.name = 'Annual Exam'
              AND es.deleted_at IS NULL
              AND es.date > $2 ORDER BY es.date, es.id`,
          [tenant.id, ctx.anchor],
        );
        const { plan } = await seatPlans.generate(tenant.id, {
          name: 'Annual Exam seating',
          exam_schedule_ids: schedules.map((s) => s.id),
          room_ids: tenant.rooms.map((r) => r.id),
          seat_order_mode: SeatOrderMode.SEQUENTIAL,
        });
        await seatPlans.publish(tenant.id, (plan as { id: string }).id);
        rows += 1;
      }
    }
    return rows;
  },
};

/** End date of term `seq` of a year; the org slice cuts a year into three four-month terms. */
/** The shortest sitting window kept: fewer days would stack papers past the evening. */
const MIN_WINDOW_DAYS = 7;

/**
 * An exam's sitting window. Older years: a week before each term ends (the Test exam 8 weeks in).
 * The current year is laid out from the anchor so every state exists "today" (D15): Test and First
 * Term published, Half-Yearly in marks entry, Annual next. The window is kept inside the academic
 * year, and an exam that does not fit is left out (null): early in the year there is no room yet for
 * the exams before the anchor, and late in the year the Annual exam moves up to the year's last days.
 */
export function examWindow(
  year: Pick<OrgYear, 'start' | 'end' | 'isCurrent'>,
  e: { term: number; name: string },
  anchor: string,
): { start: string; end: string } | null {
  let end: string;
  if (!year.isCurrent) {
    end =
      e.name === TEST_EXAM.name ? addDays(year.start, 56) : addDays(yearTermEnd(year, e.term), -7);
  } else if (e.name === TEST_EXAM.name) end = addDays(anchor, TEST_END);
  else if (e.term === 1) end = addDays(anchor, FIRST_END);
  else if (e.term === 2) end = addDays(anchor, HALF_END);
  else end = addDays(anchor, ANNUAL_START + WINDOW_DAYS - 1);
  let start = addDays(end, 1 - WINDOW_DAYS);
  if (year.isCurrent && e.term === 3 && end > year.end) {
    // Annual: the year's last days, but never today or earlier (it is still "next").
    const tomorrow = addDays(anchor, 1);
    const late = addDays(year.end, 1 - WINDOW_DAYS);
    start = late > tomorrow ? late : tomorrow;
  }
  if (start < year.start) start = year.start;
  if (end > year.end) end = year.end;
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  return days >= MIN_WINDOW_DAYS ? { start, end } : null;
}

function yearTermEnd(year: Pick<OrgYear, 'start'>, seq: number): string {
  const d = new Date(`${year.start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + seq * 4, 0);
  return d.toISOString().slice(0, 10);
}
