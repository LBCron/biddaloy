import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FeeDuesService } from '../../fees/fee-dues.service';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import {
  AdmitCardRosterDto,
  MeritCandidateDto,
  MeritCandidatesQueryDto,
  TabulationDto,
  FinalTabulationDto,
} from './dto/exam-documents.dto';

/** [48.2.05] Read-only feeds for the exam "Print" tab. Every query is tenant-scoped in SQL. */
@Injectable()
export class ExamDocumentsService {
  constructor(
    private readonly ds: DataSource,
    private readonly feeDues: FeeDuesService,
    private readonly settings: SchoolSettingsReader,
  ) {}

  private async getExam(tenantId: string, examId: string) {
    const [exam] = await this.ds.query(
      `SELECT id, name, class_id, academic_year_id, published_at FROM exams
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [examId, tenantId],
    );
    if (!exam) throw new NotFoundException('Exam not found');
    return exam as {
      id: string;
      name: string;
      class_id: string;
      academic_year_id: string;
      published_at: Date | null;
    };
  }

  async admitCardRoster(tenantId: string, examId: string): Promise<AdmitCardRosterDto> {
    const exam = await this.getExam(tenantId, examId);

    const rows: Array<{
      student_id: string;
      full_name: string;
      roll_number: number;
      section_name: string | null;
      printed_copies: string;
      last_printed_at: Date | null;
    }> = await this.ds.query(
      `SELECT s.id AS student_id, s.full_name, s.roll_number, cs.section_name,
              COALESCE(p.copies, 0) AS printed_copies, p.last_at AS last_printed_at
       FROM enrollments e
       JOIN students s ON s.id = e.student_id AND s.tenant_id = e.tenant_id AND s.deleted_at IS NULL
       LEFT JOIN class_sections cs ON cs.id = e.section_id AND cs.tenant_id = e.tenant_id
       LEFT JOIN (
         SELECT subject_id, COUNT(*) AS copies, MAX(created_at) AS last_at
         FROM print_job_items
         WHERE tenant_id = $1 AND document_kind = 'EXAM_ADMIT_CARD' AND context_id = $2
           AND revoked_at IS NULL AND outcome <> 'FAILED'
         GROUP BY subject_id
       ) p ON p.subject_id = s.id
       WHERE e.tenant_id = $1 AND e.class_id = $3 AND e.academic_year_id = $4
         AND e.enrollment_status = 'ACTIVE'
       ORDER BY cs.section_name NULLS LAST, s.roll_number`,
      [tenantId, examId, exam.class_id, exam.academic_year_id],
    );

    const [published] = await this.ds.query(
      `SELECT 1 FROM seat_plan_schedules sps
       JOIN seat_plans sp ON sp.id = sps.seat_plan_id AND sp.tenant_id = sps.tenant_id
       JOIN exam_schedules es ON es.id = sps.exam_schedule_id
       WHERE sps.tenant_id = $1 AND es.exam_id = $2 AND sps.deleted_at IS NULL
         AND es.deleted_at IS NULL AND sp.deleted_at IS NULL AND sp.status = 'PUBLISHED'
       LIMIT 1`,
      [tenantId, examId],
    );

    const withhold =
      (await this.settings.documentsSettings(tenantId)).withholdAdmitCardForDues === true;
    // Fee data is only read when the school withholds for dues (D9).
    const dues = withhold
      ? await this.feeDues.getDueSnapshots(
          rows.map((r) => r.student_id),
          tenantId,
        )
      : null;

    return {
      withhold_for_dues: withhold,
      seat_plan_published: !!published,
      students: rows.map((r) => ({
        student_id: r.student_id,
        full_name: r.full_name,
        roll_number: r.roll_number,
        section_name: r.section_name,
        printed_copies: Number(r.printed_copies),
        last_printed_at: r.last_printed_at ? new Date(r.last_printed_at).toISOString() : null,
        has_dues: dues ? (dues.get(r.student_id)?.total_due ?? 0) > 0 : null,
      })),
    };
  }

  async meritCandidates(
    tenantId: string,
    examId: string,
    { scope, top }: MeritCandidatesQueryDto,
  ): Promise<MeritCandidateDto[]> {
    await this.getExam(tenantId, examId);
    const bySection = scope === 'SECTION';
    const rows = await this.ds.query(
      `SELECT s.id AS student_id, s.full_name, cs.section_name, r.position, r.section_position, r.gpa
       FROM results r
       JOIN students s ON s.id = r.student_id AND s.tenant_id = r.tenant_id AND s.deleted_at IS NULL
       LEFT JOIN class_sections cs ON cs.id = r.section_id AND cs.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1 AND r.exam_id = $2 AND r.deleted_at IS NULL
         AND r.published_at IS NOT NULL AND r.is_fail = false
         AND ${bySection ? 'r.section_position' : 'r.position'} <= $3
       ORDER BY ${bySection ? 'cs.section_name NULLS LAST, r.section_id, r.section_position, r.position' : 'r.position'}`,
      [tenantId, examId, top],
    );
    return rows.map((r: any) => ({
      student_id: r.student_id,
      full_name: r.full_name,
      section_name: r.section_name,
      position: r.position,
      section_position: r.section_position,
      gpa: Number(r.gpa),
    }));
  }

  /** [48.3.gS-01] Whole-section tabulation in one call (replaces N per-student result reads). */
  async tabulation(tenantId: string, examId: string, sectionId: string): Promise<TabulationDto> {
    const exam = await this.getExam(tenantId, examId);
    const [section] = await this.ds.query(
      `SELECT cs.id, cs.section_name, c.name AS class_name
       FROM class_sections cs JOIN classes c ON c.id = cs.class_id AND c.tenant_id = cs.tenant_id
       WHERE cs.id = $1 AND cs.tenant_id = $2 AND cs.class_id = $3 AND cs.deleted_at IS NULL`,
      [sectionId, tenantId, exam.class_id],
    );
    if (!section) throw new NotFoundException('Section not found');

    const results = await this.ds.query(
      `SELECT r.id, r.student_id, s.roll_number, s.full_name, r.total_marks, r.gpa, r.grade,
              r.section_position, r.is_fail
       FROM results r
       JOIN students s ON s.id = r.student_id AND s.tenant_id = r.tenant_id AND s.deleted_at IS NULL
       WHERE r.tenant_id = $1 AND r.exam_id = $2 AND r.section_id = $3 AND r.deleted_at IS NULL
       ORDER BY s.roll_number, s.full_name`,
      [tenantId, examId, sectionId],
    );
    if (results.length === 0) {
      throw new ConflictException({
        message: 'Results are not processed yet',
        details: { code: 'RESULTS_NOT_PROCESSED' },
      });
    }

    const lines = await this.ds.query(
      `SELECT rs.result_id, rs.subject_id, rs.obtained, rs.grade, rs.is_fail
       FROM result_subjects rs
       WHERE rs.tenant_id = $1 AND rs.deleted_at IS NULL AND rs.result_id = ANY($2::uuid[])`,
      [tenantId, results.map((r: any) => r.id)],
    );
    // Subjects in report-card order: compulsory before optional, then by name.
    const subjects = await this.ds.query(
      `SELECT sub.id AS subject_id, sub.name_en, sub.name_bn,
              COALESCE((SELECT SUM(ec.full_marks) FROM exam_components ec
                        WHERE ec.tenant_id = $1 AND ec.exam_id = $2 AND ec.subject_id = sub.id
                          AND ec.deleted_at IS NULL), 0) AS full_marks
       FROM subjects sub
       LEFT JOIN class_subjects cls ON cls.subject_id = sub.id AND cls.tenant_id = sub.tenant_id
         AND cls.class_id = $3 AND cls.academic_year_id = $4 AND cls.deleted_at IS NULL
       WHERE sub.tenant_id = $1 AND sub.id = ANY($5::uuid[])
       ORDER BY COALESCE(cls.is_optional, false), sub.name_en`,
      [
        tenantId,
        examId,
        exam.class_id,
        exam.academic_year_id,
        [...new Set(lines.map((l: any) => l.subject_id))],
      ],
    );

    const cellsByResult = new Map<string, Record<string, any>>();
    for (const l of lines) {
      const cells = cellsByResult.get(l.result_id) ?? {};
      cells[l.subject_id] = { obtained: Number(l.obtained), grade: l.grade, is_fail: l.is_fail };
      cellsByResult.set(l.result_id, cells);
    }

    return {
      exam: {
        id: exam.id,
        name: exam.name,
        published_at: exam.published_at ? new Date(exam.published_at).toISOString() : null,
      },
      section: { id: section.id, name: section.section_name, class_name: section.class_name },
      subjects: subjects.map((s: any) => ({
        subject_id: s.subject_id,
        name_en: s.name_en,
        name_bn: s.name_bn,
        full_marks: Number(s.full_marks),
      })),
      rows: results.map((r: any) => ({
        student_id: r.student_id,
        roll_number: r.roll_number,
        full_name: r.full_name,
        cells: cellsByResult.get(r.id) ?? {},
        total_marks: Number(r.total_marks),
        gpa: Number(r.gpa),
        grade: r.grade,
        section_position: r.section_position,
        is_fail: r.is_fail,
      })),
    };
  }
  /**
   * [70.4.1, D20] Whole-section tabulation of a final result: counted exams' subject totals, then
   * the final subject marks and the final total / GPA / position. Reads the stored final rows
   * (PROCESSED or PUBLISHED); a DRAFT has none and answers 409 like the exam sheet.
   */
  async finalTabulation(
    tenantId: string,
    finalId: string,
    sectionId: string,
  ): Promise<FinalTabulationDto> {
    const [final] = await this.ds.query(
      `SELECT f.id, f.class_id, f.academic_year_id, f.status, f.published_at, ay.name AS year_name
         FROM final_results f
         JOIN academic_years ay ON ay.id = f.academic_year_id AND ay.tenant_id = f.tenant_id
        WHERE f.id = $1 AND f.tenant_id = $2 AND f.deleted_at IS NULL`,
      [finalId, tenantId],
    );
    if (!final) throw new NotFoundException('Final result not found');
    const [section] = await this.ds.query(
      `SELECT cs.id, cs.section_name, c.name AS class_name
         FROM class_sections cs JOIN classes c ON c.id = cs.class_id AND c.tenant_id = cs.tenant_id
        WHERE cs.id = $1 AND cs.tenant_id = $2 AND cs.class_id = $3 AND cs.deleted_at IS NULL`,
      [sectionId, tenantId, final.class_id],
    );
    if (!section) throw new NotFoundException('Section not found');

    const rows = await this.ds.query(
      `SELECT r.id, r.student_id, s.roll_number, s.full_name, r.total_marks, r.gpa, r.grade,
              r.position, r.section_position, r.is_fail
         FROM final_result_rows r
         JOIN students s ON s.id = r.student_id AND s.tenant_id = r.tenant_id AND s.deleted_at IS NULL
        WHERE r.tenant_id = $1 AND r.final_result_id = $2 AND r.section_id = $3
          AND r.deleted_at IS NULL
        ORDER BY s.roll_number, s.full_name`,
      [tenantId, finalId, sectionId],
    );
    if (rows.length === 0) {
      throw new ConflictException({
        message: 'Results are not processed yet',
        details: { code: 'RESULTS_NOT_PROCESSED' },
      });
    }
    const studentIds = rows.map((r: any) => r.student_id);

    // Counted exams, in sitting order like the transcript (unscheduled last, then created).
    const exams = await this.ds.query(
      `SELECT e.id AS exam_id, e.name,
              MAX(w.share_percent) FILTER (WHERE w.subject_id IS NULL) AS share_percent
         FROM final_result_weights w
         JOIN exams e ON e.id = w.exam_id AND e.tenant_id = w.tenant_id
         LEFT JOIN exam_schedules es ON es.exam_id = e.id AND es.tenant_id = e.tenant_id
          AND es.deleted_at IS NULL
        WHERE w.tenant_id = $1 AND w.final_result_id = $2
        GROUP BY e.id, e.name, e.created_at
        ORDER BY MIN(es.date) NULLS LAST, e.created_at, e.id`,
      [tenantId, finalId],
    );
    const examIds: string[] = exams.map((e: any) => e.exam_id);

    const finalLines = await this.ds.query(
      `SELECT fs.final_result_row_id, fs.subject_id, fs.obtained, fs.grade, fs.is_fail
         FROM final_result_subjects fs
        WHERE fs.tenant_id = $1 AND fs.deleted_at IS NULL AND fs.final_result_row_id = ANY($2::uuid[])`,
      [tenantId, rows.map((r: any) => r.id)],
    );
    const examResults = examIds.length
      ? await this.ds.query(
          `SELECT id, exam_id, student_id, total_marks FROM results
            WHERE tenant_id = $1 AND deleted_at IS NULL
              AND exam_id = ANY($2::uuid[]) AND student_id = ANY($3::uuid[])`,
          [tenantId, examIds, studentIds],
        )
      : [];
    const examLines = examResults.length
      ? await this.ds.query(
          `SELECT result_id, subject_id, obtained, grade FROM result_subjects
            WHERE tenant_id = $1 AND deleted_at IS NULL AND result_id = ANY($2::uuid[])`,
          [tenantId, examResults.map((r: any) => r.id)],
        )
      : [];
    // Subjects in report-card order: compulsory before optional, then by name.
    const subjects = await this.ds.query(
      `SELECT sub.id AS subject_id, sub.name_en, sub.name_bn
         FROM subjects sub
         LEFT JOIN class_subjects cls ON cls.subject_id = sub.id AND cls.tenant_id = sub.tenant_id
          AND cls.class_id = $2 AND cls.academic_year_id = $3 AND cls.deleted_at IS NULL
        WHERE sub.tenant_id = $1 AND sub.id = ANY($4::uuid[])
        ORDER BY COALESCE(cls.is_optional, false), sub.name_en`,
      [
        tenantId,
        final.class_id,
        final.academic_year_id,
        [...new Set(finalLines.map((l: any) => l.subject_id))],
      ],
    );

    const resultOf = new Map<string, any>(
      examResults.map((r: any) => [`${r.exam_id}:${r.student_id}`, r]),
    );
    // ABS with 0 = every component absent: no mark (null), not a real 0 — same rule as the build.
    const lineOf = new Map<string, number | null>(
      examLines.map((l: any) => [
        `${l.result_id}:${l.subject_id}`,
        l.grade === 'ABS' && Number(l.obtained) === 0 ? null : Number(l.obtained),
      ]),
    );
    const cellsByRow = new Map<string, Record<string, any>>();
    for (const l of finalLines) {
      const cells = cellsByRow.get(l.final_result_row_id) ?? {};
      cells[l.subject_id] = { obtained: Number(l.obtained), grade: l.grade, is_fail: l.is_fail };
      cellsByRow.set(l.final_result_row_id, cells);
    }

    return {
      final: {
        id: final.id,
        academic_year_name: final.year_name,
        status: final.status,
        published_at: final.published_at ? new Date(final.published_at).toISOString() : null,
      },
      section: { id: section.id, name: section.section_name, class_name: section.class_name },
      exams: exams.map((e: any) => ({
        exam_id: e.exam_id,
        name: e.name,
        share_percent: e.share_percent === null ? null : Number(e.share_percent),
      })),
      subjects: subjects.map((s: any) => ({
        subject_id: s.subject_id,
        name_en: s.name_en,
        name_bn: s.name_bn,
      })),
      rows: rows.map((r: any) => {
        const perExam = (subjectId: string) =>
          Object.fromEntries(
            examIds.map((examId) => {
              const res = resultOf.get(`${examId}:${r.student_id}`);
              return [examId, res ? (lineOf.get(`${res.id}:${subjectId}`) ?? null) : null];
            }),
          );
        return {
          student_id: r.student_id,
          roll_number: r.roll_number,
          full_name: r.full_name,
          cells: Object.fromEntries(
            Object.entries(cellsByRow.get(r.id) ?? {}).map(([sid, c]) => [
              sid,
              { ...c, per_exam: perExam(sid) },
            ]),
          ),
          exam_totals: Object.fromEntries(
            examIds.map((examId) => {
              const res = resultOf.get(`${examId}:${r.student_id}`);
              return [examId, res ? Number(res.total_marks) : null];
            }),
          ),
          total_marks: Number(r.total_marks),
          gpa: Number(r.gpa),
          grade: r.grade,
          position: r.position,
          section_position: r.section_position,
          is_fail: r.is_fail,
        };
      }),
    };
  }
}
