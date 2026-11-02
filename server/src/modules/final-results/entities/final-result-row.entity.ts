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
import { School } from '../../schools/entities/school.entity';
import { Student } from '../../students/entities/student.entity';
import { GradingScale } from '../../grading/entities/grading-scale.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { FinalResult } from './final-result.entity';

/**
 * [70.1.2] One student's computed row in a `FinalResult` — the final-result twin of
 * `Result` (exams/entities/result.entity.ts), keyed by `final_result_id` instead of
 * `exam_id`. The same pinning applies: `grading_scale_id` + `grading_scale_revision`
 * + `rule_version` record exactly what produced the row, so a later scale edit
 * cannot silently change a printed card.
 *
 * `working_days` / `present_days` are the attendance totals printed on the report
 * card (null = not entered).
 *
 * Soft-deletable: a recompute soft-deletes the old row and inserts a new one.
 *
 * Relations:
 * - @ManyToOne → School, FinalResult, Student
 * - @ManyToOne → GradingScale: the scale graded against (NO ACTION)
 * - @ManyToOne → ClassSection (optional): section snapshot at compute (SET NULL)
 * - Referenced-by → FinalResultSubject
 */
@Entity('final_result_rows')
@Check(
  'CHK_final_result_rows_days',
  `("working_days" IS NULL OR "working_days" >= 0) AND ("present_days" IS NULL OR "present_days" >= 0) AND ("working_days" IS NULL OR "present_days" IS NULL OR "present_days" <= "working_days")`,
)
@Index(['tenant_id', 'final_result_id'])
@Index(['final_result_id', 'student_id'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['final_result_id', 'section_id'])
export class FinalResultRow {
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

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @Column({ type: 'numeric', precision: 8, scale: 2 })
  total_marks: string;

  @Column({ type: 'numeric', precision: 4, scale: 2 })
  gpa: string;

  @Column({ type: 'varchar', length: 10 })
  grade: string;

  @Column({ type: 'int', nullable: true })
  position: number | null;

  /** Section the student was in at compute (snapshot). SET NULL on section delete. */
  @ManyToOne(() => ClassSection, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection | null;

  @Column({ type: 'uuid', nullable: true })
  section_id: string | null;

  /** Merit rank within `(final_result_id, section_id)`; null for fails or no section. */
  @Column({ type: 'int', nullable: true })
  section_position: number | null;

  @Column({ type: 'boolean', default: false })
  is_fail: boolean;

  // NO ACTION, not RESTRICT — see `Result.grading_scale`.
  @ManyToOne(() => GradingScale, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'grading_scale_id' })
  grading_scale: GradingScale;

  @Column({ type: 'uuid' })
  grading_scale_id: string;

  @Column({ type: 'int' })
  grading_scale_revision: number;

  @Column({ type: 'varchar', length: 50 })
  rule_version: string;

  @Column({ type: 'timestamptz' })
  computed_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'int', nullable: true })
  working_days: number | null;

  @Column({ type: 'int', nullable: true })
  present_days: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
