import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { SiteMedia } from './site-media.entity';

/** [40.1.03] A staff member's public website card. Delete guards: see `school-site.entity.ts`. */
@Unique('UQ_staff_web_profiles_tenant_user', ['tenant_id', 'user_id'])
@Entity('staff_web_profiles')
export class StaffWebProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_staff_web_profiles_tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_staff_web_profiles_user_id' })
  user: User;

  @Column({ type: 'boolean', default: false })
  show_on_website: boolean;

  @Column({ type: 'boolean', default: false })
  featured: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  subjects: string[];

  @Column({ type: 'jsonb', nullable: true })
  bio: Record<string, string> | null;

  @Column({ type: 'jsonb', nullable: true })
  credentials: Record<string, string> | null;

  @Column({ type: 'uuid', nullable: true })
  photo_media_id: string | null;

  // In the DB this FK is composite: (tenant_id, photo_media_id) -> site_media(tenant_id, id),
  // ON DELETE SET NULL ("photo_media_id") (migration 1791900003400).
  @ManyToOne(() => SiteMedia, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'photo_media_id',
    foreignKeyConstraintName: 'FK_staff_web_profiles_photo_media_id',
  })
  photo_media: SiteMedia | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
