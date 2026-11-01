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
import { Student } from '../../students/entities/student.entity';
import { Guardian } from '../../students/entities/guardian.entity';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';
import { ReminderBatch } from './reminder-batch.entity';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';

/**
 * `medium = 'PUSH'` is deliberately NOT added to the shared
 * `CommunicationMedium` enum (`@biddaloy/shared`) — that enum also backs
 * `guardian.preferred_communication`, and a guardian can never *choose*
 * push as a preferred channel (it's a same-origin browser mechanism, not
 * something dial-able like SMS/email). PUSH exists only as an outcome this
 * table can record: the automated dispatcher (#555, see
 * `worker/communications.processor.ts`) writes it when a routine
 * notification was delivered via a guardian's linked user's push
 * subscriptions instead of their preferred channel. Scoping the value to
 * this column's own DB enum (`communication_logs_medium_enum`) keeps every
 * other `CommunicationMedium` column unaffected.
 */
export const PUSH_MEDIUM = 'PUSH' as const;
export type CommunicationLogMedium = CommunicationMedium | typeof PUSH_MEDIUM;

/**
 * Audit trail for every message sent through the system.
 *
 * Records all outbound communications (SMS, WhatsApp, email, phone call)
 * sent to guardians, students, or staff. Used for delivery tracking,
 * debugging failed sends, and compliance. Each log captures the message
 * content, recipient, delivery status, and who triggered it.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this log belongs to. Stored directly
 *   (not derived from student/guardian) because a freeform-recipient send
 *   has neither — deriving tenant scoping from an optional relation would
 *   leave those rows readable by any tenant.
 * - @ManyToOne → Student (optional): the student this message is about
 * - @ManyToOne → Guardian (optional): the guardian who received it
 * - @ManyToOne → User (sent_by): the staff member who sent it (or null for automated)
 * - @ManyToOne → ReminderBatch (optional): the bulk campaign that produced it
 */
@Entity('communication_logs')
@Index(['tenant_id'])
@Index(['reminder_batch_id'])
@Index(['tenant_id', 'status', 'created_at'])
export class CommunicationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'enum', enum: [...Object.values(CommunicationMedium), PUSH_MEDIUM] })
  medium: CommunicationLogMedium;

  @Column({ type: 'varchar', length: 255 })
  recipient_address: string;

  @Column({ type: 'varchar', length: 100 })
  recipient_name: string;

  @Column({ type: 'text' })
  message_body: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  subject: string | null;

  @Column({ type: 'enum', enum: CommunicationStatus, default: CommunicationStatus.QUEUED })
  status: CommunicationStatus;

  @Column({ type: 'enum', enum: CommunicationTrigger, default: CommunicationTrigger.MANUAL })
  trigger: CommunicationTrigger;

  @ManyToOne(() => Student, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'student_id' })
  student: Student | null;

  @Column({ type: 'uuid', nullable: true })
  student_id: string | null;

  @ManyToOne(() => Guardian, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'guardian_id' })
  guardian: Guardian | null;

  @Column({ type: 'uuid', nullable: true })
  guardian_id: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'sent_by_user_id' })
  sent_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  sent_by_user_id: string | null;

  // Null for one-off sends. SET NULL on delete rather than CASCADE — the log
  // is an audit record and outlives the campaign that produced it.
  @ManyToOne(() => ReminderBatch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reminder_batch_id' })
  reminder_batch: ReminderBatch | null;

  @Column({ type: 'uuid', nullable: true })
  reminder_batch_id: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  provider_message_id: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  /** [16.3.4] Idempotency key set only by automated dispatchers that must
   * survive a replayed event (e.g. `fees.generated`) without double-sending
   * — `${eventName}:${entityId}:${guardianId}` today. Null for manual sends
   * and bulk-reminder batches, which already dedupe another way. Unique per
   * tenant when set (see this column's migration for why a partial index). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  reference_key: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

/** The vendor took the message: SENT, or DELIVERED / READ written later by Check status (D23). */
export const ACCEPTED_STATUSES: readonly string[] = [
  CommunicationStatus.SENT,
  CommunicationStatus.DELIVERED,
  CommunicationStatus.READ,
];

/** Nothing more will be sent for this log: a replayed job must not send it again. */
export const isTerminalStatus = (status: string) =>
  ACCEPTED_STATUSES.includes(status) || status === CommunicationStatus.FAILED;
