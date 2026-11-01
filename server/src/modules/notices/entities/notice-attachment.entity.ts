import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Notice } from './notice.entity';

/** [53.1.02] A file on a notice. mime/size CHECKs live in the migration. */
@Index('IDX_notice_attachments_notice_id', ['notice_id'])
@Index('IDX_notice_attachments_tenant_id', ['tenant_id'])
@Check(
  'CHK_notice_attachments_mime',
  `"mime_type" IN ('application/pdf','image/png','image/jpeg','image/webp')`,
)
@Check('CHK_notice_attachments_size', `"size_bytes" BETWEEN 1 AND 5242880`)
@Entity('notice_attachments')
export class NoticeAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_notice_attachments_tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  notice_id: string;

  @ManyToOne(() => Notice, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'notice_id', foreignKeyConstraintName: 'FK_notice_attachments_notice_id' })
  notice: Notice;

  @Column({ type: 'varchar', length: 500 })
  storage_key: string;

  @Column({ type: 'varchar', length: 50 })
  mime_type: string;

  @Column({ type: 'int' })
  size_bytes: number;

  @Column({ type: 'varchar', length: 255 })
  original_name: string;

  @Column({ type: 'smallint', default: 0 })
  sort: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
