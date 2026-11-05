import type { EntityManager } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DocumentKind } from '@biddaloy/shared';
import type { FieldResolver, PrintContext, ResolvedSubject } from './field-resolver';
import { blankValues, schoolValues } from './field-values';

export type ResultCertificateKind =
  typeof DocumentKind.RESULT_CERTIFICATE | typeof DocumentKind.MERIT_CERTIFICATE;

type Reason = 'NO_RESULT' | 'NOT_PUBLISHED' | 'FAILED' | 'NOT_RANKED';

interface Row {
  id: string;
  full_name: string;
  full_name_bn: string | null;
  registration_number: string;
  roll_number: number | null;
  father_name: string | null;
  mother_name: string | null;
  birth_reg_no: string | null;
  dob: string | null;
  photo_key: string | null;
  class_name: string | null;
  section_name: string | null;
  total_marks: string;
  gpa: string;
  grade: string;
  position: number | null;
  section_position: number | null;
  is_fail: boolean;
  published_at: Date | null;
  /** Final-sourced rows only: the attendance snapshot taken at publish (D9). */
  working_days?: number | null;
  present_days?: number | null;
  remark?: string | null;
}

const num = (n: number | null) => (n == null ? '' : String(n));

/**
 * Result / merit certificate values from a published result of one exam (D29), or of a published
 * final result (D21). The print context stays `EXAM` (a shared enum, one DB value); its id is
 * looked up as an exam first, then as a final result, so no schema or enum change is needed.
 */
export class ResultCertificateResolver implements FieldResolver {
  subjectType = 'STUDENT' as const;

  constructor(readonly kind: ResultCertificateKind) {}

  async resolve(
    tenantId: string,
    subjectIds: string[],
    manager: EntityManager,
    _callerId?: string,
    context?: PrintContext,
  ) {
    if (context?.type !== 'EXAM') throw new BadRequestException('Certificates need an exam');

    const [exam] = await manager.query(
      `SELECT e.id, e.name, ay.name AS year_name
         FROM exams e JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1 AND e.id = $2 AND e.deleted_at IS NULL`,
      [tenantId, context.id],
    );
    const [final] = exam
      ? []
      : await manager.query(
          `SELECT f.id, ay.name AS year_name
             FROM final_results f JOIN academic_years ay ON ay.id = f.academic_year_id AND ay.tenant_id = f.tenant_id
            WHERE f.tenant_id = $1 AND f.id = $2 AND f.deleted_at IS NULL`,
          [tenantId, context.id],
        );
    if (!exam && !final) throw new NotFoundException('Exam not found');

    // Class/section come from the result's own section, not the live enrollment.
    const rows: Row[] = exam
      ? await manager.query(
          `SELECT s.id, s.full_name, s.full_name_bn, s.registration_number, s.roll_number,
              s.father_name, s.mother_name, s.birth_reg_no,
              to_char(s.date_of_birth, 'YYYY-MM-DD') AS dob, s.photo_key,
              c.name AS class_name, cs.section_name,
              r.total_marks, r.gpa, r.grade, r.position, r.section_position, r.is_fail,
              r.published_at
         FROM results r
         JOIN students s ON s.id = r.student_id AND s.tenant_id = r.tenant_id
         LEFT JOIN class_sections cs ON cs.id = r.section_id AND cs.tenant_id = r.tenant_id
         LEFT JOIN classes c ON c.id = cs.class_id AND c.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 AND r.exam_id = $2 AND r.student_id = ANY($3::uuid[])
          AND r.deleted_at IS NULL AND s.deleted_at IS NULL`,
          [tenantId, exam.id, subjectIds],
        )
      : await manager.query(
          // Like an exam, an unpublished final refuses per student: its rows carry no published_at
          // (reopen clears it). The attendance numbers are the publish snapshot (D9).
          `SELECT s.id, s.full_name, s.full_name_bn, s.registration_number, s.roll_number,
              s.father_name, s.mother_name, s.birth_reg_no,
              to_char(s.date_of_birth, 'YYYY-MM-DD') AS dob, s.photo_key,
              c.name AS class_name, cs.section_name,
              r.total_marks, r.gpa, r.grade, r.position, r.section_position, r.is_fail,
              r.published_at, r.working_days, r.present_days, n.remark
         FROM final_result_rows r
         JOIN students s ON s.id = r.student_id AND s.tenant_id = r.tenant_id
         LEFT JOIN class_sections cs ON cs.id = r.section_id AND cs.tenant_id = r.tenant_id
         LEFT JOIN classes c ON c.id = cs.class_id AND c.tenant_id = r.tenant_id
         LEFT JOIN report_card_notes n ON n.tenant_id = r.tenant_id
          AND n.final_result_id = r.final_result_id AND n.student_id = r.student_id
        WHERE r.tenant_id = $1 AND r.final_result_id = $2 AND r.student_id = ANY($3::uuid[])
          AND r.deleted_at IS NULL AND s.deleted_at IS NULL`,
          [tenantId, final.id, subjectIds],
        );

    const refused: { id: string; reason: Reason }[] = [];
    // A student of this school with no result for the exam (absent) is refused like the rest;
    // an id that is not a student here stays missing, so the caller still gets a 404.
    const found = new Set(rows.map((r) => r.id));
    const missing = subjectIds.filter((id) => !found.has(id));
    if (missing.length) {
      const known: { id: string }[] = await manager.query(
        `SELECT id FROM students WHERE tenant_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
        [tenantId, missing],
      );
      for (const k of known) refused.push({ id: k.id, reason: 'NO_RESULT' });
    }
    for (const r of rows) {
      const reason = this.refusal(r);
      if (reason) refused.push({ id: r.id, reason });
    }
    if (refused.length) {
      throw new ConflictException({
        message: 'Some students cannot get this certificate',
        details: { code: 'CERTIFICATE_NOT_ELIGIBLE', kind: this.kind, students: refused },
      });
    }

    const school = await schoolValues(tenantId, manager);
    const out = new Map<string, ResolvedSubject>();
    for (const r of rows) {
      out.set(r.id, {
        label: r.full_name,
        photoKey: r.photo_key,
        values: {
          ...blankValues(this.kind),
          ...school,
          'student.name': r.full_name,
          'student.name_bn': r.full_name_bn || r.full_name,
          'student.father_name': r.father_name ?? '',
          'student.mother_name': r.mother_name ?? '',
          'student.class': r.class_name ?? '',
          'student.section': r.section_name ?? '',
          'student.roll': num(r.roll_number),
          'student.registration_number': r.registration_number,
          'student.date_of_birth': r.dob ?? '',
          'student.birth_reg_no': r.birth_reg_no ?? '',
          // A final has no single exam name; its year still prints.
          'exam.name': exam?.name ?? '',
          'exam.year': (exam ?? final).year_name,
          'result.total_marks': r.total_marks,
          'result.gpa': r.gpa,
          'result.grade': r.grade,
          'result.position': num(r.position),
          ...(final && {
            'final_result.year': final.year_name,
            'final_result.total': r.total_marks,
            'final_result.gpa': r.gpa,
            'final_result.grade': r.grade,
            'final_result.position': num(r.position),
            'final_result.section_position': num(r.section_position),
            'attendance.working_days': num(r.working_days ?? null),
            'attendance.present_days': num(r.present_days ?? null),
            'report_card.remark': r.remark ?? '',
          }),
          // Only the merit catalog has this key.
          ...(this.kind === DocumentKind.MERIT_CERTIFICATE && {
            'result.section_position': num(r.section_position),
          }),
        },
      });
    }
    return out;
  }

  private refusal(r: Row): Reason | null {
    if (!r.published_at) return 'NOT_PUBLISHED';
    if (this.kind === DocumentKind.RESULT_CERTIFICATE) return r.is_fail ? 'FAILED' : null;
    return r.position == null && r.section_position == null ? 'NOT_RANKED' : null;
  }
}
