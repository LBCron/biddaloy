import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/** [40.1.03] A contact-form message from the public site. Delete guards: see `school-site.entity.ts`. */
@Index('IDX_site_enquiries_tenant_created', ['tenant_id', 'created_at'])
@Check('CHK_site_enquiries_message_len', `char_length("message") <= 2000`)
@Entity('site_enquiries')
export class SiteEnquiry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_site_enquiries_tenant_id' })
  tenant: School;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'timestamptz', nullable: true })
  seen_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
