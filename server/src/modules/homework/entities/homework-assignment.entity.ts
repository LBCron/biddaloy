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
import { Homework } from './homework.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Student } from '../../students/entities/student.entity';
import { School } from '../../schools/entities/school.entity';
import { HomeworkAssignmentStatus } from '@biddaloy/shared';

/**
 * Who a `Homework` is assigned to: either a whole section or one student,
 * never both, never neither (D24) — enforced by the DB CHECK constraint
 * below (declared here for schema-drift visibility; the actual constraint
 * is created by the raw-SQL migration, same convention as
 * `TeacherClassSection`'s partial-unique-index note).
 *
 * Relations:
 * - @ManyToOne → Homework: the homework being assigned
 * - @ManyToOne → ClassSection (optional): whole-section assignment
 * - @ManyToOne → Student (optional): single-student assignment
 * - @ManyToOne → School: the tenant this assignment belongs to
 * - Referenced-by → HomeworkSubmission: the student's submission against
 *   this assignment
 */
@Entity('homework_assignments')
@Index(['tenant_id'])
// One ACTIVE row per (homework, target) (#3172); DEACTIVATED / SUPERSEDED rows never collide.
@Index('IDX_homework_assignments_active_section', ['homework_id', 'section_id'], {
  unique: true,
  where: `"status" = 'ACTIVE'`,
})
@Index('IDX_homework_assignments_active_student', ['homework_id', 'student_id'], {
  unique: true,
  where: `"status" = 'ACTIVE'`,
})
@Check(
  'CHK_homework_assignments_exactly_one_target',
  '(("section_id" IS NULL) <> ("student_id" IS NULL))',
)
export class HomeworkAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Homework, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'homework_id' })
  homework: Homework;

  @Column({ type: 'uuid' })
  homework_id: string;

  @ManyToOne(() => ClassSection, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection | null;

  @Column({ type: 'uuid', nullable: true })
  section_id: string | null;

  @ManyToOne(() => Student, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student | null;

  @Column({ type: 'uuid', nullable: true })
  student_id: string | null;

  @Column({ type: 'date' })
  assigned_date: string;

  @Column({ type: 'date' })
  due_date: string;

  @Column({
    type: 'enum',
    enum: HomeworkAssignmentStatus,
    default: HomeworkAssignmentStatus.ACTIVE,
  })
  status: HomeworkAssignmentStatus;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
