import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AttendanceImportHistoryRow } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * One uploaded attendance sheet and what it did, row by row (Epic 76, D11).
 * Tenant-scoped, no soft delete. Not in a workbook backup: registers are not either.
 *
 * `supersedes_import_id` points at the earlier import this one re-did (SET NULL if removed).
 */
@Entity('attendance_imports')
@Index('IDX_attendance_imports_tenant_created', ['tenant_id', 'created_at'])
export class AttendanceImport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploaded_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  uploaded_by_user_id: string | null;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'jsonb' })
  rows: AttendanceImportHistoryRow[];

  @Column({ type: 'int', default: 0 })
  count_new: number;

  @Column({ type: 'int', default: 0 })
  count_changed: number;

  @Column({ type: 'int', default: 0 })
  count_unchanged: number;

  @Column({ type: 'int', default: 0 })
  count_error: number;

  @ManyToOne(() => AttendanceImport, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'supersedes_import_id' })
  supersedes: AttendanceImport | null;

  @Column({ type: 'uuid', nullable: true })
  supersedes_import_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
