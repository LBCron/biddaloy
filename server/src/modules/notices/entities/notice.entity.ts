import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
  Unique,
} from 'typeorm';
import { NoticeSmsStatus, NoticeStatus } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [53.1.02] A notice-board post. Tenant-scoped; CHECKs, indexes and the
 * unique `public_token_hash` live in the migration. Only token hashes are stored.
 */
@Index('IDX_notices_tenant_status_published', ['tenant_id', 'status', 'published_at'])
@Index('IDX_notices_tenant_author', ['tenant_id', 'author_user_id'])
@Unique('UQ_notices_public_token_hash', ['public_token_hash'])
@Check('CHK_notices_body_len', `char_length("body") <= 5000`)
@Check('CHK_notices_status', `"status" IN ('DRAFT','PUBLISHED','WITHDRAWN')`)
@Check('CHK_notices_sms_status', `"sms_status" IN ('NONE','PENDING','APPROVED','DECLINED')`)
@Check('CHK_notices_published_at', `"status" = 'DRAFT' OR "published_at" IS NOT NULL`)
@Check('CHK_notices_withdrawn_at', `"status" <> 'WITHDRAWN' OR "withdrawn_at" IS NOT NULL`)
@Entity('notices')
export class Notice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_notices_tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  author_user_id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_user_id', foreignKeyConstraintName: 'FK_notices_author_user_id' })
  author: User;

  @Column({ type: 'varchar', length: 140 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'varchar', length: 10, default: NoticeStatus.DRAFT })
  status: NoticeStatus;

  @Column({ type: 'boolean', default: false })
  important: boolean;

  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @Column({ type: 'boolean', default: false })
  is_public: boolean;

  // [40.1.03] pinned on the public website
  @Column({ type: 'boolean', default: false })
  pinned_on_website: boolean;

  @Column({ type: 'date', nullable: true })
  expires_on: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  edited_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  withdrawn_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  withdrawn_by_user_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  public_token_hash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  public_token_created_at: Date | null;

  @Column({ type: 'varchar', length: 10, default: NoticeSmsStatus.NONE })
  sms_status: NoticeSmsStatus;

  @Column({ type: 'uuid', nullable: true })
  sms_requested_by_user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sms_requested_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  sms_decided_by_user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sms_decided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  alert_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  sms_task_alert_id: string | null;

  @Column({ type: 'int', default: 0 })
  recipient_count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
