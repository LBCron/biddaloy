import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Job-info fields for one staff member. Keyed by `user_id`, NOT
 * `teacher_id` (23.1 D1) — HR applies to any staff role, not just teachers.
 * Exactly one row per user PER TENANT, enforced by the unique index on
 * `(tenant_id, user_id)` — not `user_id` alone, since the same user can be
 * staff in more than one tenant/branch.
 */
@Entity('staff_hr_records')
@Index(['tenant_id'])
@Index(['tenant_id', 'user_id'], { unique: true })
export class StaffHrRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  index_no: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  salary_code: string | null;

  @Column({ type: 'date', nullable: true })
  mpo_date: Date | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  salary_scale: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  blood_group: string | null;

  /** [32.1.2] Bangla name for printed ID cards (Epic 32 D15). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  name_bn: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  religion: string | null;

  /** [76.2.06] Not a column: the attendance card number read from the linked
   * `staff_profiles` row (same tenant, same user), `null` when unset or no
   * profile. Filled by `StaffHrService` on every response. */
  card_no: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
