import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { Teacher } from './teacher.entity';
import { Class } from './class.entity';
import { Subject } from './subject.entity';

/**
 * [83.1.2] Who coordinates which class, optionally for one subject (Epic 83).
 *
 * - `subject_id` NULL  → class coordinator: reads every subject of every section of the class.
 * - `subject_id` set   → subject coordinator: reads only that subject's marks in the class.
 *
 * Why its own table and not a `teacher_class_sections.assignment_type` (D2): the teacher-scope
 * SQL treats every non-SUBJECT tcs row as homeroom, and homeroom grants a read (and write) of
 * every subject. A coordinator row must widen reads only, so it lives apart and is read only
 * when a caller passes `includeCoordinated: true` to `TeacherScopeService` (D18).
 *
 * Class-level, never section-level (D3): the row covers every live section of the class, and the
 * class belongs to one academic year, so the year scope is the class's year.
 *
 * Uniqueness (D11): one row per (tenant, teacher, class, subject) with NULLs equal —
 * `UQ_coordinator_assignment ... NULLS NOT DISTINCT`, raw SQL in the
 * `CoordinatorAssignments` migration (TypeORM's `@Index` cannot express it, so it is not declared
 * here). A class may have several coordinators; a teacher may coordinate a class they teach.
 *
 * Deletes (D15): teacher, class and subject FKs CASCADE — an assignment is not a record, so it is
 * not in the delete-guard registry. `assigned_by_user_id` is SET NULL when the user goes (D30).
 */
@Entity('coordinator_assignments')
@Index('IDX_ca_tenant_teacher', ['tenant_id', 'teacher_id'])
@Index('IDX_ca_tenant_class', ['tenant_id', 'class_id'])
export class CoordinatorAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Teacher, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacher_id' })
  teacher: Teacher;

  @Column({ type: 'uuid' })
  teacher_id: string;

  @ManyToOne(() => Class, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @Column({ type: 'uuid' })
  class_id: string;

  @ManyToOne(() => Subject, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject | null;

  @Column({ type: 'uuid', nullable: true })
  subject_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by_user_id' })
  assigned_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  assigned_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
