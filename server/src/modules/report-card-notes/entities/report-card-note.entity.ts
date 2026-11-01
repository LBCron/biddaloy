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
import type { ConductGrade } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { Student } from '../../students/entities/student.entity';
import { Exam } from '../../exams/entities/exam.entity';
import { User } from '../../users/entities/user.entity';
import { FinalResult } from '../../final-results/entities/final-result.entity';

/**
 * [70.1.2] A student's teacher remark and conduct grades printed on a report card.
 * It belongs to exactly one target: an `Exam` (single-exam card) or a
 * `FinalResult` (final card) — the CHECK `num_nonnulls(exam_id, final_result_id) = 1`
 * rejects both and neither.
 *
 * `conduct` maps a conduct-item key (tenant `exams.conductItems`, D30) to a grade.
 *
 * Uniqueness (student_id, exam_id, final_result_id) is `NULLS NOT DISTINCT`, raw SQL
 * in the `FinalResultsAndReportCardNotes` migration — TypeORM's `@Index` cannot
 * express it, so it is not declared here.
 *
 * Relations:
 * - @ManyToOne → School, Student (CASCADE), Exam / FinalResult (optional, CASCADE)
 * - @ManyToOne → User (optional): who last saved it (SET NULL)
 */
@Entity('report_card_notes')
@Index('IDX_rcn_tenant_final_result', ['tenant_id', 'final_result_id'])
@Index('IDX_rcn_tenant_exam', ['tenant_id', 'exam_id'])
@Check('CHK_report_card_notes_one_target', `num_nonnulls("exam_id", "final_result_id") = 1`)
export class ReportCardNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => Exam, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam | null;

  @Column({ type: 'uuid', nullable: true })
  exam_id: string | null;

  @ManyToOne(() => FinalResult, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'final_result_id' })
  final_result: FinalResult | null;

  @Column({ type: 'uuid', nullable: true })
  final_result_id: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  remark: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  conduct: Record<string, ConductGrade>;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_user_id' })
  updated_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  updated_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
