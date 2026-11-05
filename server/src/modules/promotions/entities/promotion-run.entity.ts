import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { PromotionRunStatus, PlacementAlgorithm } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { FinalResult } from '../../final-results/entities/final-result.entity';
import { Class } from '../../academics/entities/class.entity';

/**
 * [788] One end-of-year promotion attempt for a source class: which exams
 * feed the decision, which placement algorithm assigns next-year sections,
 * and whether it has been committed. `DRAFT` runs are re-runnable and
 * re-computable; `COMMITTED` is final and moves students (D16).
 *
 * No `deleted_at` — unlike most tenant tables, drafts are hard-deleted
 * rather than soft-deleted (D24): a draft carries no history worth keeping
 * once discarded.
 *
 * `target_class_id` is nullable — `null` means this run graduates the
 * whole source class out of the school rather than promoting it into a
 * next class (D13).
 *
 * Only one `COMMITTED` run may exist per `(tenant_id, source_class_id,
 * target_academic_year_id)` — enforced by a partial unique index (D15),
 * mirrored below via `@Index` with a `where` clause.
 *
 * Relations:
 * - @ManyToOne → School: tenant this run belongs to
 * - @ManyToOne → Class: the source class being promoted
 * - Referenced-by → PromotionEntry: this run's per-student decisions
 */
@Entity('promotion_runs')
@Check(
  'CHK_promotion_runs_one_merit_source',
  `"final_result_id" IS NULL OR cardinality("exam_ids") = 0`,
)
@Index(['tenant_id'])
@Index(['tenant_id', 'source_class_id', 'target_academic_year_id'], {
  unique: true,
  where: `"status" = 'COMMITTED'`,
})
export class PromotionRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Class, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_class_id' })
  source_class: Class;

  @Column({ type: 'uuid' })
  source_class_id: string;

  @Column({ type: 'uuid' })
  source_academic_year_id: string;

  @Column({ type: 'uuid' })
  target_academic_year_id: string;

  /** `null` = this run graduates the source class out of the school (D13). */
  @Column({ type: 'uuid', nullable: true })
  target_class_id: string | null;

  @Column({ type: 'uuid', array: true })
  exam_ids: string[];

  /**
   * [70.3.3] Merit source: a PUBLISHED final result of the source class (its weighted GPA and
   * total decide merit order) instead of the plain mean of `exam_ids`. Exactly one of the two
   * is set; `exam_ids` is `[]` here. NO ACTION: a final that a run uses cannot be hard-deleted.
   */
  @ManyToOne(() => FinalResult, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'final_result_id' })
  final_result: FinalResult | null;

  @Column({ type: 'uuid', nullable: true })
  final_result_id: string | null;

  @Column({ type: 'varchar', length: 30 })
  algorithm: PlacementAlgorithm;

  @Column({ type: 'varchar', length: 20, default: PromotionRunStatus.DRAFT })
  status: PromotionRunStatus;

  @Column({ type: 'timestamptz' })
  refreshed_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  committed_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  committed_by_user_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  approved_by_user_id: string | null;

  @Column({ type: 'int', default: 0 })
  override_count: number;

  @Column({ type: 'uuid' })
  created_by_user_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
