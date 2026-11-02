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
import type { ExportFormat, ReportScheduleFrequency } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { ReportDefinition } from './report-definition.entity';
import { ReportRun } from './report-run.entity';

/**
 * [8.15.9] A recurring email-link delivery of one report (D15). `local_time`
 * is the school's wall-clock `HH:MM`; the delivery job converts it with the
 * tenant timezone. Recipients are roles, never free-text addresses.
 */
@Entity('report_schedules')
@Index(['tenant_id'])
export class ReportSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => ReportDefinition, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'definition_id' })
  report_definition: ReportDefinition;

  @Column({ type: 'uuid' })
  definition_id: string;

  @Column({ type: 'varchar', length: 20 })
  frequency: ReportScheduleFrequency;

  @Column({ type: 'smallint', nullable: true })
  day_of_week: number | null;

  @Column({ type: 'smallint', nullable: true })
  day_of_month: number | null;

  @Column({ type: 'varchar', length: 5 })
  local_time: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  params: Record<string, unknown>;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  recipient_roles: string[];

  @Column({ type: 'varchar', length: 10 })
  format: ExportFormat;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @ManyToOne(() => ReportRun, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'last_run_id' })
  last_run: ReportRun | null;

  @Column({ type: 'uuid', nullable: true })
  last_run_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  created_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
