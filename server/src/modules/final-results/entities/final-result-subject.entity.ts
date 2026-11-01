import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { FinalResultRow } from './final-result-row.entity';

/**
 * [70.1.2] One subject's line within a `FinalResultRow` — the final-result twin of
 * `ResultSubject`. `is_fourth_subject` records that the subject counted as the
 * student's fourth/optional subject. Soft-deleted in lockstep with its row.
 *
 * Relations:
 * - @ManyToOne → School, FinalResultRow, Subject
 */
@Entity('final_result_subjects')
@Index(['tenant_id', 'final_result_row_id'])
@Index(['final_result_row_id', 'subject_id'], { unique: true, where: '"deleted_at" IS NULL' })
export class FinalResultSubject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => FinalResultRow, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'final_result_row_id' })
  final_result_row: FinalResultRow;

  @Column({ type: 'uuid' })
  final_result_row_id: string;

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  @Column({ type: 'numeric', precision: 6, scale: 2 })
  obtained: string;

  @Column({ type: 'varchar', length: 10 })
  grade: string;

  @Column({ type: 'numeric', precision: 4, scale: 2 })
  gpa: string;

  @Column({ type: 'boolean', default: false })
  is_fail: boolean;

  @Column({ type: 'boolean', default: false })
  is_fourth_subject: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
