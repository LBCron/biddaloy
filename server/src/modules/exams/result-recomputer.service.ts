import { ConflictException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ExamStatus, FinalResultStatus } from '@biddaloy/shared';
import { RecomputeActor, ResultRecomputer } from '../grading/recompute.service';
import { FinalResultsService } from '../final-results/final-results.service';
import { lockExam } from './exam-lock';
import { ResultsService } from './results.service';

interface ExamUsingScale {
  id: string;
  name: string;
  status: ExamStatus;
}

/**
 * [68.2.06] The real `ResultRecomputer` (it replaces the grading module's
 * no-op stub): when a grading scale's bands change, every PROCESSED exam
 * whose results were graded against that scale is recomputed inside the
 * band edit's own transaction. PUBLISHED results are frozen (D16), so a
 * scale used by one is refused instead.
 */
@Injectable()
export class ExamResultRecomputer implements ResultRecomputer {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resultsService: ResultsService,
    // Lazy: FinalResultsModule imports ExamsModule, so injecting its service
    // here would be a module cycle (same reason `ResultsService.reopen` does this).
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Live final results whose rows were graded against the scale (tenant-scoped). */
  private finalsUsingScale(
    manager: EntityManager,
    tenantId: string,
    scaleId: string,
  ): Promise<Array<{ id: string; name: string; status: FinalResultStatus }>> {
    return manager.query(
      `SELECT DISTINCT f.id, c.name, f.status
         FROM final_result_rows r
         JOIN final_results f ON f.id = r.final_result_id AND f.tenant_id = $1 AND f.deleted_at IS NULL
         JOIN classes c ON c.id = f.class_id AND c.tenant_id = $1
        WHERE r.tenant_id = $1 AND r.grading_scale_id = $2 AND r.deleted_at IS NULL
        ORDER BY f.id`,
      [tenantId, scaleId],
    );
  }

  /** Exams with a live result graded against the scale (tenant-scoped). */
  private examsUsingScale(
    manager: EntityManager,
    tenantId: string,
    scaleId: string,
  ): Promise<ExamUsingScale[]> {
    return manager.query(
      `SELECT DISTINCT e.id, e.name, e.status
         FROM results r
         JOIN exams e ON e.id = r.exam_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
        WHERE r.tenant_id = $1 AND r.grading_scale_id = $2 AND r.deleted_at IS NULL`,
      [tenantId, scaleId],
    );
  }

  async countAffected(
    tenantId: string,
    scaleId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<number> {
    const rows: Array<{ count: string }> = await manager.query(
      `SELECT COUNT(*)::text AS count
         FROM results r
         JOIN exams e ON e.id = r.exam_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
        WHERE r.tenant_id = $1 AND r.grading_scale_id = $2 AND r.deleted_at IS NULL
          AND e.status = $3`,
      [tenantId, scaleId, ExamStatus.PROCESSED],
    );
    // Same unit as the exams: one per student row a confirm would regrade.
    const finalRows: Array<{ count: string }> = await manager.query(
      `SELECT COUNT(*)::text AS count
         FROM final_result_rows r
         JOIN final_results f ON f.id = r.final_result_id AND f.tenant_id = $1 AND f.deleted_at IS NULL
        WHERE r.tenant_id = $1 AND r.grading_scale_id = $2 AND r.deleted_at IS NULL
          AND f.status = $3`,
      [tenantId, scaleId, FinalResultStatus.PROCESSED],
    );
    return Number(rows[0]?.count ?? 0) + Number(finalRows[0]?.count ?? 0);
  }

  async findPublishedExams(
    tenantId: string,
    scaleId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Array<{ id: string; name: string }>> {
    const exams = await this.examsUsingScale(manager, tenantId, scaleId);
    const finals = await this.finalsUsingScale(manager, tenantId, scaleId);
    return [
      ...exams.filter((e) => e.status === ExamStatus.PUBLISHED),
      ...finals.filter((f) => f.status === FinalResultStatus.PUBLISHED),
    ].map(({ id, name }) => ({ id, name }));
  }

  async recompute(
    tenantId: string,
    scaleId: string,
    manager: EntityManager,
    actor: RecomputeActor = { userId: null, context: { ip: null, userAgent: null } },
  ): Promise<number> {
    // Lock every exam first (id order, so two edits can't deadlock), then
    // read status under the lock: a publish committing after an unlocked
    // read would otherwise slip a band change under frozen results (D16).
    // Finals first, in id order: build/publish lock final then exam, so a scale edit must too.
    const finals = await this.finalsUsingScale(manager, tenantId, scaleId);
    const lockedStatus: Array<{ id: string; status: FinalResultStatus }> = finals.length
      ? await manager.query(
          `SELECT id, status FROM final_results WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
          [tenantId, finals.map((f) => f.id)],
        )
      : [];
    // Status read under the lock, not from the earlier unlocked query.
    // A final soft-deleted since the unlocked read has no lock row: skip it.
    const lockedFinals = finals.flatMap((f) => {
      const row = lockedStatus.find((l) => l.id === f.id);
      return row ? [{ ...f, status: row.status }] : [];
    });
    const found = await this.examsUsingScale(manager, tenantId, scaleId);
    const exams: ExamUsingScale[] = [];
    for (const { id } of [...found].sort((a, b) => a.id.localeCompare(b.id))) {
      const locked = await lockExam(manager, id, tenantId);
      exams.push({ id, name: locked.name, status: locked.status });
    }
    const published = exams.filter((e) => e.status === ExamStatus.PUBLISHED);
    const publishedFinals = lockedFinals.filter((f) => f.status === FinalResultStatus.PUBLISHED);
    if (published.length > 0 || publishedFinals.length > 0) {
      // D16: a scale edit is refused while published results use it. The
      // throw rolls back the band change (RecomputeService.confirm, D6).
      throw new ConflictException({
        message: 'Published results use this grading scale. Reopen them first.',
        details: {
          code: 'SCALE_IN_PUBLISHED_RESULTS',
          exams: published.map(({ id, name }) => ({ id, name })),
          // Finals are listed apart: their ids are not exam ids (name = the class).
          finals: publishedFinals.map(({ id, name }) => ({ id, name })),
        },
      });
    }
    let total = 0;
    for (const exam of exams.filter((e) => e.status === ExamStatus.PROCESSED)) {
      total += await this.resultsService.recomputeProcessedExam(
        manager,
        exam.id,
        tenantId,
        actor.userId,
        actor.context,
      );
    }
    // A PROCESSED final pinned to this scale is rebuilt from the recomputed exams, so its
    // rows never disagree with the new bands. Stays PROCESSED, never published.
    const finalsService = lockedFinals.length
      ? this.moduleRef.get(FinalResultsService, { strict: false })
      : null;
    for (const f of lockedFinals.filter((x) => x.status === FinalResultStatus.PROCESSED)) {
      // Rebuilt against THIS scale (the one its rows pin), not whatever resolveScale picks now.
      total += await finalsService!.recompute(
        manager,
        f.id,
        tenantId,
        actor.userId,
        actor.context,
        scaleId,
      );
    }
    return total;
  }
}
