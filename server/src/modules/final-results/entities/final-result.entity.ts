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
  Check,
} from 'typeorm';
import { FinalResultMode, FinalResultRounding, FinalResultStatus } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';

/**
 * [70.1.2] A class's cross-exam final result for one academic year (Epic 70).
 * It combines several `Exam`s of that class into one result per student, either
 * by weighted shares (`WEIGHTED`) or by taking the best N exams (`BEST_OF`).
 *
 * - One live final result per (tenant, class, year) (D4) — partial unique index,
 *   so a soft-deleted one does not block a new one.
 * - `status` is the same DRAFT → PROCESSED → PUBLISHED lifecycle as `Exam` (D5).
 * - `best_of_count` only means something for `BEST_OF` — the CHECK keeps a
 *   WEIGHTED row from carrying a stale count.
 * - Weights live in `FinalResultWeight`, per-student results in `FinalResultRow`.
 *
 * Relations:
 * - @ManyToOne → School: tenant this belongs to
 * - @ManyToOne → Class, AcademicYear: what it is the final result of
 * - Referenced-by → FinalResultWeight, FinalResultRow
 */
@Entity('final_results')
@Index(['tenant_id', 'class_id', 'academic_year_id'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Check(
  'CHK_final_results_best_of_mode',
  `"best_of_count" IS NULL OR ("mode" = 'BEST_OF' AND "best_of_count" >= 1)`,
)
export class FinalResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Class, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @Column({ type: 'uuid' })
  class_id: string;

  @ManyToOne(() => AcademicYear, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @Column({ type: 'enum', enum: FinalResultStatus, default: FinalResultStatus.DRAFT })
  status: FinalResultStatus;

  @Column({ type: 'enum', enum: FinalResultMode, default: FinalResultMode.WEIGHTED })
  mode: FinalResultMode;

  @Column({ type: 'int', nullable: true })
  best_of_count: number | null;

  @Column({ type: 'enum', enum: FinalResultRounding, default: FinalResultRounding.WHOLE })
  rounding: FinalResultRounding;

  @Column({ type: 'boolean', default: false })
  fail_if_any_exam_fails: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
