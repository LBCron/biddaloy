import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { SiteMedia } from './site-media.entity';

/** [40.1.03] A website post or page. Delete guards: see `school-site.entity.ts` header. */
@Unique('UQ_site_posts_tenant_slug', ['tenant_id', 'slug'])
@Index('IDX_site_posts_tenant_published', ['tenant_id', 'published_at'])
@Check('CHK_site_posts_kind', `"kind" IN ('POST','PAGE')`)
@Entity('site_posts')
export class SitePost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_site_posts_tenant_id' })
  tenant: School;

  @Column({ type: 'varchar', length: 4, default: 'POST' })
  kind: 'POST' | 'PAGE';

  @Column({ type: 'varchar', length: 80 })
  slug: string;

  // per-language title, e.g. { bn: '...', en: '...' }
  @Column({ type: 'jsonb' })
  title: Record<string, string>;

  @Column({ type: 'uuid', nullable: true })
  cover_media_id: string | null;

  // In the DB this FK is composite: (tenant_id, cover_media_id) -> site_media(tenant_id, id),
  // ON DELETE SET NULL ("cover_media_id") (migration 1791900003400).
  @ManyToOne(() => SiteMedia, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cover_media_id', foreignKeyConstraintName: 'FK_site_posts_cover_media_id' })
  cover_media: SiteMedia | null;

  // Slate JSON; validated in #3628 (40.3.01)
  @Column({ type: 'jsonb' })
  body: unknown;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
