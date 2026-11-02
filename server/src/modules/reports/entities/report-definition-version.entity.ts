import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { ReportDefinitionJson } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { ReportDefinition } from './report-definition.entity';

/**
 * [8.15.9] An immutable published snapshot of a report definition (D3).
 * A DB trigger rejects every UPDATE so a run or snapshot can always be
 * reproduced against exactly what was published. Deleting the parent is
 * RESTRICTed while versions exist.
 */
@Entity('report_definition_versions')
@Index(['tenant_id'])
@Index('UQ_report_definition_versions_definition_version', ['definition_id', 'version'], {
  unique: true,
})
export class ReportDefinitionVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => ReportDefinition, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'definition_id' })
  report_definition: ReportDefinition;

  @Column({ type: 'uuid' })
  definition_id: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'jsonb' })
  definition: ReportDefinitionJson;

  @Column({ type: 'int' })
  schema_version: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'published_by' })
  published_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  published_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  published_at: Date;
}
