import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
  Unique,
} from 'typeorm';
import { NoticeRecipientKind } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { Notice } from './notice.entity';
import { User } from '../../users/entities/user.entity';
import { Student } from '../../students/entities/student.entity';
import { Guardian } from '../../students/entities/guardian.entity';
import { CommunicationLog } from '../../communications/entities/communication-log.entity';

/**
 * [53.1.02] One delivery row per person: STAFF (user), STUDENT, or GUARDIAN
 * (guardian + the student they hear about). Kind-vs-target CHECK, partial
 * uniques and the user/student/guardian/communication-log FKs live in the
 * migration. Only the hash of the link token is stored.
 */
@Index('UQ_notice_recipients_staff', ['notice_id', 'user_id'], {
  unique: true,
  where: `"kind" = 'STAFF'`,
})
@Index('UQ_notice_recipients_student', ['notice_id', 'student_id'], {
  unique: true,
  where: `"kind" = 'STUDENT'`,
})
@Index('UQ_notice_recipients_guardian', ['notice_id', 'guardian_id', 'student_id'], {
  unique: true,
  where: `"kind" = 'GUARDIAN'`,
})
@Index('IDX_notice_recipients_tenant_user', ['tenant_id', 'user_id'])
@Unique('UQ_notice_recipients_link_token_hash', ['link_token_hash'])
@Check('CHK_notice_recipients_kind', `"kind" IN ('STAFF','STUDENT','GUARDIAN')`)
@Check(
  'CHK_notice_recipients_target',
  `("kind" = 'STAFF' AND "user_id" IS NOT NULL) OR ("kind" = 'STUDENT' AND "student_id" IS NOT NULL) OR ("kind" = 'GUARDIAN' AND "guardian_id" IS NOT NULL AND "student_id" IS NOT NULL)`,
)
@Entity('notice_recipients')
export class NoticeRecipient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_notice_recipients_tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  notice_id: string;

  @ManyToOne(() => Notice, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'notice_id', foreignKeyConstraintName: 'FK_notice_recipients_notice_id' })
  notice: Notice;

  @Column({ type: 'varchar', length: 10 })
  kind: NoticeRecipientKind;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_notice_recipients_user_id' })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  student_id: string | null;

  @ManyToOne(() => Student, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_id', foreignKeyConstraintName: 'FK_notice_recipients_student_id' })
  student: Student | null;

  @Column({ type: 'uuid', nullable: true })
  guardian_id: string | null;

  @ManyToOne(() => Guardian, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'guardian_id', foreignKeyConstraintName: 'FK_notice_recipients_guardian_id' })
  guardian: Guardian | null;

  @Column({ type: 'timestamptz', nullable: true })
  seen_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  link_token_hash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  link_opened_at: Date | null;

  @Column({ type: 'boolean', default: true })
  sms_wanted: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  sms_sent_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  communication_log_id: string | null;

  @ManyToOne(() => CommunicationLog, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'communication_log_id',
    foreignKeyConstraintName: 'FK_notice_recipients_communication_log_id',
  })
  communication_log: CommunicationLog | null;

  @Column({ type: 'timestamptz', nullable: true })
  pushed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
