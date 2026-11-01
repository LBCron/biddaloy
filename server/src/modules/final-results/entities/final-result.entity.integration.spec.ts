import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
} from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { Exam } from '../../exams/entities/exam.entity';
import { assertNoLiveDependents } from '../../../common/utils/live-dependents';

/**
 * [70.1.2] DB-level invariants `FinalResultsAndReportCardNotes` adds that no unit test
 * can see: the two NULLS NOT DISTINCT uniques, the CHECK constraints, and that the
 * live-dependents scan sees the new foreign keys (Rule 27).
 */
describe('FinalResultsAndReportCardNotes1791900003000 (integration)', () => {
  let ds: DataSource;
  let examId: string;
  let subjectId: string;
  let studentId: string;
  let finalResultId: string;

  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  }, 60000);

  // Fixtures are recreated per test: these tables are in the global per-test reset.
  beforeEach(async () => {
    [{ id: subjectId }] = await q(
      `INSERT INTO "subjects" (id, tenant_id, name_en, code) VALUES (gen_random_uuid(), $1, 'FR Subject', 'FRS') RETURNING id`,
      [SEED_TENANT_ID],
    );
    [{ id: examId }] = await q(
      `INSERT INTO "exams" (id, tenant_id, academic_year_id, class_id, name, kind) VALUES (gen_random_uuid(), $1, $2, $3, 'FR Exam', 'TERM') RETURNING id`,
      [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID],
    );
    [{ id: studentId }] = await q(
      `INSERT INTO "students" (id, tenant_id, full_name, registration_number, roll_number, class_section_id) VALUES (gen_random_uuid(), $1, 'FR Student', 'REG-FR-1', 1, $2) RETURNING id`,
      [SEED_TENANT_ID, SEED_SECTION_1_ID],
    );
    [{ id: finalResultId }] = await q(
      `INSERT INTO "final_results" (id, tenant_id, class_id, academic_year_id) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [SEED_TENANT_ID, SEED_CLASS_1_ID, SEED_ACADEMIC_YEAR_ID],
    );
  });

  const addWeight = (subject: string | null) =>
    q(
      `INSERT INTO "final_result_weights" (tenant_id, final_result_id, exam_id, subject_id, share_percent) VALUES ($1, $2, $3, $4, 50)`,
      [SEED_TENANT_ID, finalResultId, examId, subject],
    );

  const addNote = (exam: string | null, finalResult: string | null) =>
    q(
      `INSERT INTO "report_card_notes" (tenant_id, student_id, exam_id, final_result_id) VALUES ($1, $2, $3, $4)`,
      [SEED_TENANT_ID, studentId, exam, finalResult],
    );

  it('allows one live final result per class and year, but not two', async () => {
    await expect(
      q(`INSERT INTO "final_results" (tenant_id, class_id, academic_year_id) VALUES ($1, $2, $3)`, [
        SEED_TENANT_ID,
        SEED_CLASS_1_ID,
        SEED_ACADEMIC_YEAR_ID,
      ]),
    ).rejects.toThrow(/duplicate key/);
    // A soft-deleted one does not block a new one.
    await q(`UPDATE "final_results" SET deleted_at = now() WHERE id = $1`, [finalResultId]);
    await q(
      `INSERT INTO "final_results" (tenant_id, class_id, academic_year_id) VALUES ($1, $2, $3)`,
      [SEED_TENANT_ID, SEED_CLASS_1_ID, SEED_ACADEMIC_YEAR_ID],
    );
  });

  it('rejects best_of_count on a WEIGHTED final result', async () => {
    await expect(
      q(`UPDATE "final_results" SET best_of_count = 2 WHERE id = $1`, [finalResultId]),
    ).rejects.toThrow(/CHK_final_results_best_of_mode/);
    // Best of 0 exams has no mean (the rules would divide by zero).
    await expect(
      q(`UPDATE "final_results" SET mode = 'BEST_OF', best_of_count = 0 WHERE id = $1`, [
        finalResultId,
      ]),
    ).rejects.toThrow(/CHK_final_results_best_of_mode/);
    await q(`UPDATE "final_results" SET mode = 'BEST_OF', best_of_count = 2 WHERE id = $1`, [
      finalResultId,
    ]);
  });

  it('treats a NULL subject as equal in the weight unique, and bounds the share', async () => {
    await addWeight(null);
    // Two whole-exam shares for the same exam collide (NULLS NOT DISTINCT).
    await expect(addWeight(null)).rejects.toThrow(/UQ_final_result_weights_natural/);
    // A per-subject share for the same exam is a different row.
    await addWeight(subjectId);
    await expect(addWeight(subjectId)).rejects.toThrow(/UQ_final_result_weights_natural/);
    await expect(
      q(`UPDATE "final_result_weights" SET share_percent = 100.01 WHERE subject_id IS NULL`),
    ).rejects.toThrow(/CHK_final_result_weights_share_range/);
  });

  it('requires a report card note to have exactly one target, once per student', async () => {
    await expect(addNote(null, null)).rejects.toThrow(/CHK_report_card_notes_one_target/);
    await expect(addNote(examId, finalResultId)).rejects.toThrow(
      /CHK_report_card_notes_one_target/,
    );
    await addNote(examId, null);
    await expect(addNote(examId, null)).rejects.toThrow(/UQ_report_card_notes_target/);
    // The same student can have a note on the final result too.
    await addNote(null, finalResultId);
    await expect(addNote(null, finalResultId)).rejects.toThrow(/UQ_report_card_notes_target/);
  });

  it('makes the live-dependents scan refuse an exam that has a weight row', async () => {
    await addWeight(null);
    await expect(
      ds.transaction((manager) =>
        assertNoLiveDependents(manager, Exam, examId, { code: 'EXAM_IN_USE', message: 'in use' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    // The weight pins its exam: the FK is NO ACTION, so a hard delete is refused too.
    await expect(q(`DELETE FROM "exams" WHERE id = $1`, [examId])).rejects.toThrow(
      /FK_ce3955eb303b44e6aaed4a822bb/,
    );
  });
});
