import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';

/**
 * [36.1.1]/[36.2.1] Generic staff profile every staff `User`
 * (TEACHER/ADMIN/ACCOUNTANT/EXECUTIVE) gets — `employee_id`/`joining_date`
 * live here, not on the role-specific table, so attendance/leave (and any
 * future staff feature) can key off one row regardless of role. `Teacher`
 * keeps its own `employee_id` too (unchanged, unique per school) and points
 * at its `staff_profiles` row via `staff_profile_id`.
 *
 * Table created by migration `StaffAttendanceLeave1789800014000` — this
 * entity must match that schema exactly (see
 * `server/src/migrations/1789800014000-StaffAttendanceLeave.ts`).
 */
@Entity('staff_profiles')
@Index('UQ_staff_profiles_tenant_user', ['tenant_id', 'user_id'], { unique: true })
@Index('IDX_staff_profiles_user_id', ['user_id'])
@Index(['tenant_id'])
@Index(['tenant_id', 'employee_id'], { unique: true })
@Index('UQ_staff_profiles_tenant_card_no', ['tenant_id', 'card_no'], {
  unique: true,
  where: '"card_no" IS NOT NULL',
})
export class StaffProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 50 })
  employee_id: string;

  /** Attendance card number; unique per school when set (D9). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  card_no: string | null;

  @Column({ type: 'date', nullable: true })
  joining_date: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
