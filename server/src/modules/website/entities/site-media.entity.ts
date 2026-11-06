import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/** [40.1.03] An uploaded website picture. Delete guards: see `school-site.entity.ts` header. */
@Unique('UQ_site_media_storage_key', ['storage_key'])
@Unique('UQ_site_media_tenant_hash', ['tenant_id', 'hash'])
@Check('CHK_site_media_bytes', `"bytes" > 0`)
@Entity('site_media')
export class SiteMedia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_site_media_tenant_id' })
  tenant: School;

  @Column({ type: 'varchar', length: 20 })
  slot: string;

  @Column({ type: 'varchar', length: 255 })
  storage_key: string;

  @Column({ type: 'char', length: 64 })
  hash: string;

  @Column({ type: 'int' })
  width: number;

  @Column({ type: 'int' })
  height: number;

  @Column({ type: 'int' })
  bytes: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
