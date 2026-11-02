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
import { ReportDefinitionVersion } from './report-definition-version.entity';
import { ReportRun } from './report-run.entity';

/**
 * [8.15.9] "Keep today's copy": a stored result file for one run, dated by
 * `as_of`. The file lives in object storage under `storage_key`; the row only
 * points at it and at the published version it came from.
 */
@Entity('report_snapshots')
@Index(['tenant_id'])
export class ReportSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => ReportRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'run_id' })
  run: ReportRun;

  @Column({ type: 'uuid' })
  run_id: string;

  @ManyToOne(() => ReportDefinitionVersion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'definition_version_id' })
  definition_version: ReportDefinitionVersion;

  @Column({ type: 'uuid' })
  definition_version_id: string;

  @Column({ type: 'date' })
  as_of: string;

  @Column({ type: 'varchar', length: 160 })
  label: string;

  @Column({ type: 'text' })
  storage_key: string;

  @Column({ type: 'int', default: 0 })
  row_count: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  created_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
