import { NotFoundException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { Exam } from './entities/exam.entity';

/**
 * [pr-fix #945] The exam-level lock every result-changing path shares.
 * `process`, `publish`, `reopen` and the mark-change recompute take it
 * FOR UPDATE and re-check `status` under it, so none of them can act on
 * a status another has just changed. Mark writes take it FOR SHARE
 * (`MarksService`): autosaves on different grids don't block each other,
 * but a publish can't commit while a mark write is mid-transaction.
 * Lock order is always exam, then grid (`lockGrid`); a final result is
 * locked before its source exams.
 *
 * A leaf file (imports only the entity) so `ResultsService`,
 * `FinalResultsService` and `ExamResultRecomputer` share it without
 * importing each other (#3409).
 */
export async function lockExam(
  manager: EntityManager,
  examId: string,
  tenantId: string,
  mode: 'pessimistic_write' | 'pessimistic_read' = 'pessimistic_write',
): Promise<Exam> {
  const exam = await manager.getRepository(Exam).findOne({
    where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    lock: { mode },
  });
  if (!exam) {
    throw new NotFoundException('Exam not found');
  }
  return exam;
}
