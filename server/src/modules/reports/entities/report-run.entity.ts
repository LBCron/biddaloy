import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { ExportFormat, ReportRunKind, ReportRunStatus } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { ReportDefinitionVersion } from './report-definition-version.entity';

/**
 * [8.15.9] One row per run or export (D8, D24). Carries no row data — only
 * what was asked, how long it took and where a queued file lives. `helpful`
 * and `feedback_comment` are the one-tap "was this useful?" answer (D24).
 * `definition_version_id` is null for coded reports and list exports.
 */
@Entity('report_runs')
@Index('IDX_report_runs_tenant_created', ['tenant_id', 'created_at'])
export class ReportRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => ReportDefinitionVersion, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'definition_version_id' })
  definition_version: ReportDefinitionVersion | null;

  @Column({ type: 'uuid', nullable: true })
  definition_version_id: string | null;

  /** Coded source (`students-list`, `payments-list`, ...) when there is no definition. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  source_key: string | null;

  @Column({ type: 'varchar', length: 20 })
  kind: ReportRunKind;

  @Column({ type: 'varchar', length: 20 })
  status: ReportRunStatus;

  @Column({ type: 'varchar', length: 10, nullable: true })
  format: ExportFormat | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  params: Record<string, unknown>;

  @Column({ type: 'int', default: 0 })
  row_count: number;

  @Column({ type: 'int', default: 0 })
  duration_ms: number;

  @Column({ type: 'text', nullable: true })
  storage_key: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  error_code: string | null;

  @Column({ type: 'boolean', nullable: true })
  helpful: boolean | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  feedback_comment: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  feedback_at: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'run_by' })
  run_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  run_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
