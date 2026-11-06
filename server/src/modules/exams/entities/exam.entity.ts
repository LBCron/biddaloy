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
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { AcademicTerm } from '../../calendar/entities/academic-term.entity';
import { ExamKind, ExamStatus } from '@biddaloy/shared';

/**
 * [19.2.1] One exam sitting for one class in one academic year — e.g.
 * "First Term Exam" for Class 6, 2026. `kind` (TERM/MONTHLY/MODEL/OTHER)
 * carries no behaviour in this epic (D19) — it is a label only. Nobody
 * should branch on it; if a future ticket needs kind-specific behaviour,
 * that is a deliberate new decision, not an extension of this field.
 *
 * `status` is the D12 lifecycle: DRAFT → PROCESSED → PUBLISHED. Reopening
 * a PUBLISHED exam back to PROCESSED is gated by `@RequireApproval` plus
 * an audit record (19.5.1) — not enforced here.
 *
 * Relations:
 * - @ManyToOne → School: tenant this exam belongs to
 * - @ManyToOne → AcademicYear: year the exam is held in
 * - @ManyToOne → Class: the class sitting the exam
 * - @ManyToOne → AcademicTerm (optional): term the exam falls in
 * - Referenced-by → ExamComponent, Mark, MarkGrid, Result: this exam's
 *   subject components, entered marks, per-section entry grids, and
 *   computed results
 */
@Entity('exams')
@Index(['tenant_id', 'academic_year_id', 'class_id'])
@Index(['tenant_id', 'academic_year_id', 'class_id', 'name'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class Exam {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AcademicYear, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @ManyToOne(() => Class, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @Column({ type: 'uuid' })
  class_id: string;

  @ManyToOne(() => AcademicTerm, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'academic_term_id' })
  academic_term: AcademicTerm | null;

  @Column({ type: 'uuid', nullable: true })
  academic_term_id: string | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Label only — see class docstring. No behaviour keys off this. */
  @Column({ type: 'enum', enum: ExamKind })
  kind: ExamKind;

  @Column({ type: 'enum', enum: ExamStatus, default: ExamStatus.DRAFT })
  status: ExamStatus;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  // [40.1.03] public-website results; null = not published there
  @Column({ type: 'timestamptz', nullable: true })
  website_published_at: Date | null;

  @Column({ type: 'boolean', default: true })
  website_show_names: boolean;

  // (8.10.7 D40) last day for mark entry; null = not set
  @Column({ type: 'date', nullable: true })
  mark_entry_deadline: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
