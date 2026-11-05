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
import { School } from '../../schools/entities/school.entity';
import { Exam } from '../../exams/entities/exam.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { FinalResult } from './final-result.entity';

/**
 * [70.1.2] One exam's share in a `FinalResult`. `subject_id` NULL means the share
 * applies to the whole exam; set, it applies to that subject only (per-subject
 * shares, D7).
 *
 * Uniqueness (final_result_id, exam_id, subject_id) is `NULLS NOT DISTINCT`
 * (Epic 33 precedent), raw SQL in the `FinalResultsAndReportCardNotes` migration —
 * TypeORM's `@Index` cannot express it, so it is not declared here.
 *
 * Hard-deleted and replaced as a set when the weights are edited, so no
 * `deleted_at`. `exam_id` is NO ACTION: an exam used in a final result cannot be
 * hard-deleted from under it (the exam delete guard refuses first).
 *
 * Relations:
 * - @ManyToOne → School, FinalResult (CASCADE), Exam, Subject (optional)
 */
@Entity('final_result_weights')
@Index('IDX_frw_tenant_final_result', ['tenant_id', 'final_result_id'])
@Index('IDX_frw_exam', ['exam_id'])
@Check('CHK_final_result_weights_share_range', `"share_percent" >= 0 AND "share_percent" <= 100`)
export class FinalResultWeight {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => FinalResult, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'final_result_id' })
  final_result: FinalResult;

  @Column({ type: 'uuid' })
  final_result_id: string;

  // NO ACTION, not RESTRICT: same reasoning as `Result.grading_scale`.
  @ManyToOne(() => Exam, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;

  @Column({ type: 'uuid' })
  exam_id: string;

  @ManyToOne(() => Subject, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject | null;

  @Column({ type: 'uuid', nullable: true })
  subject_id: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  share_percent: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
